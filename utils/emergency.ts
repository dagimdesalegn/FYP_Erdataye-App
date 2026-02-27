import { supabase } from './supabase';

// ─── PostGIS helpers ─────────────────────────────────────────────────

/** Build an EWKT Point string suitable for Supabase inserts into geometry columns. */
export function toPostGISPoint(latitude: number, longitude: number): string {
  return `SRID=4326;POINT(${longitude} ${latitude})`;
}

/**
 * Parse a hex-encoded WKB / EWKB Point (as returned by Supabase for geometry
 * columns) into { latitude, longitude }.  Also accepts GeoJSON objects.
 */
export function parsePostGISPoint(
  geometry: any
): { latitude: number; longitude: number } | null {
  if (!geometry) return null;

  // GeoJSON object
  if (typeof geometry === 'object' && geometry.coordinates) {
    return { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
  }

  if (typeof geometry !== 'string') return null;

  try {
    const hex = geometry;
    const buf = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      buf[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    const dv = new DataView(buf.buffer);
    const le = buf[0] === 1;
    let offset = 1;
    const wkbType = dv.getUint32(offset, le);
    offset += 4;
    if (wkbType & 0x20000000) offset += 4; // skip SRID
    const lon = dv.getFloat64(offset, le);
    const lat = dv.getFloat64(offset + 8, le);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { latitude: lat, longitude: lon };
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Interfaces aligned with actual DB schema ────────────────────────

export interface EmergencyRequest {
  id: string;
  patient_id: string;
  status: 'pending' | 'assigned' | 'en_route' | 'arrived' | 'at_hospital' | 'completed' | 'cancelled';
  emergency_type: string;
  description: string;
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

export interface Ambulance {
  id: string;
  vehicle_number: string;
  type: string;
  current_driver_id: string;
  is_available: boolean;
  hospital_id?: string;
  last_known_location?: string; // raw PostGIS hex WKB
  created_at: string;
  updated_at: string;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  phone: string;
  location?: string; // raw PostGIS hex WKB
  created_at: string;
}

// ─── Normalizers ─────────────────────────────────────────────────────

/** Normalize a raw emergency_requests row into our EmergencyRequest interface. */
export function normalizeEmergency(raw: any): EmergencyRequest {
  const parsed = parsePostGISPoint(raw?.patient_location);
  return {
    ...raw,
    emergency_type: raw?.emergency_type ?? 'medical',
    latitude: parsed?.latitude ?? 0,
    longitude: parsed?.longitude ?? 0,
  } as EmergencyRequest;
}

/** Normalize a raw ambulances row. */
function normalizeAmbulance(raw: any): Ambulance {
  return {
    ...raw,
    is_available: raw?.is_available ?? true,
    current_driver_id: raw?.current_driver_id ?? '',
  } as Ambulance;
}

// ─── CRUD functions ──────────────────────────────────────────────────

/**
 * Create a new emergency request
 */
export const createEmergencyRequest = async (
  patientId: string,
  latitude: number,
  longitude: number,
  description: string,
  emergencyType: string = 'medical'
): Promise<{ request: EmergencyRequest | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from('emergency_requests')
      .insert({
        patient_id: patientId,
        patient_location: toPostGISPoint(latitude, longitude),
        description,
        emergency_type: emergencyType,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    return { request: normalizeEmergency(data), error: null };
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

    if (error) throw error;

    return { requests: (data || []).map(normalizeEmergency), error: null };
  } catch (error) {
    return { requests: null, error: error as Error };
  }
};

/**
 * Find nearest available ambulance (uses PostGIS DB function).
 * Returns a single ambulance UUID or null.
 */
export const findNearestAmbulance = async (
  latitude: number,
  longitude: number,
  maxRadiusKm: number = 10
): Promise<{ ambulanceId: string | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase.rpc('find_nearest_available_ambulance', {
      patient_location: toPostGISPoint(latitude, longitude),
      max_radius_km: maxRadiusKm,
    });

    if (error) throw error;

    return { ambulanceId: data as string | null, error: null };
  } catch (error) {
    return { ambulanceId: null, error: error as Error };
  }
};

/**
 * Assign ambulance to emergency request (DB column: assigned_ambulance_id)
 */
export const assignAmbulance = async (
  emergencyId: string,
  ambulanceId: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from('emergency_requests')
      .update({
        assigned_ambulance_id: ambulanceId,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', emergencyId);

    if (error) throw error;

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

    if (error) throw error;

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Get all available ambulances (DB column: is_available boolean)
 */
export const getAvailableAmbulances = async (): Promise<{
  ambulances: Ambulance[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('ambulances')
      .select('*')
      .eq('is_available', true);

    if (error) throw error;

    return { ambulances: (data || []).map(normalizeAmbulance), error: null };
  } catch (error) {
    return { ambulances: null, error: error as Error };
  }
};

/**
 * Get all hospitals
 */
export const getHospitals = async (): Promise<{
  hospitals: Hospital[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase.from('hospitals').select('*');

    if (error) throw error;

    return { hospitals: data as Hospital[], error: null };
  } catch (error) {
    return { hospitals: null, error: error as Error };
  }
};

/**
 * Subscribe to real-time location updates for an emergency
 */
export const subscribeToLocationUpdates = (
  emergencyId: string,
  callback: (locations: any[]) => void
) => {
  const subscription = supabase
    .channel(`location_updates:${emergencyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'location_updates',
        filter: `emergency_request_id=eq.${emergencyId}`,
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
 * Update ambulance location (writes to ambulances.last_known_location)
 */
export const updateAmbulanceLocation = async (
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

    if (error) throw error;

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};
