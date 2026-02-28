/**
 * Database Diagnostic Helper
 * 
 * Use this to diagnose issues with user registration and profile creation
 */

import { supabase } from './supabase';

/**
 * Check if a user exists in the profiles table
 */
export const checkUserProfile = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('❌ User not found in profiles table:', error.message);
      return { exists: false, error };
    }

    console.log('✅ User found in profiles:', data);
    return { exists: true, data };
  } catch (err) {
    console.error('Exception checking profile:', err);
    return { exists: false, error: err };
  }
};

/**
 * Check if a medical profile exists
 */
export const checkMedicalProfile = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('medical_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('❌ Medical profile not found:', error.message);
      return { exists: false, error };
    }

    console.log('✅ Medical profile found:', data);
    return { exists: true, data };
  } catch (err) {
    console.error('Exception checking medical profile:', err);
    return { exists: false, error: err };
  }
};

/**
 * Get current authenticated user
 */
export const getCurrentAuthUser = async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    
    if (error) {
      console.error('❌ No authenticated user:', error.message);
      return { user: null, error };
    }

    console.log('✅ Current user:', data.user?.id, data.user?.email);
    return { user: data.user, error: null };
  } catch (err) {
    console.error('Exception getting user:', err);
    return { user: null, error: err };
  }
};

/**
 * Test database connectivity and permissions
 */
export const testDatabaseConnection = async () => {
  console.log('🔍 Testing database connection...');
  
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('count()', { count: 'exact' });

    if (error) {
      console.error('❌ Database error:', error.message);
      return { connected: false, error };
    }

    console.log('✅ Database connected. Total profiles:', data);
    return { connected: true, data };
  } catch (err) {
    console.error('❌ Connection exception:', err);
    return { connected: false, error: err };
  }
};

/**
 * Comprehensive diagnostics
 */
export const runFullDiagnostics = async () => {
  console.log('=== 🏥 Erdataye Database Diagnostics ===\n');
  
  console.log('1️⃣ Testing database connection...');
  await testDatabaseConnection();
  
  console.log('\n2️⃣ Checking current user...');
  const { user } = await getCurrentAuthUser();
  
  if (user) {
    console.log('\n3️⃣ Checking user profile...');
    await checkUserProfile(user.id);
    
    console.log('\n4️⃣ Checking medical profile...');
    await checkMedicalProfile(user.id);
  }
  
  console.log('\n=== End Diagnostics ===\n');
};

// Export for easy testing in browser console
if (typeof window !== 'undefined') {
  (window as any).erdataayeDiag = {
    checkUserProfile,
    checkMedicalProfile,
    getCurrentAuthUser,
    testDatabaseConnection,
    runFullDiagnostics,
  };
}
