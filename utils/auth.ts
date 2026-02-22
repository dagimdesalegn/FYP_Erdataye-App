import { AuthError, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type UserRole = 'patient' | 'driver' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role?: UserRole;
  fullName?: string;
  phone?: string;
}

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

    console.log('Signup successful, user created:', data.user.id);

    if (!data.user) {
      console.error('No user returned from signup');
      return { 
        user: null, 
        error: new Error('No user returned from signup') as AuthError 
      };
    }

    // Create profile in profiles table
    try {
      console.log('Creating profile for user:', data.user.id);
      const profileData = {
        id: data.user.id,
        email: data.user.email || email,
        role,
        full_name: fullName,
        phone: phone || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      console.log('Profile payload:', profileData);
      
      const { error: profileError, data: profileResult } = await supabase.from('profiles').insert(profileData);

      if (profileError) {
        // If profile already exists (duplicate key), that's OK - treat as success
        if (profileError.code === '23505') {
          console.log('Profile already exists, treating as success');
        } else if (profileError.code === '23502') {
          // NOT NULL constraint violation
          console.error('Database constraint error - required field missing:', profileError.message);
          return { 
            user: null, 
            error: new Error(`Database error: ${profileError.message}`) as AuthError 
          };
        } else {
          console.error('Profile creation error:', profileError);
          console.error('Error code:', profileError.code);
          console.error('Error message:', profileError.message);
          return { 
            user: null, 
            error: new Error(`Database error: ${profileError.message}`) as AuthError 
          };
        }
      } else {
        console.log('Profile created successfully:', profileResult);
      }
    } catch (profileErr) {
      console.error('Exception creating profile:', profileErr);
      // Continue - don't fail signup if profile creation fails
    }

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email || '',
      role,
      fullName,
      phone,
    };

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

    // Fetch user role from profiles table
    const role = await getUserRole(data.user.id);

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email || '',
      role: role as UserRole || 'patient',
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

    const role = await getUserRole(data.user.id);

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email || '',
      role: role as UserRole || 'patient',
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
    async (event: any, session: any) => {
      if (session && session.user) {
        const role = await getUserRole(session.user.id);
        const user: AuthUser = {
          id: session.user.id,
          email: session.user.email || '',
          role: role as UserRole || 'patient',
        };
        callback(user);
      } else {
        callback(null);
      }
    }
  );

  return authListener?.subscription.unsubscribe;
};
