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
 * Build a self-contained Leaflet HTML map as a data URI.
 * - No external buttons / "View Larger Map"
 * - One-finger drag, two-finger pinch zoom
 * - Roadmap only: buildings, roads, landmarks (OpenStreetMap tiles)
 * - Red marker on the given coordinates
 */
export function buildMapHtml(lat: number, lng: number, zoom: number = 17): string {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>*{margin:0;padding:0}html,body,#map{width:100%;height:100%}
.leaflet-control-attribution{font-size:9px!important;opacity:0.7}</style></head>
<body><div id="map"></div><script>
var map=L.map('map',{zoomControl:true,attributionControl:true,dragging:true,touchZoom:true,scrollWheelZoom:true,doubleClickZoom:true,boxZoom:true}).setView([${lat},${lng}],${zoom});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
L.marker([${lat},${lng}]).addTo(map).bindPopup('📍 Your location').openPopup();
<\/script></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/**
 * Build a Leaflet HTML map showing two markers (driver + patient) with a
 * dashed route line between them and auto-fit bounds. Uses road-style tiles.
 */
export function buildDriverPatientMapHtml(
  driverLat: number, driverLng: number,
  patientLat: number, patientLng: number,
  options?: { blueLabel?: string; redLabel?: string; bluePopup?: string; redPopup?: string },
): string {
  const blueLabel = options?.blueLabel ?? 'You';
  const redLabel = options?.redLabel ?? 'Patient';
  const bluePopup = options?.bluePopup ?? '🚑 You';
  const redPopup = options?.redPopup ?? '🆘 Patient';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%}
.leaflet-control-attribution{font-size:8px!important;opacity:0.6}
.custom-label{background:none;border:none;font-weight:700;font-size:12px;white-space:nowrap;text-shadow:0 1px 3px #fff,0 -1px 3px #fff,1px 0 3px #fff,-1px 0 3px #fff}
</style></head>
<body><div id="map"></div><script>
var map=L.map('map',{zoomControl:true,attributionControl:true,dragging:true,touchZoom:true,scrollWheelZoom:true,doubleClickZoom:true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var driverIcon=L.divIcon({className:'',html:'<div style="background:#0EA5E9;width:32px;height:32px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"#fff\\"><path d=\\"M18.9 6c-.2-.6-.8-1-1.4-1h-2l.7-1.4C16.5 3 16.1 2.3 15.5 2H8.5c-.6.3-1 1-1 1.6L8.5 5h-2c-.7 0-1.2.4-1.4 1L4 10v8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h10v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-8l-1.1-4zM6.5 15c-.8 0-1.5-.7-1.5-1.5S5.7 12 6.5 12s1.5.7 1.5 1.5S7.3 15 6.5 15zm11 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zM5 10l1.5-4.5h11L19 10H5z\\"/></svg></div>',iconSize:[32,32],iconAnchor:[16,16]});
var patientIcon=L.divIcon({className:'',html:'<div style="background:#DC2626;width:36px;height:36px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);animation:pulse 1.5s infinite"><svg width=\\"18\\" height=\\"18\\" viewBox=\\"0 0 24 24\\" fill=\\"#fff\\"><path d=\\"M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5s1.1-2.5 2.5-2.5 2.5 1.1 2.5 2.5-1.1 2.5-2.5 2.5z\\"/></svg></div><style>@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}</style>',iconSize:[36,36],iconAnchor:[18,18]});
L.marker([${driverLat},${driverLng}],{icon:driverIcon}).addTo(map).bindPopup('<b>${bluePopup}</b>');
L.marker([${patientLat},${patientLng}],{icon:patientIcon}).addTo(map).bindPopup('<b>${redPopup}</b>').openPopup();
L.marker([${driverLat},${driverLng}],{icon:L.divIcon({className:'custom-label',html:'<span style="color:#0EA5E9">${blueLabel}</span>',iconAnchor:[-8,-8]})}).addTo(map);
L.marker([${patientLat},${patientLng}],{icon:L.divIcon({className:'custom-label',html:'<span style="color:#DC2626">${redLabel}</span>',iconAnchor:[-8,-8]})}).addTo(map);
L.polyline([[${driverLat},${driverLng}],[${patientLat},${patientLng}]],{color:'#0EA5E9',weight:3,dashArray:'8,8',opacity:0.7}).addTo(map);
map.fitBounds([[${driverLat},${driverLng}],[${patientLat},${patientLng}]],{padding:[50,50],maxZoom:15});
<\/script></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/**
 * Build a Leaflet HTML map showing the patient location + multiple nearby
 * ambulance markers. Google Maps road tiles. Auto-fits bounds.
 */
export function buildPatientRequestMapHtml(
  patientLat: number, patientLng: number,
  ambulances: { lat: number; lng: number; label?: string }[],
): string {
  const ambMarkersJs = ambulances.map((a, i) => {
    const lbl = a.label || `Ambulance ${i + 1}`;
    return `
L.marker([${a.lat},${a.lng}],{icon:ambIcon}).addTo(map).bindPopup('<b>\u{1F691} ${lbl}</b>');
L.marker([${a.lat},${a.lng}],{icon:L.divIcon({className:'custom-label',html:'<span style="color:#0EA5E9">${lbl}</span>',iconAnchor:[-8,-8]})}).addTo(map);
bounds.push([${a.lat},${a.lng}]);`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%}
.leaflet-control-attribution{font-size:8px!important;opacity:0.6}
.custom-label{background:none;border:none;font-weight:700;font-size:11px;white-space:nowrap;text-shadow:0 1px 3px #fff,0 -1px 3px #fff,1px 0 3px #fff,-1px 0 3px #fff}
</style></head>
<body><div id="map"></div><script>
var map=L.map('map',{zoomControl:true,attributionControl:true,dragging:true,touchZoom:true,scrollWheelZoom:true,doubleClickZoom:true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var ambIcon=L.divIcon({className:'',html:'<div style="background:#0EA5E9;width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)"><svg width=\\"14\\" height=\\"14\\" viewBox=\\"0 0 24 24\\" fill=\\"#fff\\"><path d=\\"M18.9 6c-.2-.6-.8-1-1.4-1h-2l.7-1.4C16.5 3 16.1 2.3 15.5 2H8.5c-.6.3-1 1-1 1.6L8.5 5h-2c-.7 0-1.2.4-1.4 1L4 10v8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h10v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-8l-1.1-4zM6.5 15c-.8 0-1.5-.7-1.5-1.5S5.7 12 6.5 12s1.5.7 1.5 1.5S7.3 15 6.5 15zm11 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zM5 10l1.5-4.5h11L19 10H5z\\"/></svg></div>',iconSize:[30,30],iconAnchor:[15,15]});
var patIcon=L.divIcon({className:'',html:'<div style="background:#DC2626;width:34px;height:34px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);animation:pulse 1.5s infinite"><svg width=\\"16\\" height=\\"16\\" viewBox=\\"0 0 24 24\\" fill=\\"#fff\\"><path d=\\"M12 2C8.1 2 5 5.1 5 9c0 5.3 7 13 7 13s7-7.7 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5s1.1-2.5 2.5-2.5 2.5 1.1 2.5 2.5-1.1 2.5-2.5 2.5z\\"/></svg></div><style>@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}</style>',iconSize:[34,34],iconAnchor:[17,17]});
var bounds=[[${patientLat},${patientLng}]];
L.marker([${patientLat},${patientLng}],{icon:patIcon}).addTo(map).bindPopup('<b>\u{1F4CD} Your Location</b>').openPopup();
L.marker([${patientLat},${patientLng}],{icon:L.divIcon({className:'custom-label',html:'<span style="color:#DC2626">You</span>',iconAnchor:[-8,-8]})}).addTo(map);
${ambMarkersJs}
if(bounds.length>1){map.fitBounds(bounds,{padding:[40,40],maxZoom:14})}else{map.setView([${patientLat},${patientLng}],14)}
<\/script></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
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
