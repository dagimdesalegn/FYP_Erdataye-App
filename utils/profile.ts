import { supabase } from "./supabase";

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string;
  role: "patient" | "driver" | "hospital" | "admin";
  hospital_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicalProfile {
  id: string;
  user_id: string;
  blood_type: string;
  allergies: string;
  medical_conditions: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get user profile
 */
export const getUserProfile = async (
  userId: string,
): Promise<{
  profile: UserProfile | null;
  error: Error | null;
}> => {
  try {
    // profiles table has RLS disabled – anon client works fine
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
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
  updates: Partial<UserProfile>,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    // profiles table has RLS disabled – anon client works fine
    const { error } = await supabase
      .from("profiles")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

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
export const getMedicalProfile = async (
  userId: string,
): Promise<{
  profile: MedicalProfile | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from("medical_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    return { profile: (data as MedicalProfile) ?? null, error: null };
  } catch (error) {
    return { profile: null, error: error as Error };
  }
};

/**
 * Create or update medical profile
 */
export const upsertMedicalProfile = async (
  userId: string,
  medicalData: Omit<
    MedicalProfile,
    "id" | "user_id" | "created_at" | "updated_at"
  >,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from("medical_profiles").upsert(
      {
        user_id: userId,
        blood_type: medicalData.blood_type,
        allergies: medicalData.allergies,
        medical_conditions: medicalData.medical_conditions || "",
        emergency_contact_name: medicalData.emergency_contact_name,
        emergency_contact_phone: medicalData.emergency_contact_phone,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );

    if (error) throw error;

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};
