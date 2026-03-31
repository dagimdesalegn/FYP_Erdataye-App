import { backendGet, backendPut } from "./api";
import { supabase } from "./supabase";

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string;
  role: "patient" | "ambulance" | "driver" | "hospital" | "admin";
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
 * Get user profile — backend first, Supabase fallback.
 */
export const getUserProfile = async (
  userId: string,
): Promise<{
  profile: UserProfile | null;
  error: Error | null;
}> => {
  try {
    try {
      const data = await backendGet<UserProfile>("/profiles/me");
      if (data) return { profile: data, error: null };
    } catch { /* fall through */ }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return { profile: data as UserProfile | null, error: null };
  } catch (error) {
    return { profile: null, error: error as Error };
  }
};

/**
 * Update user profile — backend first, Supabase fallback.
 */
export const updateUserProfile = async (
  userId: string,
  updates: Partial<UserProfile>,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    try {
      await backendPut("/profiles/me", updates);
      return { success: true, error: null };
    } catch { /* fall through */ }

    const { error } = await supabase
      .from("profiles")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Get medical profile — backend first, Supabase fallback.
 */
export const getMedicalProfile = async (
  userId: string,
): Promise<{
  profile: MedicalProfile | null;
  error: Error | null;
}> => {
  try {
    try {
      const data = await backendGet<MedicalProfile | null>("/profiles/medical");
      if (data) return { profile: data, error: null };
    } catch { /* fall through */ }

    const { data, error } = await supabase
      .from("medical_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { profile: data as MedicalProfile | null, error: null };
  } catch (error) {
    return { profile: null, error: error as Error };
  }
};

/**
 * Create or update medical profile — backend first, Supabase fallback.
 */
export const upsertMedicalProfile = async (
  userId: string,
  medicalData: Omit<
    MedicalProfile,
    "id" | "user_id" | "created_at" | "updated_at"
  >,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    try {
      await backendPut("/profiles/medical", medicalData);
      return { success: true, error: null };
    } catch { /* fall through */ }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("medical_profiles")
      .upsert(
        { ...medicalData, user_id: userId, updated_at: now },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};
