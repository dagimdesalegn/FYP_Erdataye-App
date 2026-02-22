import { supabase } from './supabase';

export interface DriverStatus {
  id: string;
  user_id: string;
  ambulance_id: string;
  status: 'available' | 'offline' | 'responding' | 'at_scene' | 'transporting' | 'at_hospital';
  current_latitude: number;
  current_longitude: number;
  updated_at: string;
}

export interface AmbulanceAssignment {
  id: string;
  ambulance_id: string;
  emergency_id: string;
  emergency: {
    id: string;
    patient_id: string;
    latitude: number;
    longitude: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    status: string;
    created_at: string;
  };
  status: 'pending' | 'accepted' | 'declined';
  assigned_at: string;
}

/**
 * Get driver's ambulance assignment
 */
export const getDriverAssignment = async (
  driverId: string
): Promise<{ assignment: AmbulanceAssignment | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('emergency_assignments')
      .select(`
        *,
        emergency:emergency_requests(*)
      `)
      .eq('assigned_by', driverId)
      .eq('status', 'pending')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return { assignment: data as AmbulanceAssignment | null, error: null };
  } catch (error) {
    console.error('Error fetching driver assignment:', error);
    return { assignment: null, error: error as Error };
  }
};

/**
 * Accept emergency assignment
 */
export const acceptEmergency = async (
  assignmentId: string,
  emergencyId: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    // Update assignment status
    const { error: assignError } = await supabase
      .from('emergency_assignments')
      .update({ status: 'accepted' })
      .eq('id', assignmentId);

    if (assignError) {
      throw assignError;
    }

    // Update emergency status to 'assigned'
    const { error: emergencyError } = await supabase
      .from('emergency_requests')
      .update({ status: 'assigned' })
      .eq('id', emergencyId);

    if (emergencyError) {
      throw emergencyError;
    }

    console.log('Emergency accepted:', assignmentId);
    return { success: true, error: null };
  } catch (error) {
    console.error('Error accepting emergency:', error);
    return { success: false, error: error as Error };
  }
};

/**
 * Decline emergency assignment
 */
export const declineEmergency = async (
  assignmentId: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('emergency_assignments')
      .update({ status: 'declined' })
      .eq('id', assignmentId);

    if (error) {
      throw error;
    }

    console.log('Emergency declined:', assignmentId);
    return { success: true, error: null };
  } catch (error) {
    console.error('Error declining emergency:', error);
    return { success: false, error: error as Error };
  }
};

/**
 * Update emergency status (enroute, at_scene, transporting, at_hospital, closed)
 */
export const updateEmergencyStatus = async (
  emergencyId: string,
  status: 'pending' | 'assigned' | 'en_route' | 'at_scene' | 'transporting' | 'at_hospital' | 'completed' | 'cancelled'
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('emergency_requests')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', emergencyId);

    if (error) {
      throw error;
    }

    console.log(`Emergency status updated to ${status}:`, emergencyId);
    return { success: true, error: null };
  } catch (error) {
    console.error('Error updating emergency status:', error);
    return { success: false, error: error as Error };
  }
};

/**
 * Send live location update
 */
export const sendLocationUpdate = async (
  ambulanceId: string,
  latitude: number,
  longitude: number
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('ambulance_locations')
      .insert({
        ambulance_id: ambulanceId,
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      });

    if (error) {
      throw error;
    }

    return { success: true, error: null };
  } catch (error) {
    console.error('Error sending location update:', error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get patient info for assigned emergency
 */
export const getPatientInfo = async (
  patientId: string
): Promise<{
  info: any | null;
  error: Error | null;
}> => {
  try {
    if (!patientId) {
      return { info: null, error: new Error('Patient ID required') };
    }

    // Get profile with medical profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select(`
        *,
        medical_profiles(*)
      `)
      .eq('id', patientId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }

    const info = {
      id: profileData?.id,
      full_name: profileData?.full_name,
      phone: profileData?.phone,
      medical_profiles: profileData?.medical_profiles || [],
    };

    return { info, error: null };
  } catch (error) {
    console.error('Error fetching patient info:', error);
    return { info: null, error: error as Error };
  }
};

/**
 * Legacy function for backward compatibility - Get patient info and medical profile separately
 */
export const getPatientInfoLegacy = async (
  patientId: string
): Promise<{
  profile: any | null;
  medicalProfile: any | null;
  error: Error | null;
}> => {
  try {
    // Get profile
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', patientId)
      .single();

    if (profileError) {
      throw profileError;
    }

    // Get medical profile
    const { data: medicalData, error: medicalError } = await supabase
      .from('medical_profiles')
      .select('*')
      .eq('user_id', patientId)
      .single();

    if (medicalError && medicalError.code !== 'PGRST116') {
      throw medicalError;
    }

    return {
      profile: profileData,
      medicalProfile: medicalData || null,
      error: null,
    };
  } catch (error) {
    console.error('Error fetching patient info:', error);
    return { profile: null, medicalProfile: null, error: error as Error };
  }
};

/**
 * Get hospital details
 */
export const getHospitalInfo = async (
  hospitalId: string
): Promise<{ hospital: any | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('hospitals')
      .select('*')
      .eq('id', hospitalId)
      .single();

    if (error) {
      throw error;
    }

    return { hospital: data, error: null };
  } catch (error) {
    console.error('Error fetching hospital info:', error);
    return { hospital: null, error: error as Error };
  }
};

/**
 * Subscribe to incoming assignments for driver
 */
export const subscribeToAssignments = (
  driverId: string,
  onAssignment: (assignment: AmbulanceAssignment) => void
) => {
  const subscription = supabase
    .channel(`assignments:${driverId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'emergency_assignments',
        filter: `assigned_by=eq.${driverId}`,
      },
      (payload: any) => {
        console.log('New assignment received:', payload.new);
        onAssignment(payload.new as AmbulanceAssignment);
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
};

/**
 * Subscribe to emergency status updates
 */
export const subscribeToEmergencyStatus = (
  emergencyId: string,
  onUpdate: (status: string) => void
) => {
  const subscription = supabase
    .channel(`emergency:${emergencyId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'emergency_requests',
        filter: `id=eq.${emergencyId}`,
      },
      (payload: any) => {
        console.log('Emergency status updated:', payload.new.status);
        onUpdate(payload.new.status);
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
};
