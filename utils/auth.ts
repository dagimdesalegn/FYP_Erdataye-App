import { AuthChangeEvent, AuthError, Session } from "@supabase/supabase-js";
import { supabase, supabaseAdmin } from "./supabase";

export type UserRole = "patient" | "driver" | "admin" | "hospital";

export interface AuthUser {
  id: string;
  role?: UserRole;
  fullName?: string;
  phone?: string;
}

const isUserRole = (value: unknown): value is UserRole =>
  value === "patient" ||
  value === "driver" ||
  value === "admin" ||
  value === "hospital";

const getRoleFromMetadata = (value: unknown): UserRole | null =>
  isUserRole(value) ? value : null;

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
    const { error } = await supabaseAdmin
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

const phoneToAuthEmail = (phone: string): string => {
  let digits = phone.replace(/[^0-9]/g, "");
  // 09XXXXXXXX -> 2519XXXXXXXX
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "251" + digits.substring(1);
  }
  // 9XXXXXXXX -> 2519XXXXXXXX
  if (digits.length === 9 && digits.startsWith("9")) {
    digits = "251" + digits;
  }
  return `${digits}@phone.erdataya.app`;
};

/**
 * Update auth login identifier (email-like phone login) for an existing user.
 * This keeps sign-in phone number in sync after profile phone changes.
 */
export const updateAuthLoginPhone = async (
  userId: string,
  phone: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return {
        success: false,
        error: new Error("Missing Supabase service-role configuration"),
      };
    }

    const authEmail = phoneToAuthEmail(phone);

    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: authEmail,
        email_confirm: true,
        user_metadata: { phone },
      }),
    });

    if (!res.ok) {
      let msg = `Failed to update auth login (${res.status})`;
      try {
        const body = await res.json();
        msg =
          body?.msg ||
          body?.message ||
          body?.error_description ||
          body?.error ||
          msg;
      } catch {
        // ignore JSON parse failure
      }
      return { success: false, error: new Error(msg) };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Sign up a new user with role (patient, driver, or admin)
 * @param email User email
 * @param password User password (minimum 6 characters)
 * @param role User role: 'patient', 'driver', or 'admin'
 * @param fullName User full name
 * @param phone User phone number
 */
export const signUp = async (
  email: string,
  password: string,
  role: UserRole = "patient",
  fullName: string = "",
  phone: string = "",
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
    // Validate role – only patient and driver can register through the app
    // Admin and hospital accounts are created via the Supabase dashboard
    if (!["patient", "driver"].includes(role)) {
      return {
        user: null,
        error: new Error(
          "Invalid role. Only patient and driver accounts can be registered through the app.",
        ) as AuthError,
      };
    }

    // Use Admin API with service role key to bypass rate limits
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

    let userId: string | null = null;
    let userEmail: string = email;
    let adminCreated = false;

    if (supabaseUrl && serviceRoleKey) {
      try {
        const adminRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            phone: phone || undefined,
            user_metadata: { full_name: fullName, phone, role },
          }),
        });
        const adminData = await adminRes.json();
        if (adminData.id) {
          userId = adminData.id;
          userEmail = adminData.email || email;
          adminCreated = true;
          console.log(
            "User created via Admin API (rate limit bypassed):",
            userId,
          );
        } else {
          console.warn(
            "Admin API failed, falling back to standard signup:",
            adminData.message || adminData.msg,
          );
        }
      } catch (adminErr) {
        console.warn(
          "Admin API error, falling back to standard signup:",
          adminErr,
        );
      }
    }

    // Fallback to standard signup if admin API not available
    if (!adminCreated) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
            role,
          },
        },
      });

      if (error) {
        console.error("Supabase signup error:", error);
        return { user: null, error };
      }

      if (!data.user) {
        console.error("No user returned from signup");
        return {
          user: null,
          error: new Error("No user returned from signup") as AuthError,
        };
      }

      if (isObfuscatedExistingSignupUser(data.user, data.session ?? null)) {
        return {
          user: null,
          error: new Error(
            "This email is already registered. Please sign in instead.",
          ) as AuthError,
        };
      }

      userId = data.user.id;
      userEmail = data.user.email || email;
    }

    if (!userId) {
      return {
        user: null,
        error: new Error("Failed to create user") as AuthError,
      };
    }

    console.log("Signup successful, user created:", userId);

    const resolvedRole = role;

    // Create profile in profiles table
    try {
      const profileData = buildProfilePayload({
        id: userId,
        role: resolvedRole,
        fullName,
        phone,
      });

      const { error: profileError } = await upsertProfileWithRetry(profileData);

      if (profileError) {
        if (profileError.code === "23503") {
          // In some projects auth.users insert is not yet visible right after signUp.
          // Continue; profile will be re-attempted on sign-in.
          console.warn(
            "Profile insert deferred due FK timing:",
            profileError.message,
          );
        } else {
          console.error("Profile upsert error:", profileError);
          return {
            user: null,
            error: new Error(
              `Database error: ${profileError.message}`,
            ) as AuthError,
          };
        }
      }
    } catch (profileErr) {
      console.error("Exception creating profile:", profileErr);
      return {
        user: null,
        error: new Error(`Database error: ${String(profileErr)}`) as AuthError,
      };
    }

    const user: AuthUser = {
      id: userId,
      role: resolvedRole,
      fullName,
      phone,
    };

    // Auto sign-in if created via admin API
    if (adminCreated) {
      try {
        await supabase.auth.signInWithPassword({ email, password });
      } catch (e) {
        console.warn("Auto sign-in after admin create failed:", e);
      }
    }

    return { user, error: null };
  } catch (error) {
    console.error("SignUp exception:", error);
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
  }
};

/**
 * Sign in user with email and password.
 * Uses the GoTrue token endpoint with the service-role key to bypass
 * Supabase per-IP / per-user rate limits (the same approach used in signUp).
 */
export const signIn = async (
  email: string,
  password: string,
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

    let authUser: any = null;
    let adminSignedIn = false;

    // ── Try Admin / service-role token endpoint first ──────────────
    if (supabaseUrl && serviceRoleKey) {
      try {
        const tokenRes = await fetch(
          `${supabaseUrl}/auth/v1/token?grant_type=password`,
          {
            method: "POST",
            headers: {
              apikey: serviceRoleKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email, password }),
          },
        );

        const tokenData = await tokenRes.json();

        if (tokenData.access_token && tokenData.refresh_token) {
          // Hydrate the Supabase client session so all subsequent
          // queries use the authenticated user context.
          const { data: sessionData, error: sessionError } =
            await supabase.auth.setSession({
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
            });

          if (!sessionError && sessionData.session) {
            authUser = sessionData.user ?? sessionData.session.user;
            adminSignedIn = true;
            console.log("Signed in via Admin API (rate limit bypassed)");
          }
        } else if (!tokenRes.ok) {
          // Real credential / validation error → surface immediately
          const errMsg =
            tokenData.error_description ||
            tokenData.msg ||
            tokenData.error ||
            "Invalid login credentials";
          return {
            user: null,
            error: new Error(errMsg) as AuthError,
          };
        }
      } catch (adminErr) {
        console.warn(
          "Admin API sign-in error, falling back to standard:",
          adminErr,
        );
      }
    }

    // ── Fallback to standard signInWithPassword ───────────────────
    if (!adminSignedIn) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { user: null, error };
      }

      if (!data.user) {
        return {
          user: null,
          error: new Error("No user returned from signin") as AuthError,
        };
      }

      authUser = data.user;
    }

    // ── Profile resolution (shared path) ──────────────────────────
    const roleFromMetadata = getRoleFromMetadata(authUser.user_metadata?.role);

    // Read existing profile from DB (single query for both heal-check and data)
    let dbFullName = "";
    let dbPhone = "";
    let profileExists = false;
    let dbRole: UserRole | null = null;
    try {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("full_name, phone, role")
        .eq("id", authUser.id)
        .single();
      if (profileRow) {
        profileExists = true;
        dbFullName = profileRow.full_name || "";
        dbPhone = profileRow.phone || "";
        dbRole = isUserRole(profileRow.role) ? profileRow.role : null;
      }
    } catch (e) {
      console.warn("Could not read profile from DB on sign-in:", e);
    }

    // Only create a profile row if one doesn't exist (heal missing rows).
    // Do NOT upsert over an existing row – that would overwrite user-edited data.
    if (!profileExists) {
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
      // Use the values we just inserted
      dbFullName = String(authUser.user_metadata?.full_name || "");
      dbPhone = String(authUser.user_metadata?.phone || "");
    }

    const role =
      roleFromMetadata ??
      dbRole ??
      (await getUserRole(authUser.id)) ??
      "patient";

    const user: AuthUser = {
      id: authUser.id,
      role,
      fullName: dbFullName || String(authUser.user_metadata?.full_name || ""),
      phone: dbPhone || String(authUser.user_metadata?.phone || ""),
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

    return data.role as UserRole;
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
 * Get current session
 */
export const getCurrentSession = async (): Promise<Session | null> => {
  try {
    const { data, error } = await supabase.auth.getSession();
    return data.session;
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
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
              ? profileRow.role
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
