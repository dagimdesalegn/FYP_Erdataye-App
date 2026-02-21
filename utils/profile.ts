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
  medicalData: Omit<MedicalProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const now = new Date().toISOString();
    
    // Use patient_id as per actual schema
    const profilePayload: any = {
      patient_id: userId,
      blood_type: medicalData.blood_type || 'Unknown',
      allergies: Array.isArray(medicalData.allergies) ? medicalData.allergies.join(', ') : medicalData.allergies || '',
      emergency_contact_name: medicalData.emergency_contact_name || '',
      emergency_contact_phone: medicalData.emergency_contact_phone || '',
      chronic_conditions: medicalData.medical_conditions ? medicalData.medical_conditions.join(', ') : '',
      medications: '',
      created_at: now,
      updated_at: now,
    };

    const { data: medicalData_result, error: medicalError } = await supabase.from('medical_profiles').upsert(
      profilePayload,
      { onConflict: 'patient_id' }
    );

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
