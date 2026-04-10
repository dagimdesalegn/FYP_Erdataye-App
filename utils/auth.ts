import { AuthChangeEvent, AuthError, Session } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { supabase } from "./supabase";

const ENV_BACKEND_URL_RAW = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || "";
const ENV_BACKEND_URL = ENV_BACKEND_URL_RAW || "http://localhost:8000";
const BACKEND_FALLBACKS = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

// Safety net for release builds where EXPO_PUBLIC_* env values may not be
// embedded as expected. Keep public URLs here so auth still works on devices.
const DEFAULT_PUBLIC_BACKENDS = [
  "http://207.180.205.85/api",
  "http://207.180.205.85:8000",
];

const CONNECT_TIMEOUT_MS = 12000;

const isLocalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2"].includes(
      parsed.hostname,
    );
  } catch {
    return false;
  }
};

const trimTrailingSlash = (value: string): string =>
  value.replace(/\/+$/, "");

const addDerivedPublicCandidates = (
  add: (url?: string | null) => void,
  sourceUrl: string,
) => {
  try {
    const parsed = new URL(sourceUrl);
    const sourcePath = trimTrailingSlash(parsed.pathname || "");
    const hostOnly = parsed.hostname;
    const origin = `${parsed.protocol}//${parsed.host}`;
    const hostOrigin = `${parsed.protocol}//${hostOnly}`;

    if (!hostOnly || isLocalUrl(sourceUrl)) return;

    // If configured with :8000, also try port-80 /api for mobile carriers
    // that block non-standard ports.
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
      add(`${hostOrigin}/api`);
    }

    // If configured root URL, try /api path too.
    if (!sourcePath || sourcePath === "/") {
      add(`${origin}/api`);
      return;
    }

    // If already configured at /api, also try direct origin and :8000.
    if (sourcePath === "/api") {
      add(origin);
      add(`${parsed.protocol}//${hostOnly}:8000`);
    }
  } catch {
    // Ignore invalid URLs; they are already filtered by add().
  }
};

/**
 * Build an ordered list of backend base URLs to try, matching the same logic
 * used in api.ts so that auth calls (register, login) also benefit from
 * the ngrok / LAN / emulator fallback chain.
 */
function buildBackendCandidates(): string[] {
  const list: string[] = [];
  const add = (url?: string | null) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const normalized = trimTrailingSlash(url);
    if (!list.includes(normalized)) list.push(normalized);
  };

  // Prefer explicitly configured/public URLs first for real devices.
  const publicFallbacks = BACKEND_FALLBACKS.filter((url) => !isLocalUrl(url));
  publicFallbacks.forEach((url) => {
    add(url);
    addDerivedPublicCandidates(add, url);
  });

  if (ENV_BACKEND_URL_RAW) {
    add(ENV_BACKEND_URL_RAW);
    addDerivedPublicCandidates(add, ENV_BACKEND_URL_RAW);
  }

  // Keep any remaining fallbacks (including local URLs) afterward.
  BACKEND_FALLBACKS.forEach(add);

  // If nothing public was configured, inject stable production fallbacks.
  // This prevents mobile auth failures caused by localhost-only candidates.
  if (!list.some((url) => !isLocalUrl(url))) {
    DEFAULT_PUBLIC_BACKENDS.forEach((url) => {
      add(url);
      addDerivedPublicCandidates(add, url);
    });
  }

  // Platform-specific localhost alternatives for emulators
  if (Platform.OS === "android") add("http://10.0.2.2:8000");
  add("http://localhost:8000");
  add("http://127.0.0.1:8000");

  // If no explicit env URL was provided, keep the default localhost last.
  if (!ENV_BACKEND_URL_RAW) add(ENV_BACKEND_URL);

  return list.length > 0 ? list : ["http://localhost:8000"];
}

const BACKEND_CANDIDATES = buildBackendCandidates();
let activeBackendBase = BACKEND_CANDIDATES[0];

/**
 * fetch() wrapper that tries every candidate backend URL in order.
 * Sticks with the last successful base for subsequent calls.
 */
async function fetchBackend(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const order = [
    activeBackendBase,
    ...BACKEND_CANDIDATES.filter((u) => u !== activeBackendBase),
  ];
  let lastError: Error | null = null;
  const failedAttempts: string[] = [];

  for (const base of order) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
      });
      activeBackendBase = base;
      return res;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      failedAttempts.push(`${base} -> ${lastError.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  const fallbackError =
    failedAttempts.length > 0
      ? new Error(
          `Unable to reach backend. Tried: ${failedAttempts.join(" | ")}`,
        )
      : new Error("All backend URLs unreachable");

  throw fallbackError;
}

export type UserRole =
  | "patient"
  | "ambulance"
  | "driver"
  | "admin"
  | "hospital";

export interface AuthUser {
  id: string;
  role?: UserRole;
  fullName?: string;
  phone?: string;
  hospitalId?: string;
}

export interface RegistrationHospitalOption {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  is_accepting_emergencies?: boolean;
}

type PhoneLoginResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user_id: string;
  role?: UserRole;
  full_name?: string;
  phone?: string;
  hospital_id?: string;
};

const isUserRole = (value: unknown): value is UserRole =>
  value === "patient" ||
  value === "ambulance" ||
  value === "driver" ||
  value === "admin" ||
  value === "hospital";

const normalizeRole = (role: UserRole): UserRole =>
  role === "driver" ? "ambulance" : role;

const getRoleFromMetadata = (value: unknown): UserRole | null =>
  isUserRole(value) ? normalizeRole(value) : null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const _isObfuscatedExistingSignupUser = (
  user: any,
  session: Session | null,
): boolean => {
  const identities = user?.identities;
  return !session && Array.isArray(identities) && identities.length === 0;
};

const buildProfilePayload = ({
  id,
  role,
  fullName,
  phone,
}: {
  id: string;
  role: UserRole;
  fullName: string;
  phone: string;
}) => ({
  id,
  role,
  full_name: fullName,
  phone: phone || `phone_${Date.now()}`,
  updated_at: new Date().toISOString(),
});

const upsertProfileWithRetry = async (
  payload: ReturnType<typeof buildProfilePayload>,
  retries: number = 2,
) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });
    if (!error) {
      return { error: null };
    }

    if (error.code === "23503" && attempt < retries) {
      await sleep(250 * (attempt + 1));
      continue;
    }

    return { error };
  }

  return { error: null };
};

/**
 * Convert any phone input to a fake email for Supabase email auth.
 * Example: +251912345678 → 251912345678@phone.erdataya.app
 * This avoids needing Twilio / SMS provider for phone auth.
 */
const toAuthEmail = (phone: string): string => {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "251" + digits.substring(1);
  }
  if (digits.length === 9 && digits.startsWith("9")) {
    digits = "251" + digits;
  }
  return `${digits}@phone.erdataya.app`;
};

/** Convert any phone format to E.164: +251912345678 */
const toEthiopianPhone = (phone: string): string => {
  let digits = phone.replace(/[^0-9]/g, "");
  // 0912345678 → 251912345678
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "251" + digits.substring(1);
  }
  // 912345678 → 251912345678
  if (digits.length === 9 && digits.startsWith("9")) {
    digits = "251" + digits;
  }
  return "+" + digits;
};

const toProfilePhoneCandidates = (phone: string): string[] => {
  const normalized = toEthiopianPhone(phone); // +2519XXXXXXXX
  const digits = normalized.replace(/[^0-9]/g, ""); // 2519XXXXXXXX
  const local =
    digits.startsWith("251") && digits.length >= 12
      ? `0${digits.substring(3)}`
      : `0${digits}`;

  return Array.from(
    new Set([normalized, digits, local, local.replace(/^0/, "")]),
  );
};

export const getRegistrationHospitalOptions = async (): Promise<{
  hospitals: RegistrationHospitalOption[];
  error: Error | null;
}> => {
  try {
    const res = await fetchBackend("/auth/hospitals/available", {
      method: "GET",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        body?.detail || `Failed to load hospitals (${res.status})`,
      );
    }
    const data = (await res.json()) as RegistrationHospitalOption[];
    return { hospitals: Array.isArray(data) ? data : [], error: null };
  } catch (error) {
    return { hospitals: [], error: error as Error };
  }
};

const _findExistingProfileByPhone = async (phone: string) => {
  try {
    const candidates = toProfilePhoneCandidates(phone);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, full_name, phone")
      .in("phone", candidates)
      .limit(1);

    if (error) {
      console.warn("Profile duplicate check failed:", error.message);
      return null;
    }

    return data?.[0] ?? null;
  } catch (e) {
    console.warn("Profile duplicate check exception:", e);
    return null;
  }
};

/**
 * Update auth phone for an existing user.
 * Routes through the Python backend so the service-role key stays server-side.
 */
export const updateAuthLoginPhone = async (
  userId: string,
  phone: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const authEmail = toAuthEmail(phone);
    const ethPhone = toEthiopianPhone(phone);

    const res = await fetchBackend("/auth/update-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        phone: ethPhone,
        email: authEmail,
      }),
    });

    if (!res.ok) {
      const body = await res.text().then((t) => {
        try {
          return JSON.parse(t);
        } catch {
          return {};
        }
      });
      return {
        success: false,
        error: new Error(
          body?.detail || `Failed to update auth login (${res.status})`,
        ),
      };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Sign up a new user with role (patient or ambulance).
 * Routes through the Python backend so the service-role key stays server-side.
 */
export const signUp = async (
  phone: string,
  password: string,
  role: UserRole = "patient",
  fullName: string = "",
  hospitalId?: string,
  location?: { latitude: number; longitude: number } | null,
  nationalId?: string,
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
    if (!["patient", "ambulance"].includes(role)) {
      return {
        user: null,
        error: new Error(
          "Invalid role. Only patient and ambulance accounts can be registered through the app.",
        ) as AuthError,
      };
    }

    const authEmail = toAuthEmail(phone);
    const ethPhone = toEthiopianPhone(phone);

    // Duplicate-phone detection is handled server-side (service-role key
    // bypasses RLS).  A client-side query on `profiles` triggers RLS
    // infinite-recursion on some Supabase setups, so we skip it here.

    // Create account via backend (service-role key stays server-side)
    const res = await fetchBackend("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: authEmail,
        password,
        full_name: fullName,
        phone: ethPhone,
        national_id:
          nationalId && nationalId.trim().length === 16
            ? nationalId.trim()
            : null,
        role,
        hospital_id: hospitalId,
        latitude: location?.latitude,
        longitude: location?.longitude,
      }),
    });

    let resBody: any;
    try {
      const text = await res.text();
      resBody = text ? JSON.parse(text) : {};
    } catch {
      resBody = {};
    }

    if (!res.ok || !resBody.user_id) {
      const detail =
        resBody?.detail ?? "Registration failed. Please try again.";

      // Backend returns 409 for duplicate accounts — show user-friendly message
      if (
        String(detail).toLowerCase().includes("already exists") ||
        String(detail).toLowerCase().includes("already registered")
      ) {
        return {
          user: null,
          error: new Error(
            "This phone number is already registered. Please sign in instead.",
          ) as AuthError,
        };
      }

      return {
        user: null,
        error: new Error(detail) as AuthError,
      };
    }

    const userId = resBody.user_id;
    console.log("User created via backend:", userId);

    // Auto sign-in so the client has an authenticated session
    try {
      await supabase.auth.signInWithPassword({ email: authEmail, password });
    } catch (e) {
      console.warn("Auto sign-in after backend create failed:", e);
    }

    const user: AuthUser = {
      id: userId,
      role,
      fullName,
      phone: ethPhone,
      hospitalId:
        typeof resBody?.hospital_id === "string" &&
        resBody.hospital_id.length > 0
          ? resBody.hospital_id
          : undefined,
    };

    return { user, error: null };
  } catch (error) {
    console.error("SignUp exception:", error);
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
  }
};

/**
 * Sign in user with phone and password.
 * Routes through the Python backend so the service-role key stays server-side.
 */
export const signIn = async (
  phone: string,
  password: string,
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
    // Authenticate via one phone-based backend endpoint (role-aware response)
    const res = await fetchBackend("/auth/login-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });

    let tokenData: PhoneLoginResponse | any;
    try {
      const text = await res.text();
      tokenData = text ? JSON.parse(text) : {};
    } catch {
      tokenData = {};
    }

    if (!res.ok || !tokenData.access_token) {
      const errMsg =
        tokenData.detail ??
        tokenData.error_description ??
        "Invalid login credentials";
      return { user: null, error: new Error(errMsg) as AuthError };
    }

    // Hydrate the Supabase client session with the tokens from backend
    const { data: sessionData, error: sessionError } =
      await supabase.auth.setSession({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
      });

    if (sessionError || !sessionData.session) {
      return {
        user: null,
        error:
          sessionError ?? (new Error("Failed to set session") as AuthError),
      };
    }

    const authUser = sessionData.user ?? sessionData.session.user;

    // ── Fast profile resolution from backend login response ─────
    // The backend already returns role/full_name/phone — use those directly
    // instead of making extra DB round-trips.
    const roleFromMetadata =
      getRoleFromMetadata(tokenData?.role) ??
      getRoleFromMetadata(authUser.user_metadata?.role);

    const dbFullName =
      tokenData?.full_name || String(authUser.user_metadata?.full_name || "");
    const dbPhone =
      tokenData?.phone || String(authUser.user_metadata?.phone || "");

    const role = normalizeRole(roleFromMetadata ?? "patient");

    const user: AuthUser = {
      id: authUser.id,
      role,
      fullName: dbFullName,
      phone: dbPhone,
    };

    // Fire-and-forget: heal missing profile in background (don't block login)
    if (roleFromMetadata !== "hospital") {
      const profilePayload = buildProfilePayload({
        id: authUser.id,
        role,
        fullName: dbFullName,
        phone: dbPhone || `phone_${Date.now()}`,
      });
      upsertProfileWithRetry(profilePayload).catch(() => {});
    }

    return { user, error: null };
  } catch (error) {
    console.error("SignIn exception:", error);
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
  }
};

/**
 * Get user role — try metadata first, then profiles DB fallback.
 */
export const getUserRole = async (userId: string): Promise<UserRole | null> => {
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      const metaRole = getRoleFromMetadata(data.user.user_metadata?.role);
      if (metaRole) return metaRole;
    }

    const { data: roleRow, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error || !roleRow) {
      console.error("Error fetching user role:", error);
      return null;
    }

    if (!isUserRole(roleRow.role)) return null;
    return normalizeRole(roleRow.role);
  } catch (error) {
    console.error("Exception fetching user role:", error);
    return null;
  }
};

/**
 * Get current user with role information
 */
export const getCurrentUserWithRole = async (): Promise<AuthUser | null> => {
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    const roleFromMetadata = getRoleFromMetadata(data.user.user_metadata?.role);
    const role =
      roleFromMetadata ?? (await getUserRole(data.user.id)) ?? "patient";

    const user: AuthUser = {
      id: data.user.id,
      role,
    };

    return user;
  } catch (error) {
    console.error("Error getting current user with role:", error);
    return null;
  }
};

/**
 * Sign out user
 */
export const signOut = async (): Promise<{ error: AuthError | null }> => {
  try {
    const { error } = await supabase.auth.signOut();
    return { error };
  } catch (error) {
    const authError = new Error(String(error)) as AuthError;
    return { error: authError };
  }
};

/**
 * Get current user
 */
export const getCurrentUser = async (): Promise<AuthUser | null> => {
  return getCurrentUserWithRole();
};

/**
 * Listen to auth state changes with role information
 */
export const onAuthStateChange = (
  callback: (user: AuthUser | null) => void,
) => {
  const { data: authListener } = supabase.auth.onAuthStateChange(
    (_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.user) {
        callback(null);
        return;
      }

      const sessionUser = session.user;
      const meta = sessionUser.user_metadata ?? {};
      const roleFromMetadata = getRoleFromMetadata(meta.role);
      const fallbackUser: AuthUser = {
        id: sessionUser.id,
        role: roleFromMetadata ?? "patient",
        fullName: String(meta.full_name || ""),
        phone: String(meta.phone || ""),
      };

      // Use auth user_metadata directly (avoids RLS issues on profiles table).
      setTimeout(async () => {
        try {
          const role =
            roleFromMetadata ??
            (await getUserRole(sessionUser.id)) ??
            "patient";

          callback({
            id: sessionUser.id,
            role,
            fullName: String(meta.full_name || ""),
            phone: String(meta.phone || ""),
          });
        } catch (error) {
          console.error(
            "Error resolving profile during auth state change:",
            error,
          );
          callback(fallbackUser);
        }
      }, 0);
    },
  );

  return () => {
    authListener?.subscription.unsubscribe();
  };
};
