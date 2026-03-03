import { supabase, supabaseAdmin } from './supabase';

// ─── PostGIS helpers ─────────────────────────────────────────────────

/**
 * Format coordinates as human-readable directional text.
 * e.g. 9.02, 38.75 → "9.0200° N, 38.7500° E"
 */
export function formatCoords(lat: number, lng: number, decimals: number = 4): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(decimals)}° ${ns}, ${Math.abs(lng).toFixed(decimals)}° ${ew}`;
}

/**
 * Build a Google Maps embed URL for a single location marker.
 * Returns a direct URL suitable for iframe src – no CORS issues.
 */
export function buildMapHtml(lat: number, lng: number, zoom: number = 17): string {
  return `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`;
}

/**
 * Build a Google Maps embed URL showing the driver → patient area.
 * Calculates the midpoint and an appropriate zoom level based on the
 * distance between the two locations so the iframe actually zooms in
 * instead of showing the entire world.
 */
export function buildDriverPatientMapHtml(
  driverLat: number, driverLng: number,
  patientLat: number, patientLng: number,
  _options?: { blueLabel?: string; redLabel?: string; bluePopup?: string; redPopup?: string },
): string {
  // Calculate midpoint
  const midLat = (driverLat + patientLat) / 2;
  const midLng = (driverLng + patientLng) / 2;

  // Calculate distance between points (km) to pick zoom
  const dist = calculateDistance(driverLat, driverLng, patientLat, patientLng);

  let zoom: number;
  if (dist < 0.5) zoom = 16;       // < 500 m  – street level
  else if (dist < 2) zoom = 15;    // < 2 km   – neighbourhood
  else if (dist < 5) zoom = 14;    // < 5 km   – city area
  else if (dist < 10) zoom = 13;   // < 10 km  – city wide
  else if (dist < 20) zoom = 12;   // < 20 km  – metro area
  else if (dist < 50) zoom = 11;   // < 50 km  – region
  else zoom = 10;                  // far apart

  // Use the patient location as the query pin, centered on the midpoint
  return `https://maps.google.com/maps?q=${patientLat},${patientLng}&ll=${midLat},${midLng}&z=${zoom}&output=embed`;
}

/**
 * Build a Google Maps embed URL centered on the patient location.
 * Returns a direct URL suitable for iframe src – no CORS issues.
 */
export function buildPatientRequestMapHtml(
  patientLat: number, patientLng: number,
  _ambulances: { lat: number; lng: number; label?: string }[],
): string {
  return `https://maps.google.com/maps?q=${patientLat},${patientLng}&z=16&output=embed`;
}

/**
 * @deprecated No longer needed – map functions now return direct Google Maps embed URLs.
 * Kept for backward compatibility; simply returns the input unchanged.
 */
export function mapHtmlToBlobUrl(url: string): string {
  return url;
}

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
  status: 'pending' | 'assigned' | 'en_route' | 'at_scene' | 'arrived' | 'transporting' | 'at_hospital' | 'completed' | 'cancelled';
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
 * Find nearest available ambulance.
 * 1) Tries the PostGIS DB function first (server-side, most accurate).
 * 2) Falls back to client-side Haversine calculation over all available ambulances.
 *
 * @param latitude      Patient latitude
 * @param longitude     Patient longitude
 * @param maxRadiusKm   Maximum search radius in km (default 50 km)
 */
export const findNearestAmbulance = async (
  latitude: number,
  longitude: number,
  maxRadiusKm: number = 50
): Promise<{ ambulanceId: string | null; distanceKm: number | null; error: Error | null }> => {
  try {
    // Attempt server-side PostGIS lookup first
    const { data, error: rpcError } = await supabase.rpc('find_nearest_available_ambulance', {
      patient_location: toPostGISPoint(latitude, longitude),
      max_radius_km: maxRadiusKm,
    });

    if (!rpcError && data) {
      return { ambulanceId: data as string, distanceKm: null, error: null };
    }

    // Fallback: client-side distance calculation
    const { ambulances } = await getAvailableAmbulances();
    if (!ambulances || ambulances.length === 0) {
      return { ambulanceId: null, distanceKm: null, error: new Error('No available ambulances') };
    }

    let closestId: string | null = null;
    let closestDistance = Infinity;

    for (const amb of ambulances) {
      const loc = parsePostGISPoint(amb.last_known_location);
      if (!loc) continue;

      const dist = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
      if (dist < closestDistance && dist <= maxRadiusKm) {
        closestDistance = dist;
        closestId = amb.id;
      }
    }

    if (!closestId) {
      return { ambulanceId: null, distanceKm: null, error: new Error(`No ambulances within ${maxRadiusKm}km`) };
    }

    return { ambulanceId: closestId, distanceKm: Math.round(closestDistance * 10) / 10, error: null };
  } catch (error) {
    return { ambulanceId: null, distanceKm: null, error: error as Error };
  }
};

/**
 * Assign ambulance to emergency request.
 * - Updates emergency_requests.assigned_ambulance_id & status
 * - Inserts a row into emergency_assignments so drivers are notified via realtime
 * - Marks the ambulance as unavailable
 */
export const assignAmbulance = async (
  emergencyId: string,
  ambulanceId: string
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const now = new Date().toISOString();

    // 1. Update emergency request (use admin to bypass RLS)
    const { error } = await supabaseAdmin
      .from('emergency_requests')
      .update({
        assigned_ambulance_id: ambulanceId,
        status: 'assigned',
        updated_at: now,
      })
      .eq('id', emergencyId);

    if (error) throw error;

    // 2. Insert into emergency_assignments (triggers driver realtime subscription)
    const { error: assignError } = await supabaseAdmin
      .from('emergency_assignments')
      .insert({
        emergency_id: emergencyId,
        ambulance_id: ambulanceId,
        status: 'pending',
        assigned_at: now,
      });

    if (assignError) {
      console.warn('Failed to insert emergency_assignment (non-blocking):', assignError);
    }

    // 3. Mark ambulance as unavailable
    await supabaseAdmin
      .from('ambulances')
      .update({ is_available: false, updated_at: now })
      .eq('id', ambulanceId);

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

/**
 * Calculate distance between two coordinates using Haversine formula (in km)
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
