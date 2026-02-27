import { AuthChangeEvent, AuthError, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type UserRole = 'patient' | 'driver' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role?: UserRole;
  fullName?: string;
  phone?: string;
}

const isUserRole = (value: unknown): value is UserRole =>
  value === 'patient' || value === 'driver' || value === 'admin';

const getRoleFromMetadata = (value: unknown): UserRole | null =>
  isUserRole(value) ? value : null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isObfuscatedExistingSignupUser = (user: any, session: Session | null): boolean => {
  const identities = user?.identities;
  return !session && Array.isArray(identities) && identities.length === 0;
};

const buildProfilePayload = ({
  id,
  email,
  role,
  fullName,
  phone,
}: {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone: string;
}) => ({
  id,
  email,
  role,
  full_name: fullName,
  phone: phone || null,
  updated_at: new Date().toISOString(),
});

const upsertProfileWithRetry = async (
  payload: ReturnType<typeof buildProfilePayload>,
  retries: number = 2
) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
    if (!error) {
      return { error: null };
    }

    if (error.code === '23503' && attempt < retries) {
      await sleep(250 * (attempt + 1));
      continue;
    }

    return { error };
  }

  return { error: null };
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
  role: UserRole = 'patient',
  fullName: string = '',
  phone: string = ''
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
    // Validate role
    if (!['patient', 'driver', 'admin'].includes(role)) {
      return { 
        user: null, 
        error: new Error('Invalid role. Must be patient, driver, or admin') as AuthError 
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
          method: 'POST',
          headers: {
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
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
          console.log('User created via Admin API (rate limit bypassed):', userId);
        } else {
          console.warn('Admin API failed, falling back to standard signup:', adminData.message || adminData.msg);
        }
      } catch (adminErr) {
        console.warn('Admin API error, falling back to standard signup:', adminErr);
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
        console.error('Supabase signup error:', error);
        return { user: null, error };
      }

      if (!data.user) {
        console.error('No user returned from signup');
        return { 
          user: null, 
          error: new Error('No user returned from signup') as AuthError 
        };
      }

      if (isObfuscatedExistingSignupUser(data.user, data.session ?? null)) {
        return {
          user: null,
          error: new Error('This email is already registered. Please sign in instead.') as AuthError,
        };
      }

      userId = data.user.id;
      userEmail = data.user.email || email;
    }

    if (!userId) {
      return { user: null, error: new Error('Failed to create user') as AuthError };
    }

    console.log('Signup successful, user created:', userId);

    const resolvedRole = role;

    // Create profile in profiles table
    try {
      const profileData = buildProfilePayload({
        id: userId,
        email: userEmail,
        role: resolvedRole,
        fullName,
        phone,
      });

      const { error: profileError } = await upsertProfileWithRetry(profileData);

      if (profileError) {
        if (profileError.code === '23503') {
          // In some projects auth.users insert is not yet visible right after signUp.
          // Continue; profile will be re-attempted on sign-in.
          console.warn('Profile insert deferred due FK timing:', profileError.message);
        } else {
          console.error('Profile upsert error:', profileError);
          return {
            user: null,
            error: new Error(`Database error: ${profileError.message}`) as AuthError,
          };
        }
      }
    } catch (profileErr) {
      console.error('Exception creating profile:', profileErr);
      return {
        user: null,
        error: new Error(`Database error: ${String(profileErr)}`) as AuthError,
      };
    }

    const user: AuthUser = {
      id: userId,
      email: userEmail,
      role: resolvedRole,
      fullName,
      phone,
    };

    // Auto sign-in if created via admin API
    if (adminCreated) {
      try {
        await supabase.auth.signInWithPassword({ email, password });
      } catch (e) {
        console.warn('Auto sign-in after admin create failed:', e);
      }
    }

    return { user, error: null };
  } catch (error) {
    console.error('SignUp exception:', error);
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
  }
};

/**
 * Sign in user with email and password
 */
export const signIn = async (
  email: string,
  password: string
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
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
        error: new Error('No user returned from signin') as AuthError 
      };
    }

    const roleFromMetadata = getRoleFromMetadata(data.user.user_metadata?.role);

    // Heal missing profile rows so role lookups and medical profile writes work reliably.
    const profilePayload = buildProfilePayload({
      id: data.user.id,
      email: data.user.email || email,
      role: roleFromMetadata ?? 'patient',
      fullName: String(data.user.user_metadata?.full_name || ''),
      phone: String(data.user.user_metadata?.phone || ''),
    });
    const { error: upsertProfileError } = await upsertProfileWithRetry(profilePayload);
    if (upsertProfileError && upsertProfileError.code !== '23503') {
      console.error('Profile ensure error on sign in:', upsertProfileError);
    }

    const role = roleFromMetadata ?? (await getUserRole(data.user.id)) ?? 'patient';

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email || '',
      role,
      fullName: String(data.user.user_metadata?.full_name || ''),
      phone: String(data.user.user_metadata?.phone || ''),
    };

    return { user, error: null };
  } catch (error) {
    console.error('SignIn exception:', error);
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
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.error('Error fetching user role:', error);
      return null;
    }

    return data.role as UserRole;
  } catch (error) {
    console.error('Exception fetching user role:', error);
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
    const role = roleFromMetadata ?? (await getUserRole(data.user.id)) ?? 'patient';

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email || '',
      role,
    };

    return user;
  } catch (error) {
    console.error('Error getting current user with role:', error);
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
    console.error('Error getting session:', error);
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
  callback: (user: AuthUser | null) => void
) => {
  const { data: authListener } = supabase.auth.onAuthStateChange(
    (_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.user) {
        callback(null);
        return;
      }

      const sessionUser = session.user;
      const roleFromMetadata = getRoleFromMetadata(sessionUser.user_metadata?.role);
      const fallbackUser: AuthUser = {
        id: sessionUser.id,
        email: sessionUser.email || '',
        role: roleFromMetadata ?? 'patient',
      };

      if (roleFromMetadata) {
        callback(fallbackUser);
        return;
      }

      // Avoid calling Supabase APIs synchronously inside this callback.
      // auth-js holds an internal lock while this runs, and nested auth access can deadlock.
      setTimeout(async () => {
        try {
          const role = await getUserRole(sessionUser.id);
          callback({
            ...fallbackUser,
            role: role ?? 'patient',
          });
        } catch (error) {
          console.error('Error resolving role during auth state change:', error);
          callback(fallbackUser);
        }
      }, 0);
    }
  );

  return () => {
    authListener?.subscription.unsubscribe();
  };
};
