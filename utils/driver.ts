import { supabase } from './supabase';

import { toPostGISPoint } from './emergency';

export interface DriverStatus {
  id: string;
  user_id: string;
  ambulance_id: string;
  status: 'available' | 'offline' | 'responding' | 'at_scene' | 'transporting' | 'at_hospital';
  updated_at: string;
}

export interface AmbulanceAssignment {
  id: string;
  ambulance_id: string;
  emergency_id: string;
  emergency_requests: {
    id: string;
    patient_id: string;
    patient_location?: string; // PostGIS geometry hex WKB
    emergency_type: string;
    description: string;
    status: string;
    created_at: string;
  };
  status: 'pending' | 'accepted' | 'declined';
  assigned_at: string;
}

const isMissingColumnError = (error: any, column: string): boolean => {
  const message = String(error?.message ?? '').toLowerCase();
  return error?.code === '42703' && message.includes(column.toLowerCase());
};

export interface AmbulanceDetails {
  id: string;
  vehicle_number: string;
  type: string | null;
  is_available: boolean;
  hospital_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get ambulance ID for a driver (DB column: current_driver_id)
 */
export const getDriverAmbulanceId = async (
  driverId: string
): Promise<{ ambulanceId: string | null; error: Error | null }> => {
  try {
    let { data, error } = await supabase
      .from('ambulances')
      .select('id')
      .eq('current_driver_id', driverId)
      .limit(1)
      .maybeSingle();

    // Legacy schema fallback: some projects still use different driver-link columns.
    if (error && isMissingColumnError(error, 'current_driver_id')) {
      const { data: legacyRows, error: legacyError } = await supabase
        .from('ambulances')
        .select('*')
        .limit(200);

      if (legacyError) {
        throw legacyError;
      }

      const legacyMatch = (legacyRows || []).find((row: any) => {
        const candidates = [
          row?.current_driver_id,
          row?.driver_id,
          row?.user_id,
          row?.driver_user_id,
          row?.assigned_driver_id,
        ];
        return candidates.some((value) => String(value ?? '') === driverId);
      });

      data = legacyMatch ? { id: legacyMatch.id } : null;
      error = null;
    }

    if (error) {
      throw error;
    }

    return { ambulanceId: data?.id ?? null, error: null };
  } catch (error) {
    console.error('Error fetching driver ambulance:', error);
    return { ambulanceId: null, error: error as Error };
  }
};

/**
 * Get full ambulance details for a driver
 */
export const getDriverAmbulanceDetails = async (
  driverId: string
): Promise<{ ambulance: AmbulanceDetails | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('ambulances')
      .select('id, vehicle_number, type, is_available, hospital_id, created_at, updated_at')
      .eq('current_driver_id', driverId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return { ambulance: data as AmbulanceDetails | null, error: null };
  } catch (error) {
    console.error('Error fetching ambulance details:', error);
    return { ambulance: null, error: error as Error };
  }
};

/**
 * Create or link an ambulance to a driver during registration
 */
export const upsertDriverAmbulance = async (
  driverId: string,
  vehicleNumber: string,
  type: string = 'standard'
): Promise<{ ambulanceId: string | null; error: Error | null }> => {
  try {
    const now = new Date().toISOString();

    // Check if an ambulance with this vehicle_number already exists
    const { data: existing } = await supabase
      .from('ambulances')
      .select('id')
      .eq('vehicle_number', vehicleNumber)
      .maybeSingle();

    if (existing) {
      // Link the driver to the existing ambulance
      const { error: updateErr } = await supabase
        .from('ambulances')
        .update({ current_driver_id: driverId, updated_at: now })
        .eq('id', existing.id);
      if (updateErr) throw updateErr;
      return { ambulanceId: existing.id, error: null };
    }

    // Insert new ambulance
    const { data: inserted, error: insertErr } = await supabase
      .from('ambulances')
      .insert({
        vehicle_number: vehicleNumber,
        type,
        current_driver_id: driverId,
        is_available: true,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;
    return { ambulanceId: inserted?.id ?? null, error: null };
  } catch (error) {
    console.error('Error upserting driver ambulance:', error);
    return { ambulanceId: null, error: error as Error };
  }
};

/**
 * Get driver's ambulance assignment
 */
export const getDriverAssignment = async (
  driverId: string
): Promise<{ assignment: AmbulanceAssignment | null; error: Error | null }> => {
  try {
    const { ambulanceId, error: ambulanceError } = await getDriverAmbulanceId(driverId);
    if (ambulanceError) {
      throw ambulanceError;
    }

    if (!ambulanceId) {
      return { assignment: null, error: null };
    }

    let data: any = null;
    let error: any = null;

    ({ data, error } = await supabase
      .from('emergency_assignments')
      .select(`
        *,
        emergency_requests(*)
      `)
      .eq('ambulance_id', ambulanceId)
      .eq('status', 'pending')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle());

    // Fallback for partially-migrated schemas missing emergency_assignments.status.
    if (error && (error.code === '42703' || String(error.message || '').toLowerCase().includes('status'))) {
      ({ data, error } = await supabase
        .from('emergency_assignments')
        .select(`
          *,
          emergency_requests(*)
        `)
        .eq('ambulance_id', ambulanceId)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (error) {
      throw error;
    }

    const assignment = data
      ? ({
          ...data,
          status: data.status ?? 'pending',
        } as AmbulanceAssignment)
      : null;

    return { assignment, error: null };
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
      .from('ambulances')
      .update({
        last_known_location: toPostGISPoint(latitude, longitude),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ambulanceId);

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
  let isClosed = false;
  let subscription: ReturnType<typeof supabase.channel> | null = null;

  void (async () => {
    const { ambulanceId, error } = await getDriverAmbulanceId(driverId);
    if (isClosed) return;

    if (error) {
      console.error('Failed to subscribe to assignments:', error);
      return;
    }

    if (!ambulanceId) {
      console.warn('No ambulance linked to this driver. Assignment subscription skipped.');
      return;
    }

    subscription = supabase
      .channel(`assignments:${ambulanceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emergency_assignments',
          filter: `ambulance_id=eq.${ambulanceId}`,
        },
        (payload: any) => {
          console.log('New assignment received:', payload.new);
          onAssignment({
            ...(payload.new as AmbulanceAssignment),
            status: payload.new.status ?? 'pending',
          });
        }
      )
      .subscribe();
  })();

  return () => {
    isClosed = true;
    subscription?.unsubscribe();
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
