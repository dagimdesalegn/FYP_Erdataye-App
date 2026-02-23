/**
 * Patient Emergency Management Utilities
 * Complete workflow for patients to create and track emergencies
 */

import { supabase } from './supabase';

export interface PatientEmergency {
  id: string;
  patient_id: string;
  latitude: number;
  longitude: number;
  status: 'pending' | 'assigned' | 'en_route' | 'arrived' | 'at_hospital' | 'completed' | 'cancelled';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  patient_condition?: string;
  created_at: string;
  updated_at: string;
}

export interface EmergencyAssignment {
  id: string;
  emergency_id: string;
  ambulance_id: string;
  assigned_at: string;
  pickup_eta_minutes?: number;
  completed_at?: string;
  notes?: string;
}

export interface AmbulanceInfo {
  id: string;
  vehicle_number: string;
  driver_id: string;
  status: string;
  current_latitude: number;
  current_longitude: number;
  capacity: number;
}

export interface HospitalInfo {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  emergency_beds: number;
  specialties: string[];
}

const toNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
};

const isMissingColumnError = (error: any, column: string): boolean => {
  const message = String(error?.message ?? '').toLowerCase();
  return error?.code === 'PGRST204' && message.includes(`'${column.toLowerCase()}'`);
};

const normalizeEmergency = (raw: any): PatientEmergency => {
  const location = raw?.location && typeof raw.location === 'object' ? raw.location : null;

  return {
    ...raw,
    latitude: toNumber(
      raw?.latitude ??
        raw?.location_lat ??
        raw?.lat ??
        location?.lat ??
        location?.latitude
    ),
    longitude: toNumber(
      raw?.longitude ??
        raw?.location_lon ??
        raw?.location_lng ??
        raw?.lon ??
        raw?.lng ??
        location?.lon ??
        location?.lng ??
        location?.longitude
    ),
    status: (raw?.status ?? 'pending') as PatientEmergency['status'],
    severity: (raw?.severity ?? 'medium') as PatientEmergency['severity'],
    created_at: raw?.created_at ?? new Date().toISOString(),
    updated_at: raw?.updated_at ?? raw?.created_at ?? new Date().toISOString(),
  } as PatientEmergency;
};

/**
 * Create an emergency request as a patient
 * @param patientId The patient's user ID
 * @param latitude Emergency location latitude
 * @param longitude Emergency location longitude
 * @param severity Emergency severity level
 * @param description Brief description of emergency
 * @param patientCondition Patient's current condition
 */
export const createEmergency = async (
  patientId: string,
  latitude: number,
  longitude: number,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  description?: string,
  patientCondition?: string
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    if (!patientId || latitude === undefined || longitude === undefined) {
      throw new Error('Missing required fields: patientId, latitude, longitude');
    }

    const timestamp = new Date().toISOString();
    const primaryPayload = {
      patient_id: patientId,
      latitude,
      longitude,
      severity,
      status: 'pending',
      description,
      patient_condition: patientCondition,
      created_at: timestamp,
      updated_at: timestamp,
    };

    let { data, error } = await supabase
      .from('emergency_requests')
      .insert(primaryPayload)
      .select()
      .single();

    // Fallback for legacy schemas that store coordinates in a `location` object.
    if (
      error &&
      (isMissingColumnError(error, 'latitude') || isMissingColumnError(error, 'longitude'))
    ) {
      const legacyPayload = {
        patient_id: patientId,
        location: { lat: latitude, lon: longitude },
        severity,
        status: 'pending',
        description,
        patient_condition: patientCondition,
        created_at: timestamp,
        updated_at: timestamp,
      };

      ({ data, error } = await supabase
        .from('emergency_requests')
        .insert(legacyPayload)
        .select()
        .single());
    }

    if (error) {
      if (
        isMissingColumnError(error, 'latitude') ||
        isMissingColumnError(error, 'longitude')
      ) {
        throw new Error(
          'Database schema is outdated for emergency_requests. Run migrations/003_emergency_requests_location_hotfix.sql in Supabase SQL Editor.'
        );
      }
      throw error;
    }

    return { emergency: normalizeEmergency(data), error: null };
  } catch (error) {
    console.error('Error creating emergency:', error);
    return { emergency: null, error: error as Error };
  }
};

/**
 * Get patient's current active emergency
 */
export const getActiveEmergency = async (
  patientId: string
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    let { data, error } = await supabase
      .from('emergency_requests')
      .select('*')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'assigned', 'en_route', 'arrived'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Legacy fallback if `status` column is missing.
    if (error && isMissingColumnError(error, 'status')) {
      ({ data, error } = await supabase
        .from('emergency_requests')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single());
    }

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      throw error;
    }

    return { emergency: data ? normalizeEmergency(data) : null, error: null };
  } catch (error) {
    console.error('Error fetching active emergency:', error);
    return { emergency: null, error: error as Error };
  }
};

/**
 * Get all emergencies for a patient
 */
export const getPatientEmergencies = async (
  patientId: string,
  limit: number = 50
): Promise<{ emergencies: PatientEmergency[]; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('emergency_requests')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return {
      emergencies: (data || []).map((item: any) => normalizeEmergency(item)),
      error: null,
    };
  } catch (error) {
    console.error('Error fetching patient emergencies:', error);
    return { emergencies: [], error: error as Error };
  }
};

/**
 * Get emergency details with assignment and ambulance info
 */
export const getEmergencyDetails = async (
  emergencyId: string
): Promise<{
  emergency: PatientEmergency | null;
  assignment: EmergencyAssignment | null;
  ambulance: AmbulanceInfo | null;
  error: Error | null;
}> => {
  try {
    // Get emergency
    const { data: emergencyData, error: emergencyError } = await supabase
      .from('emergency_requests')
      .select('*')
      .eq('id', emergencyId)
      .single();

    if (emergencyError) {
      throw emergencyError;
    }

    // Get assignment
    const { data: assignmentData, error: assignmentError } = await supabase
      .from('emergency_assignments')
      .select('*')
      .eq('emergency_id', emergencyId)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single();

    let ambulance = null;
    if (assignmentData) {
      const { data: ambulanceData } = await supabase
        .from('ambulances')
        .select('*')
        .eq('id', assignmentData.ambulance_id)
        .single();

      ambulance = ambulanceData as AmbulanceInfo;
    }

    return {
      emergency: emergencyData ? normalizeEmergency(emergencyData) : null,
      assignment: assignmentData as EmergencyAssignment | null,
      ambulance,
      error: null,
    };
  } catch (error) {
    console.error('Error fetching emergency details:', error);
    return { emergency: null, assignment: null, ambulance: null, error: error as Error };
  }
};

/**
 * Update emergency status (patient can cancel)
 */
export const updateEmergencyStatus = async (
  emergencyId: string,
  status: 'pending' | 'cancelled' | 'completed'
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
    console.error('Error updating emergency status:', error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get nearby hospitals
 */
export const getNearbyHospitals = async (
  latitude: number,
  longitude: number,
  radiusKm: number = 5
): Promise<{ hospitals: HospitalInfo[]; error: Error | null }> => {
  try {
    // Simple distance calculation (can be improved with PostGIS)
    const { data, error } = await supabase
      .from('hospitals')
      .select('*')
      .limit(10); // Get 10 nearest, we'll filter client-side

    if (error) {
      throw error;
    }

    // Calculate distance and filter
    const hospitals = (data || [])
      .map((h: any) => ({
        ...h,
        distance: calculateDistance(latitude, longitude, h.latitude, h.longitude),
      }))
      .filter((h: any) => h.distance <= radiusKm)
      .sort((a: any, b: any) => a.distance - b.distance)
      .map(({ distance, ...h }: any) => h as HospitalInfo);

    return { hospitals, error: null };
  } catch (error) {
    console.error('Error fetching nearby hospitals:', error);
    return { hospitals: [], error: error as Error };
  }
};

/**
 * Get available ambulances
 */
export const getAvailableAmbulances = async (): Promise<{
  ambulances: AmbulanceInfo[];
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('ambulances')
      .select('*')
      .eq('status', 'available')
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    return { ambulances: (data || []) as AmbulanceInfo[], error: null };
  } catch (error) {
    console.error('Error fetching available ambulances:', error);
    return { ambulances: [], error: error as Error };
  }
};

/**
 * Subscribe to emergency status updates
 */
export const subscribeToEmergency = (
  emergencyId: string,
  onUpdate: (emergency: PatientEmergency) => void
) => {
  const subscription = supabase
    .channel(`emergency_requests:${emergencyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'emergency_requests',
        filter: `id=eq.${emergencyId}`,
      },
      (payload: any) => {
        onUpdate(payload.new as PatientEmergency);
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
};

/**
 * Subscribe to ambulance location updates
 */
export const subscribeToAmbulanceLocation = (
  ambulanceId: string,
  onUpdate: (latitude: number, longitude: number) => void
) => {
  const subscription = supabase
    .channel(`ambulance_locations:${ambulanceId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'ambulance_locations',
        filter: `ambulance_id=eq.${ambulanceId}`,
      },
      (payload: any) => {
        const data = payload.new as any;
        onUpdate(data.latitude, data.longitude);
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
};

/**
 * Helper function: Calculate distance between two coordinates (in km)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
