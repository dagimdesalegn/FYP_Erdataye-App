import { AuthError, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface AuthUser {
  id: string;
  email: string;
  role?: string;
}

/**
 * Sign up a new user
 */
export const signUp = async (
  email: string,
  password: string,
  userData?: { phone?: string; full_name?: string; role?: string }
): Promise<{ user: AuthUser | null; error: AuthError | null }> => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData,
      },
    });

    if (error) {
      return { user: null, error };
    }

    const user: AuthUser = {
      id: data.user?.id || '',
      email: data.user?.email || '',
      role: userData?.role || 'patient',
    };

    // Create profile in profiles table
    if (data.user) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        email: data.user.email,
        role: userData?.role || 'patient',
        full_name: userData?.full_name || '',
        phone: userData?.phone || '',
      });
    }

    return { user, error: null };
  } catch (error) {
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
  }
};

/**
 * Sign in user
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

    const user: AuthUser = {
      id: data.user?.id || '',
      email: data.user?.email || '',
    };

    return { user, error: null };
  } catch (error) {
    const authError = new Error(String(error)) as AuthError;
    return { user: null, error: authError };
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
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email || '',
    };

    return user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
};

/**
 * Listen to auth state changes
 */
export const onAuthStateChange = (
  callback: (user: AuthUser | null) => void
) => {
  const { data: authListener } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (session && session.user) {
        const user: AuthUser = {
          id: session.user.id,
          email: session.user.email || '',
        };
        callback(user);
      } else {
        callback(null);
      }
    }
  );

  return authListener?.subscription.unsubscribe;
};
