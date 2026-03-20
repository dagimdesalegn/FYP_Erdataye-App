import { AuthChangeEvent, AuthError, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

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

const isObfuscatedExistingSignupUser = (
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

const findExistingProfileByPhone = async (phone: string) => {
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

    const res = await fetch(`${BACKEND_URL}/auth/update-phone`, {
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

    // Profile table is the source of truth for app account uniqueness.
    // Check it first so users get a clear, app-specific message.
    const existingProfile = await findExistingProfileByPhone(phone);
    if (existingProfile) {
      const existingRole = isUserRole(existingProfile.role)
        ? normalizeRole(existingProfile.role)
        : "account";
      const roleNote =
        existingRole !== role
          ? ` This phone is already registered as ${existingRole}.`
          : "";
      return {
        user: null,
        error: new Error(
          `This phone number already exists in profiles. Please sign in instead.${roleNote}`,
        ) as AuthError,
      };
    }

    // Create account via backend (service-role key stays server-side)
    const res = await fetch(`${BACKEND_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: authEmail,
        password,
        full_name: fullName,
        phone: ethPhone,
        role,
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

      // If backend/auth says "already exists", re-check profile table and show a clear DB-driven message.
      if (
        String(detail).toLowerCase().includes("already exists") ||
        String(detail).toLowerCase().includes("already registered")
      ) {
        const profileNow = await findExistingProfileByPhone(phone);
        if (profileNow) {
          const existingRole = isUserRole(profileNow.role)
            ? normalizeRole(profileNow.role)
            : "account";
          return {
            user: null,
            error: new Error(
              `This phone number already exists in profiles as ${existingRole}. Please sign in instead.`,
            ) as AuthError,
          };
        }
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
    const res = await fetch(`${BACKEND_URL}/auth/login-phone`, {
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

    // ── Profile resolution ──────────────────────────────────────
    const roleFromMetadata =
      getRoleFromMetadata(tokenData?.role) ??
      getRoleFromMetadata(authUser.user_metadata?.role);

    let dbFullName = "";
    let dbPhone = "";
    let profileExists = false;
    let dbRole: UserRole | null = null;
    try {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, phone, role")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profileRow) {
        profileExists = true;
        dbFullName = profileRow.full_name || "";
        dbPhone = profileRow.phone || "";
        dbRole = isUserRole(profileRow.role)
          ? normalizeRole(profileRow.role)
          : null;
      }
    } catch (e) {
      console.warn("Could not read profile from DB on sign-in:", e);
    }

    // Heal missing profile rows
    if (!profileExists && roleFromMetadata !== "hospital") {
      const profilePayload = buildProfilePayload({
        id: authUser.id,
        role: roleFromMetadata ?? "patient",
        fullName: String(authUser.user_metadata?.full_name || ""),
        phone: String(authUser.user_metadata?.phone || `phone_${Date.now()}`),
      });
      const { error: upsertProfileError } =
        await upsertProfileWithRetry(profilePayload);
      if (upsertProfileError && upsertProfileError.code !== "23503") {
        console.error("Profile ensure error on sign in:", upsertProfileError);
      }
      dbFullName = String(authUser.user_metadata?.full_name || "");
      dbPhone = String(authUser.user_metadata?.phone || "");
    }

    const role = normalizeRole(
      roleFromMetadata ??
      dbRole ??
      (await getUserRole(authUser.id)) ??
      "patient",
    );

    const user: AuthUser = {
      id: authUser.id,
      role,
      fullName:
        dbFullName ||
        String(tokenData?.full_name || authUser.user_metadata?.full_name || ""),
      phone:
        dbPhone ||
        String(tokenData?.phone || authUser.user_metadata?.phone || ""),
    };

    return { user, error: null };
  } catch (error) {
    console.error("SignIn exception:", error);
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
  }
};

/**
 * Get user role from profiles table
 */
export const getUserRole = async (userId: string): Promise<UserRole | null> => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.error("Error fetching user role:", error);
      return null;
    }

    if (!isUserRole(data.role)) return null;
    return normalizeRole(data.role);
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

      // Always try to load full profile from DB (async, deferred).
      setTimeout(async () => {
        try {
          const { data: profileRow } = await supabase
            .from("profiles")
            .select("full_name, phone, role")
            .eq("id", sessionUser.id)
            .maybeSingle();

          const role =
            profileRow?.role && isUserRole(profileRow.role)
              ? normalizeRole(profileRow.role)
              : (roleFromMetadata ??
                (await getUserRole(sessionUser.id)) ??
                "patient");

          callback({
            id: sessionUser.id,
            role,
            fullName: profileRow?.full_name || fallbackUser.fullName || "",
            phone: profileRow?.phone || fallbackUser.phone || "",
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
