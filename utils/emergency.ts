import { supabase } from './supabase';

export interface EmergencyRequest {
  id: string;
  patient_id: string;
  status: 'pending' | 'assigned' | 'en_route' | 'arrived' | 'at_hospital' | 'completed' | 'cancelled';
  latitude: number;
  longitude: number;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ambulance_id?: string;
  hospital_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Ambulance {
  id: string;
  vehicle_number: string;
  driver_id: string;
  status: 'available' | 'on_call' | 'in_service' | 'maintenance';
  latitude: number;
  longitude: number;
  created_at: string;
  updated_at: string;
}

export interface Hospital {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  phone: string;
  address: string;
  created_at: string;
}

/**
 * Create a new emergency request
 */
export const createEmergencyRequest = async (
  patientId: string,
  latitude: number,
  longitude: number,
  description: string,
  severity: 'low' | 'medium' | 'high' | 'critical'
): Promise<{ request: EmergencyRequest | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.from('emergency_requests').insert({
      patient_id: patientId,
      latitude,
      longitude,
      description,
      severity,
      status: 'pending',
    }).select().single();

    if (error) {
      throw error;
    }

    return { request: data as EmergencyRequest, error: null };
  } catch (error) {
    return { request: null, error: error as Error };
  }
};

/**
 * Get all emergency requests for a patient
 */
export const getPatientEmergencies = async (
  patientId: string
): Promise<{ requests: EmergencyRequest[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('emergency_requests')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return { requests: data as EmergencyRequest[], error: null };
  } catch (error) {
    return { requests: null, error: error as Error };
  }
};

/**
 * Find nearest available ambulances (uses PostGIS)
 */
export const findNearestAmbulances = async (
  latitude: number,
  longitude: number,
  maxDistance = 10000 // 10km in meters
): Promise<{ ambulances: Ambulance[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.rpc('find_nearest_available_ambulance', {
      patient_lat: latitude,
      patient_lon: longitude,
      dist: maxDistance,
    });

    if (error) {
      throw error;
    }

    return { ambulances: data as Ambulance[], error: null };
  } catch (error) {
    return { ambulances: null, error: error as Error };
  }
};

/**
 * Assign ambulance to emergency request
 */
export const assignAmbulance = async (
  emergencyId: string,
  ambulanceId: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('emergency_requests')
      .update({
        ambulance_id: ambulanceId,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', emergencyId);

    if (error) {
      throw error;
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Update emergency request status
 */
export const updateEmergencyStatus = async (
  emergencyId: string,
  status: EmergencyRequest['status']
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

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Get all available ambulances
 */
export const getAvailableAmbulances = async (): Promise<{
  ambulances: Ambulance[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('ambulances')
      .select('*')
      .eq('status', 'available');

    if (error) {
      throw error;
    }

    return { ambulances: data as Ambulance[], error: null };
  } catch (error) {
    return { ambulances: null, error: error as Error };
  }
};

/**
 * Get all hospitals
 */
export const getHospitals = async (): Promise<{ hospitals: Hospital[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.from('hospitals').select('*');

    if (error) {
      throw error;
    }

    return { hospitals: data as Hospital[], error: null };
  } catch (error) {
    return { hospitals: null, error: error as Error };
  }
};

/**
 * Subscribe to real-time location updates
 */
export const subscribeToLocationUpdates = (
  emergencyId: string,
  callback: (locations: any[]) => void
) => {
  const subscription = supabase
    .channel(`location_updates:emergency_id=eq.${emergencyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'location_updates',
        filter: `emergency_id=eq.${emergencyId}`,
      },
      (payload: any) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          callback([payload.new]);
        }
      }
    )
    .subscribe();

  return subscription;
};

/**
 * Update ambulance location
 */
export const updateAmbulanceLocation = async (
  ambulanceId: string,
  latitude: number,
  longitude: number,
  emergencyId?: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase.from('location_updates').insert({
      ambulance_id: ambulanceId,
      emergency_id: emergencyId,
      latitude,
      longitude,
      timestamp: new Date().toISOString(),
    });

    if (error) {
      throw error;
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};
