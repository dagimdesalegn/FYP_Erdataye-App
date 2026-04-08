import { backendGet, backendPost } from "./api";
import { supabase } from "./supabase";

function roundCoord(value: number, decimals: number = 5): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const MIN_ROUTE_PREVIEW_DISTANCE_KM = 0.15;

// ─── PostGIS helpers ─────────────────────────────────────────────────

/**
 * Format coordinates as human-readable directional text.
 * e.g. 9.02, 38.75 → "9.0200° N, 38.7500° E"
 */
export function formatCoords(
  lat: number,
  lng: number,
  decimals: number = 4,
): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(decimals)}° ${ns}, ${Math.abs(lng).toFixed(decimals)}° ${ew}`;
}

/**
 * Build a Google Maps embed URL for a single location marker.
 * Returns a direct URL suitable for iframe src – no CORS issues.
 */
export function buildMapHtml(
  lat: number,
  lng: number,
  zoom: number = 17,
): string {
  // t=m uses the standard roadmap view (roads + building labels).
  const latR = roundCoord(lat);
  const lngR = roundCoord(lng);
  return `https://maps.google.com/maps?q=${latR},${lngR}&z=${zoom}&t=m&output=embed`;
}

/**
 * Build a Google Maps embed URL showing the driver → patient area.
 * Calculates the midpoint and an appropriate zoom level based on the
 * distance between the two locations so the iframe actually zooms in
 * instead of showing the entire world.
 */
export function buildDriverPatientMapHtml(
  driverLat: number,
  driverLng: number,
  patientLat: number,
  patientLng: number,
  _options?: {
    blueLabel?: string;
    redLabel?: string;
    bluePopup?: string;
    redPopup?: string;
  },
): string {
  const dLat = roundCoord(driverLat);
  const dLng = roundCoord(driverLng);
  const pLat = roundCoord(patientLat);
  const pLng = roundCoord(patientLng);

  const distanceKm = calculateDistance(driverLat, driverLng, patientLat, patientLng);
  if (distanceKm < MIN_ROUTE_PREVIEW_DISTANCE_KM) {
    return buildMapHtml(patientLat, patientLng, 18);
  }

  return `https://maps.google.com/maps?saddr=${dLat},${dLng}&daddr=${pLat},${pLng}&dirflg=d&t=m&output=embed`;
}

/**
 * Build a Google Maps embed URL centered on the patient location.
 * Returns a direct URL suitable for iframe src – no CORS issues.
 */
export function buildPatientRequestMapHtml(
  patientLat: number,
  patientLng: number,
  ambulances: { lat: number; lng: number; label?: string }[],
): string {
  // Show a routed preview from the nearest available ambulance to patient.
  if (ambulances.length > 0) {
    let nearest = ambulances[0];
    let bestDistance = calculateDistance(
      patientLat,
      patientLng,
      nearest.lat,
      nearest.lng,
    );

    for (let i = 1; i < ambulances.length; i += 1) {
      const candidate = ambulances[i];
      const candidateDistance = calculateDistance(
        patientLat,
        patientLng,
        candidate.lat,
        candidate.lng,
      );
      if (candidateDistance < bestDistance) {
        nearest = candidate;
        bestDistance = candidateDistance;
      }
    }

    if (bestDistance < MIN_ROUTE_PREVIEW_DISTANCE_KM) {
      return buildMapHtml(patientLat, patientLng, 18);
    }

    return `https://maps.google.com/maps?saddr=${roundCoord(nearest.lat)},${roundCoord(nearest.lng)}&daddr=${roundCoord(patientLat)},${roundCoord(patientLng)}&dirflg=d&t=m&output=embed`;
  }

  return `https://maps.google.com/maps?q=${roundCoord(patientLat)},${roundCoord(patientLng)}&z=16&t=m&output=embed`;
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
  geometry: any,
): { latitude: number; longitude: number } | null {
  if (!geometry) return null;

  // GeoJSON object
  if (typeof geometry === "object" && geometry.coordinates) {
    return {
      longitude: geometry.coordinates[0],
      latitude: geometry.coordinates[1],
    };
  }

  if (typeof geometry !== "string") return null;

  // WKT/EWKT string, e.g. "POINT(lon lat)" or "SRID=4326;POINT(lon lat)"
  const maybePoint = geometry.includes("POINT(") ? geometry : "";
  if (maybePoint) {
    try {
      const pointPart = maybePoint.includes(";")
        ? maybePoint.split(";").pop() || ""
        : maybePoint;
      const inside = pointPart.slice(
        pointPart.indexOf("(") + 1,
        pointPart.lastIndexOf(")"),
      );
      const [lonRaw, latRaw] = inside.trim().split(/\s+/);
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        return { latitude: lat, longitude: lon };
      }
    } catch {
      // Continue to WKB parsing fallback.
    }
  }

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
  status:
    | "pending"
    | "assigned"
    | "en_route"
    | "at_scene"
    | "arrived"
    | "transporting"
    | "at_hospital"
    | "completed"
    | "cancelled";
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
  is_accepting_emergencies?: boolean;
  max_concurrent_emergencies?: number;
  trauma_capable?: boolean;
  icu_beds_available?: number;
  average_handover_minutes?: number;
  location?: string; // raw PostGIS hex WKB
  created_at: string;
}

export interface DispatchRecommendation {
  ambulanceId: string | null;
  hospitalId: string | null;
  distanceKm: number | null;
  score: number | null;
  error: Error | null;
}

// ─── Normalizers ─────────────────────────────────────────────────────

/** Normalize a raw emergency_requests row into our EmergencyRequest interface. */
export function normalizeEmergency(raw: any): EmergencyRequest {
  const parsed = parsePostGISPoint(raw?.patient_location);
  const rawLat = raw?.latitude;
  const rawLng = raw?.longitude;
  const normalizedLat =
    rawLat !== null && rawLat !== undefined && Number.isFinite(Number(rawLat))
      ? Number(rawLat)
      : (parsed?.latitude ?? 0);
  const normalizedLng =
    rawLng !== null && rawLng !== undefined && Number.isFinite(Number(rawLng))
      ? Number(rawLng)
      : (parsed?.longitude ?? 0);
  return {
    ...raw,
    emergency_type: raw?.emergency_type ?? "medical",
    latitude: normalizedLat,
    longitude: normalizedLng,
  } as EmergencyRequest;
}

/** Normalize a raw ambulances row. */
function normalizeAmbulance(raw: any): Ambulance {
  return {
    ...raw,
    is_available: raw?.is_available ?? true,
    current_driver_id: raw?.current_driver_id ?? "",
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
  emergencyType: string = "medical",
): Promise<{ request: EmergencyRequest | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from("emergency_requests")
      .insert({
        patient_id: patientId,
        patient_location: toPostGISPoint(latitude, longitude),
        description,
        emergency_type: emergencyType,
        status: "pending",
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
  patientId: string,
): Promise<{ requests: EmergencyRequest[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from("emergency_requests")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

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
  maxRadiusKm: number = 50,
): Promise<{
  ambulanceId: string | null;
  distanceKm: number | null;
  error: Error | null;
}> => {
  const ranked = await recommendBestDispatch(latitude, longitude, maxRadiusKm);
  if (!ranked.error && ranked.ambulanceId) {
    return {
      ambulanceId: ranked.ambulanceId,
      distanceKm: ranked.distanceKm,
      error: null,
    };
  }

  try {
    // Attempt server-side PostGIS lookup first
    const { data, error: rpcError } = await supabase.rpc(
      "find_nearest_available_ambulance",
      {
        patient_location: toPostGISPoint(latitude, longitude),
        max_radius_km: maxRadiusKm,
      },
    );

    if (!rpcError && data) {
      return { ambulanceId: data as string, distanceKm: null, error: null };
    }

    // Fallback: client-side distance calculation
    const { ambulances } = await getAvailableAmbulances();
    if (!ambulances || ambulances.length === 0) {
      return {
        ambulanceId: null,
        distanceKm: null,
        error: new Error("No available ambulances"),
      };
    }

    let closestId: string | null = null;
    let closestDistance = Infinity;

    for (const amb of ambulances) {
      const loc = parsePostGISPoint(amb.last_known_location);
      if (!loc) continue;

      const dist = calculateDistance(
        latitude,
        longitude,
        loc.latitude,
        loc.longitude,
      );
      if (dist < closestDistance && dist <= maxRadiusKm) {
        closestDistance = dist;
        closestId = amb.id;
      }
    }

    if (!closestId) {
      return {
        ambulanceId: null,
        distanceKm: null,
        error: new Error(`No ambulances within ${maxRadiusKm}km`),
      };
    }

    return {
      ambulanceId: closestId,
      distanceKm: Math.round(closestDistance * 10) / 10,
      error: null,
    };
  } catch (error) {
    return { ambulanceId: null, distanceKm: null, error: error as Error };
  }
};

/**
 * Recommend the best dispatch candidate using a weighted score.
 * Score balances:
 * - Ambulance distance to patient (closer is better)
 * - Hospital active emergency load (lighter load is better)
 * - Hospital fleet capacity (higher capacity is better)
 */
export const recommendBestDispatch = async (
  latitude: number,
  longitude: number,
  maxRadiusKm: number = 50,
): Promise<DispatchRecommendation> => {
  try {
    const [allAmbulancesRes, activeEmergenciesRes] = await Promise.all([
      supabase
        .from("ambulances")
        .select("id, hospital_id, is_available, last_known_location"),
      supabase
        .from("emergency_requests")
        .select("hospital_id, status")
        .not("status", "in", "(completed,cancelled)"),
    ]);

    if (allAmbulancesRes.error) throw allAmbulancesRes.error;
    if (activeEmergenciesRes.error) throw activeEmergenciesRes.error;

    const allAmbulances = (allAmbulancesRes.data ?? []) as {
      id: string;
      hospital_id?: string | null;
      is_available?: boolean;
      last_known_location?: string | null;
    }[];

    const activeEmergencies = (activeEmergenciesRes.data ?? []) as {
      hospital_id?: string | null;
      status: string;
    }[];

    const availableAmbulances = allAmbulances.filter(
      (a) => a.is_available === true,
    );

    if (availableAmbulances.length === 0) {
      return {
        ambulanceId: null,
        hospitalId: null,
        distanceKm: null,
        score: null,
        error: new Error("No available ambulances"),
      };
    }

    const hospitalFleetCount = new Map<string, number>();
    for (const a of allAmbulances) {
      const h = a.hospital_id ?? "unassigned";
      hospitalFleetCount.set(h, (hospitalFleetCount.get(h) ?? 0) + 1);
    }

    const hospitalActiveCount = new Map<string, number>();
    for (const e of activeEmergencies) {
      const h = e.hospital_id ?? "unassigned";
      hospitalActiveCount.set(h, (hospitalActiveCount.get(h) ?? 0) + 1);
    }

    let best: {
      ambulanceId: string;
      hospitalId: string | null;
      distanceKm: number;
      score: number;
    } | null = null;

    for (const amb of availableAmbulances) {
      const loc = parsePostGISPoint(amb.last_known_location);
      if (!loc) continue;

      const distanceKm = calculateDistance(
        latitude,
        longitude,
        loc.latitude,
        loc.longitude,
      );
      if (distanceKm > maxRadiusKm) continue;

      const hospitalId = amb.hospital_id ?? null;
      const hKey = hospitalId ?? "unassigned";
      const fleet = Math.max(hospitalFleetCount.get(hKey) ?? 1, 1);
      const active = hospitalActiveCount.get(hKey) ?? 0;

      const distanceScore = Math.max(0, 100 - distanceKm * 2);
      const loadRatio = Math.min(active / fleet, 2);
      const loadScore = Math.max(0, 100 - loadRatio * 50);
      const capacityScore = Math.min(100, fleet * 10);

      const score = distanceScore * 0.6 + loadScore * 0.3 + capacityScore * 0.1;

      if (!best || score > best.score) {
        best = {
          ambulanceId: amb.id,
          hospitalId,
          distanceKm,
          score,
        };
      }
    }

    if (!best) {
      return {
        ambulanceId: null,
        hospitalId: null,
        distanceKm: null,
        score: null,
        error: new Error(`No ambulances within ${maxRadiusKm}km`),
      };
    }

    return {
      ambulanceId: best.ambulanceId,
      hospitalId: best.hospitalId,
      distanceKm: Math.round(best.distanceKm * 10) / 10,
      score: Math.round(best.score * 100) / 100,
      error: null,
    };
  } catch (error) {
    return {
      ambulanceId: null,
      hospitalId: null,
      distanceKm: null,
      score: null,
      error: error as Error,
    };
  }
};

/**
 * Assign ambulance to emergency request.
 * - Atomically reserves the ambulance (CAS: only if still available)
 * - Updates emergency_requests.assigned_ambulance_id & status
 * - Inserts a row into emergency_assignments so drivers are notified via realtime
 */
export const assignAmbulance = async (
  emergencyId: string,
  ambulanceId: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const now = new Date().toISOString();

    // ── CAS guard: reserve ambulance only if it is still available ──
    const { data: reserved, error: reserveError } = await supabase
      .from("ambulances")
      .update({ is_available: false, updated_at: now })
      .eq("id", ambulanceId)
      .eq("is_available", true)
      .select("id, hospital_id")
      .maybeSingle();

    if (reserveError) throw reserveError;
    if (!reserved) {
      // Another request already grabbed this ambulance
      return {
        success: false,
        error: new Error("Ambulance is no longer available. Trying another…"),
      };
    }

    const hospitalId = reserved.hospital_id ?? null;

    let assignmentNotes: string | null = null;

    const { data: emergencyRow } = await supabase
      .from("emergency_requests")
      .select("patient_id")
      .eq("id", emergencyId)
      .maybeSingle();

    const patientId = emergencyRow?.patient_id as string | undefined;
    if (patientId) {
      const { data: medRows } = await supabase
        .from("medical_profiles")
        .select(
          "blood_type,allergies,medical_conditions,emergency_contact_name,emergency_contact_phone,updated_at",
        )
        .eq("user_id", patientId)
        .order("updated_at", { ascending: false })
        .limit(1);

      const bestMed = (medRows || [])[0];

      if (bestMed) {
        assignmentNotes = JSON.stringify({
          medical_snapshot: {
            blood_type: bestMed.blood_type || "",
            allergies: bestMed.allergies || "",
            medical_conditions: bestMed.medical_conditions || "",
            emergency_contact_name: bestMed.emergency_contact_name || "",
            emergency_contact_phone: bestMed.emergency_contact_phone || "",
            updated_at: bestMed.updated_at || null,
          },
        });
      }
    }

    // 1. Update emergency request
    const { error } = await supabase
      .from("emergency_requests")
      .update({
        assigned_ambulance_id: ambulanceId,
        hospital_id: hospitalId,
        status: "assigned",
        updated_at: now,
      })
      .eq("id", emergencyId);

    if (error) {
      // Rollback: re-enable the ambulance we just reserved
      await supabase
        .from("ambulances")
        .update({ is_available: true, updated_at: now })
        .eq("id", ambulanceId);
      throw error;
    }

    // 2. Insert into emergency_assignments (triggers driver realtime subscription)
    const { error: assignError } = await supabase
      .from("emergency_assignments")
      .insert({
        emergency_id: emergencyId,
        ambulance_id: ambulanceId,
        status: "pending",
        assigned_at: now,
        notes: assignmentNotes,
      });

    if (assignError) {
      console.warn(
        "Failed to insert emergency_assignment (non-blocking):",
        assignError,
      );
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
  status: EmergencyRequest["status"],
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from("emergency_requests")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", emergencyId);

    if (error) throw error;

    // When cancelled, close assignments with a valid status
    if (status === "cancelled") {
      await supabase
        .from("emergency_assignments")
        .update({ status: "declined", completed_at: new Date().toISOString() })
        .eq("emergency_id", emergencyId)
        .in("status", ["pending", "accepted"]);

      // Re-enable ambulance availability
      const { data: assignments } = await supabase
        .from("emergency_assignments")
        .select("ambulance_id")
        .eq("emergency_id", emergencyId);
      if (assignments) {
        for (const a of assignments) {
          await supabase
            .from("ambulances")
            .update({ is_available: true })
            .eq("id", a.ambulance_id);
        }
      }
    }

    // When completed, only re-enable ambulance (do not force assignment status)
    if (status === "completed") {
      const { data: assignments } = await supabase
        .from("emergency_assignments")
        .select("ambulance_id")
        .eq("emergency_id", emergencyId);
      if (assignments) {
        for (const a of assignments) {
          await supabase
            .from("ambulances")
            .update({ is_available: true })
            .eq("id", a.ambulance_id);
        }
      }
    }

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
      .from("ambulances")
      .select("*")
      .eq("is_available", true);

    if (error) throw error;

    return { ambulances: (data || []).map(normalizeAmbulance), error: null };
  } catch (error) {
    return { ambulances: null, error: error as Error };
  }
};

/**
 * Get available ambulances with fresh realtime location only.
 */
export const getLiveAvailableAmbulances = async (
  maxAgeMinutes: number = 10,
): Promise<{
  ambulances: Ambulance[] | null;
  error: Error | null;
}> => {
  try {
    try {
      const params = new URLSearchParams({
        max_age_minutes: String(Math.max(0, maxAgeMinutes)),
        limit: "100",
      });
      const res = await backendGet<{ ambulances: Ambulance[] }>(
        `/ops/patient/ambulances/live?${params.toString()}`,
      );
      return {
        ambulances: (res?.ambulances || []).map(normalizeAmbulance),
        error: null,
      };
    } catch (backendError) {
      console.warn(
        "Backend live ambulance fetch failed, using Supabase fallback",
        backendError,
      );
    }

    const cutoffIso = new Date(
      Date.now() - maxAgeMinutes * 60 * 1000,
    ).toISOString();

    const { data: freshData, error: freshError } = await supabase
      .from("ambulances")
      .select("*")
      .eq("is_available", true)
      .not("last_known_location", "is", null)
      .gte("updated_at", cutoffIso)
      .order("updated_at", { ascending: false });

    if (freshError) throw freshError;
    if (freshData && freshData.length > 0) {
      return { ambulances: freshData.map(normalizeAmbulance), error: null };
    }

    const { data, error } = await supabase
      .from("ambulances")
      .select("*")
      .eq("is_available", true)
      .not("last_known_location", "is", null)
      .order("updated_at", { ascending: false });

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
    const { data, error } = await supabase.from("hospitals").select("*");

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
  callback: (locations: any[]) => void,
) => {
  const subscription = supabase
    .channel(`location_updates:${emergencyId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "location_updates",
        filter: `emergency_request_id=eq.${emergencyId}`,
      },
      (payload: any) => {
        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          callback([payload.new]);
        }
      },
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
  longitude: number,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from("ambulances")
      .update({
        last_known_location: toPostGISPoint(latitude, longitude),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ambulanceId);

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
  lon2: number,
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

// --- Enhancement endpoints (MVP wrappers) -----------------------------

export const getTrafficAwareDispatch = async (input: {
  latitude: number;
  longitude: number;
  maxRadiusKm?: number;
  trafficLevel?: "low" | "moderate" | "high" | "severe";
}) =>
  backendPost("/ops/dispatch/traffic-aware", {
    latitude: input.latitude,
    longitude: input.longitude,
    max_radius_km: input.maxRadiusKm ?? 60,
    traffic_level: input.trafficLevel ?? "moderate",
  });

export const getExplainableTriage = async (input: {
  severity: "low" | "medium" | "high" | "critical";
  age?: number;
  conscious?: boolean;
  breathingDifficulty?: boolean;
  severeBleeding?: boolean;
  chestPain?: boolean;
  strokeSymptoms?: boolean;
  trauma?: boolean;
}) =>
  backendPost("/ops/triage/explainable", {
    severity: input.severity,
    age: input.age,
    conscious: input.conscious ?? true,
    breathing_difficulty: input.breathingDifficulty ?? false,
    severe_bleeding: input.severeBleeding ?? false,
    chest_pain: input.chestPain ?? false,
    stroke_symptoms: input.strokeSymptoms ?? false,
    trauma: input.trauma ?? false,
  });

export const syncOfflineQueue = async (
  items: {
    type: "location_ping" | "emergency_create" | "status_update";
    payload: Record<string, unknown>;
    queuedAt?: string;
  }[],
) =>
  backendPost("/ops/offline/sync", {
    items: items.map((item) => ({
      type: item.type,
      payload: item.payload,
      queued_at: item.queuedAt,
    })),
  });

export const addEmergencyTimelineEvent = async (input: {
  emergencyId: string;
  eventType: string;
  details?: Record<string, unknown>;
}) =>
  backendPost("/ops/timeline/events", {
    emergency_id: input.emergencyId,
    event_type: input.eventType,
    details: input.details ?? {},
  });

export const getEmergencyTimeline = async (emergencyId: string) =>
  backendGet(
    `/ops/timeline/events?emergency_id=${encodeURIComponent(emergencyId)}`,
  );

export const getHospitalCapacityBoard = async () =>
  backendGet("/ops/capacity/hospitals");

export const createFamilyShareLink = async (input: {
  emergencyId: string;
  expiresMinutes?: number;
}) =>
  backendPost("/ops/family/share", {
    emergency_id: input.emergencyId,
    expires_minutes: input.expiresMinutes ?? 180,
  });

export const resolveFamilyShareLink = async (token: string) =>
  backendGet(`/ops/family/share?share_token=${encodeURIComponent(token)}`);

export const getDriverSafetyScore = async (input: {
  speedKmh: number;
  harshBrakeCount?: number;
  harshAccelCount?: number;
  hardTurnCount?: number;
}) =>
  backendPost("/ops/driver/safety", {
    speed_kmh: input.speedKmh,
    harsh_brake_count: input.harshBrakeCount ?? 0,
    harsh_accel_count: input.harshAccelCount ?? 0,
    hard_turn_count: input.hardTurnCount ?? 0,
  });

export const getGpsTrustScore = async (input: {
  reportedLatitude: number;
  reportedLongitude: number;
  referenceLatitude?: number;
  referenceLongitude?: number;
  gpsAgeSeconds?: number;
}) =>
  backendPost("/ops/trust/gps-confidence", {
    reported_latitude: input.reportedLatitude,
    reported_longitude: input.reportedLongitude,
    reference_latitude: input.referenceLatitude,
    reference_longitude: input.referenceLongitude,
    gps_age_seconds: input.gpsAgeSeconds ?? 0,
  });

export const getOperationsInsights = async (days: number = 7) =>
  backendGet(`/ops/insights/operations?days=${days}`);

export const getContextualFirstAid = async (
  symptom: string,
  language: "en" | "am" = "en",
) =>
  backendGet(
    `/ops/first-aid/contextual?symptom=${encodeURIComponent(symptom)}&language=${language}`,
  );
