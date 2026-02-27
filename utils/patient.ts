/**
 * Patient Emergency Management Utilities
 * Complete workflow for patients to create and track emergencies
 *
 * DB columns used:
 *   emergency_requests: patient_id, patient_location (geometry), emergency_type,
 *                       description, status, assigned_ambulance_id, hospital_id
 *   ambulances: vehicle_number, type, current_driver_id, is_available,
 *               last_known_location (geometry), hospital_id
 *   hospitals: name, address, location (geometry), phone
 */

import { supabase } from './supabase';
import { parsePostGISPoint, toPostGISPoint } from './emergency';

// ─── Interfaces aligned with actual DB schema ────────────────────────

export interface PatientEmergency {
  id: string;
  patient_id: string;
  status: 'pending' | 'assigned' | 'en_route' | 'arrived' | 'at_hospital' | 'completed' | 'cancelled';
  emergency_type: string;
  description?: string;
  assigned_ambulance_id?: string;
  hospital_id?: string;
  patient_location?: string; // raw PostGIS hex WKB
  /** Computed from patient_location geometry */
  latitude: number;
  /** Computed from patient_location geometry */
  longitude: number;
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
  status?: string;
}

export interface AmbulanceInfo {
  id: string;
  vehicle_number: string;
  type: string;
  current_driver_id: string;
  is_available: boolean;
  hospital_id?: string;
  last_known_location?: string;
}

export interface HospitalInfo {
  id: string;
  name: string;
  address: string;
  phone: string;
  location?: string; // raw PostGIS hex WKB
}

// ─── Helpers ─────────────────────────────────────────────────────────

const normalizeEmergency = (raw: any): PatientEmergency => {
  const parsed = parsePostGISPoint(raw?.patient_location);
  return {
    ...raw,
    emergency_type: raw?.emergency_type ?? 'medical',
    latitude: parsed?.latitude ?? 0,
    longitude: parsed?.longitude ?? 0,
    status: (raw?.status ?? 'pending') as PatientEmergency['status'],
    created_at: raw?.created_at ?? new Date().toISOString(),
    updated_at: raw?.updated_at ?? raw?.created_at ?? new Date().toISOString(),
  } as PatientEmergency;
};

// ─── CRUD functions ──────────────────────────────────────────────────

/**
 * Create an emergency request as a patient.
 *
 * @param patientId   The patient's user ID
 * @param latitude    Emergency location latitude
 * @param longitude   Emergency location longitude
 * @param emergencyType Type / severity of emergency (stored in emergency_type column)
 * @param description Brief description of emergency
 */
export const createEmergency = async (
  patientId: string,
  latitude: number,
  longitude: number,
  emergencyType: string = 'medical',
  description?: string
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    if (!patientId || latitude === undefined || longitude === undefined) {
      throw new Error('Missing required fields: patientId, latitude, longitude');
    }

    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from('emergency_requests')
      .insert({
        patient_id: patientId,
        patient_location: toPostGISPoint(latitude, longitude),
        emergency_type: emergencyType,
        status: 'pending',
        description: description || null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select()
      .single();

    if (error) throw error;

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
    const { data, error } = await supabase
      .from('emergency_requests')
      .select('*')
      .eq('patient_id', patientId)
      .in('status', ['pending', 'assigned', 'en_route', 'arrived'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

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

    if (error) throw error;

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

    if (emergencyError) throw emergencyError;

    // Get assignment
    const { data: assignmentData } = await supabase
      .from('emergency_assignments')
      .select('*')
      .eq('emergency_id', emergencyId)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single();

    let ambulance: AmbulanceInfo | null = null;
    if (assignmentData) {
      const { data: ambulanceData } = await supabase
        .from('ambulances')
        .select('*')
        .eq('id', assignmentData.ambulance_id)
        .single();

      ambulance = ambulanceData as AmbulanceInfo | null;
    }

    return {
      emergency: emergencyData ? normalizeEmergency(emergencyData) : null,
      assignment: assignmentData
        ? ({ ...assignmentData, status: assignmentData.status ?? 'pending' } as EmergencyAssignment)
        : null,
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

    if (error) throw error;

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
  _latitude: number,
  _longitude: number,
  _radiusKm: number = 5
): Promise<{ hospitals: HospitalInfo[]; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('hospitals')
      .select('*')
      .limit(10);

    if (error) throw error;

    return { hospitals: (data || []) as HospitalInfo[], error: null };
  } catch (error) {
    console.error('Error fetching nearby hospitals:', error);
    return { hospitals: [], error: error as Error };
  }
};

/**
 * Get available ambulances (DB column: is_available boolean)
 */
export const getAvailableAmbulances = async (): Promise<{
  ambulances: AmbulanceInfo[];
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('ambulances')
      .select('*')
      .eq('is_available', true)
      .order('updated_at', { ascending: false });

    if (error) throw error;

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
        onUpdate(normalizeEmergency(payload.new));
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
};

/**
 * Subscribe to ambulance location updates (listens on ambulances table,
 * so we track changes to last_known_location).
 */
export const subscribeToAmbulanceLocation = (
  ambulanceId: string,
  onUpdate: (latitude: number, longitude: number) => void
) => {
  const subscription = supabase
    .channel(`ambulance_location:${ambulanceId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'ambulances',
        filter: `id=eq.${ambulanceId}`,
      },
      (payload: any) => {
        const parsed = parsePostGISPoint(payload.new?.last_known_location);
        if (parsed) {
          onUpdate(parsed.latitude, parsed.longitude);
        }
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
};

/**
 * Helper: Calculate distance between two coordinates (in km)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
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
