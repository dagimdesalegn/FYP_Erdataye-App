import { supabase } from './supabase';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: 'patient' | 'driver' | 'hospital_staff' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface MedicalProfile {
  id: string;
  user_id: string;
  blood_type: string;
  allergies: string[];
  emergency_contact_name: string;
  emergency_contact_phone: string;
  medical_conditions: string[];
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
    const { data, error } = await supabase
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
    const { error } = await supabase
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
    const { data, error } = await supabase
      .from('medical_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      throw error;
    }

    // Normalize `medical_conditions` to an array in the returned profile
    const profile = data as any;
    if (profile) {
      if (typeof profile.medical_conditions === 'string') {
        profile.medical_conditions = profile.medical_conditions
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
      } else if (!Array.isArray(profile.medical_conditions)) {
        profile.medical_conditions = [];
      }
      if (!Array.isArray(profile.allergies)) {
        profile.allergies = profile.allergies ? [profile.allergies] : [];
      }
    }

    return { profile: profile as MedicalProfile, error: null };
  } catch (error) {
    return { profile: null, error: error as Error };
  }
};

/**
 * Create or update medical profile
 */
export const upsertMedicalProfile = async (
  userId: string,
  medicalData: Omit<MedicalProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const now = new Date().toISOString();
    
    // Build payload with only the fields that should exist in medical_profiles table
    const profilePayload: any = {
      user_id: userId, // Use user_id instead of patient_id
      blood_type: medicalData.blood_type || 'Unknown',
      // keep allergies as an array if provided, otherwise empty array
      allergies: Array.isArray(medicalData.allergies) ? medicalData.allergies : (medicalData.allergies ? [medicalData.allergies] : []),
      emergency_contact_name: medicalData.emergency_contact_name || '',
      emergency_contact_phone: medicalData.emergency_contact_phone || '',
      // medical_conditions stored as text in DB; store as comma-separated string
      medical_conditions: Array.isArray(medicalData.medical_conditions)
        ? medicalData.medical_conditions.join(', ')
        : (medicalData.medical_conditions ? String(medicalData.medical_conditions) : ''),
      updated_at: now,
    };

    // Detect which foreign key column exists: prefer `user_id`, fall back to `patient_id`
    let keyColumn = 'user_id';
    let check = await supabase.from('medical_profiles').select('id').eq('user_id', userId).limit(1);
    if (check.error) {
      const msg = String(check.error.message || '');
      if (/user_id/.test(msg) || /column.*user_id.*does not exist/i.test(msg)) {
        keyColumn = 'patient_id';
      }
    }

    // First, try to fetch existing record using detected column
    const existing = await supabase
      .from('medical_profiles')
      .select('id')
      .eq(keyColumn, userId)
      .limit(1)
      .maybeSingle();

    let result;
    if (existing && (existing as any).id) {
      // Update existing profile
      result = await supabase
        .from('medical_profiles')
        .update({ ...profilePayload })
        .eq(keyColumn, userId);
    } else {
      // Insert new profile using detected column name
      const insertPayload: any = { ...profilePayload, created_at: now };
      // ensure correct foreign key field name
      if (keyColumn === 'patient_id') {
        insertPayload.patient_id = insertPayload.user_id;
        delete insertPayload.user_id;
      }
      result = await supabase.from('medical_profiles').insert([insertPayload]);
    }

    const { error: medicalError } = result;

    if (medicalError) {
      console.warn('Medical profile upsert warning:', medicalError.message);
      return { success: false, error: medicalError as Error };
    }

    return { success: true, error: null };
  } catch (error) {
    console.warn('Medical profile upsert exception:', error);
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
