import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Create a service-role client that bypasses RLS for profile writes
const getServiceClient = () => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return supabase; // fallback to anon client
};

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string;
  role: 'patient' | 'driver' | 'hospital_staff' | 'admin';
  hospital_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicalProfile {
  id: string;
  patient_id: string;
  blood_type: string;
  allergies: string[];
  chronic_conditions: string[];
  medications: string[];
  emergency_contact_name: string;
  emergency_contact_phone: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get user profile
 */
export const getUserProfile = async (userId: string): Promise<{
  profile: UserProfile | null;
  error: Error | null;
}> => {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    return { profile: data as UserProfile, error: null };
  } catch (error) {
    return { profile: null, error: error as Error };
  }
};

/**
 * Update user profile
 */
export const updateUserProfile = async (
  userId: string,
  updates: Partial<UserProfile>
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const client = getServiceClient();
    const { error } = await client
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Get medical profile
 */
export const getMedicalProfile = async (userId: string): Promise<{
  profile: MedicalProfile | null;
  error: Error | null;
}> => {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from('medical_profiles')
      .select('*')
      .eq('patient_id', userId)
      .single();

    if (error) {
      throw error;
    }

    return { profile: data as MedicalProfile, error: null };
  } catch (error) {
    return { profile: null, error: error as Error };
  }
};

/**
 * Create or update medical profile
 */
export const upsertMedicalProfile = async (
  userId: string,
  medicalData: Omit<MedicalProfile, 'id' | 'patient_id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const client = getServiceClient();
    const now = new Date().toISOString();
    
    // Map to actual DB column names
    const profilePayload: any = {
      patient_id: userId,
      blood_type: medicalData.blood_type,
      allergies: medicalData.allergies,
      chronic_conditions: medicalData.chronic_conditions || [],
      medications: medicalData.medications || [],
      emergency_contact_name: medicalData.emergency_contact_name,
      emergency_contact_phone: medicalData.emergency_contact_phone,
      updated_at: now,
    };

    // Check if record exists
    const { data: existing } = await client
      .from('medical_profiles')
      .select('id')
      .eq('patient_id', userId)
      .single();

    let result;
    if (existing) {
      // Update existing record
      result = await client.from('medical_profiles')
        .update(profilePayload)
        .eq('patient_id', userId);
    } else {
      // Insert new record
      result = await client.from('medical_profiles')
        .insert({ ...profilePayload, created_at: now });
    }
    
    const { error } = result;

    if (error) {
      console.error('Medical profile upsert error:', error);
      throw error;
    }

    console.log('Medical profile upserted successfully');
    return { success: true, error: null };
  } catch (error) {
    console.error('Medical profile upsert exception:', error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get all drivers
 */
export const getDrivers = async (): Promise<{
  drivers: UserProfile[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'driver');

    if (error) {
      throw error;
    }

    return { drivers: data as UserProfile[], error: null };
  } catch (error) {
    return { drivers: null, error: error as Error };
  }
};

/**
 * Get all patients
 */
export const getPatients = async (): Promise<{
  patients: UserProfile[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'patient');

    if (error) {
      throw error;
    }

    return { patients: data as UserProfile[], error: null };
  } catch (error) {
    return { patients: null, error: error as Error };
  }
};

/**
 * Get hospital staff
 */
export const getHospitalStaff = async (): Promise<{
  staff: UserProfile[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'hospital_staff');

    if (error) {
      throw error;
    }

    return { staff: data as UserProfile[], error: null };
  } catch (error) {
    return { staff: null, error: error as Error };
  }
};
