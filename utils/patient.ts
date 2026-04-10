/**
 * Patient Emergency Management Utilities
 */

import { backendGet, backendPatch, backendPost } from "./api";
import {
    assignAmbulance,
    calculateDistance,
    getAvailableAmbulances,
    parsePostGISPoint,
    toPostGISPoint,
} from "./emergency";
import { supabase } from "./supabase";

const EMERGENCY_CANCEL_WINDOW_MINUTES = 3;

export interface PatientEmergency {
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
  description?: string;
  assigned_ambulance_id?: string;
  hospital_id?: string;
  patient_location?: string;
  latitude: number;
  longitude: number;
  created_at: string;
  updated_at: string;
  dispatch_reason?: string;
  eta_minutes?: number;
  route_to_patient_url?: string;
  route_to_hospital_url?: string;
}

interface EmergencyDispatchApiResponse {
  emergency_id: string;
  status: string;
  hospital_id: string | null;
  assigned_ambulance_id: string | null;
  distance_to_ambulance_km: number | null;
  distance_to_hospital_km: number | null;
  eta_minutes: number | null;
  route_to_patient_url: string | null;
  route_to_hospital_url: string | null;
  reason: string;
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
  driver_phone?: string;
  driver_contact?: string;
}

export const retryEmergencyDispatch = async (
  emergencyId: string,
  maxRadiusKm: number = 80,
): Promise<{
  success: boolean;
  emergency: PatientEmergency | null;
  error: Error | null;
}> => {
  try {
    const _res = await backendPost<EmergencyDispatchApiResponse>(
      `/ops/patient/emergencies/${emergencyId}/retry-dispatch`,
      { max_radius_km: maxRadiusKm },
    );

    // Fetch fresh emergency via backend (bypasses RLS)
    const detailRes = await backendGet<{ emergency: any }>(
      `/ops/patient/emergencies/${emergencyId}/detail`,
    );
    const data = detailRes?.emergency;

    if (!data) {
      return {
        success: false,
        emergency: null,
        error: new Error("Emergency not found after retry"),
      };
    }

    return { success: true, emergency: normalizeEmergency(data), error: null };
  } catch (error) {
    return { success: false, emergency: null, error: error as Error };
  }
};

export const updatePatientLiveLocation = async (
  emergencyId: string,
  latitude: number,
  longitude: number,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    if (
      !emergencyId ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return {
        success: false,
        error: new Error("Invalid emergency/location payload"),
      };
    }

    const res = await backendPatch<{ success?: boolean; reason?: string }>(
      `/ops/patient/emergencies/${emergencyId}/patient-location`,
      {
        latitude,
        longitude,
      },
    );

    if (res?.success === false) {
      return {
        success: false,
        error: new Error(
          String(res.reason || "Failed to update live location"),
        ),
      };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

export interface AmbulanceInfo {
  id: string;
  vehicle_number: string;
  type: string;
  current_driver_id: string;
  is_available: boolean;
  hospital_id?: string;
  last_known_location?: string;
  phone?: string;
  phone_number?: string;
  driver_phone?: string;
}

export interface HospitalInfo {
  id: string;
  name: string;
  address: string;
  phone: string;
  location?: string;
}

export interface EmergencyHospitalStatus {
  emergency_id: string;
  hospital_id: string | null;
  hospital_name: string | null;
  is_accepting_emergencies: boolean | null;
  active_emergencies: number;
  max_concurrent_emergencies: number | null;
  utilization: number | null;
  distance_to_hospital_km: number | null;
  eta_to_hospital_minutes: number | null;
  hospital_latitude: number | null;
  hospital_longitude: number | null;
  source: string;
}

interface FamilyShareCreateResponse {
  share_token: string;
  emergency_id: string;
  expires_at: string;
}

const PREFERRED_SHARE_BASES = [
  "https://erdatayee.tech/api",
  "https://www.erdatayee.tech/api",
  "https://staff.erdatayee.tech/api",
];

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const normalizeShareBase = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path = trimTrailingSlash(parsed.pathname || "");
    if (!path || path === "/") {
      if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
        return trimTrailingSlash(url);
      }
      return `${parsed.protocol}//${parsed.host}/api`;
    }
    return trimTrailingSlash(url);
  } catch {
    return trimTrailingSlash(url);
  }
};

const resolvePublicBackendUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  const fallbackUrls = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const candidates: string[] = [];
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    window.location?.protocol === "https:"
  ) {
    candidates.push(`${window.location.origin}/api`);
  }
  candidates.push(...PREFERRED_SHARE_BASES);
  if (envUrl?.trim()) candidates.push(envUrl.trim());
  candidates.push(...fallbackUrls);

  const publicCandidate = candidates
    .map((value) => normalizeShareBase(value))
    .find((value) => isShareablePublicUrl(value));
  if (publicCandidate) return publicCandidate;

  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:8000";
};

const isShareablePublicUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      return false;
    }
    if (host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
};

export const getEmergencyHospitalStatus = async (
  emergencyId: string,
): Promise<{ data: EmergencyHospitalStatus | null; error: Error | null }> => {
  try {
    const data = await backendGet<EmergencyHospitalStatus>(
      `/ops/patient/emergencies/${emergencyId}/hospital-status`,
    );
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
};

export const createFamilyShareLink = async (
  emergencyId: string,
  expiresMinutes: number = 180,
): Promise<{
  shareToken: string;
  shareUrl: string;
  expiresAt: string;
  error: Error | null;
}> => {
  try {
    const data = await backendPost<FamilyShareCreateResponse>(
      "/ops/family/share",
      {
        emergency_id: emergencyId,
        expires_minutes: expiresMinutes,
      },
    );

    const baseUrl = resolvePublicBackendUrl().replace(/\/$/, "");
    if (!isShareablePublicUrl(baseUrl)) {
      throw new Error(
        "Family share link is not public yet. Set EXPO_PUBLIC_BACKEND_URL to a public HTTPS URL (for example your ngrok URL).",
      );
    }
    const shareUrl = `${baseUrl}/ops/family/share/live?share_token=${encodeURIComponent(data.share_token)}`;

    return {
      shareToken: data.share_token,
      shareUrl,
      expiresAt: data.expires_at,
      error: null,
    };
  } catch (error) {
    return {
      shareToken: "",
      shareUrl: "",
      expiresAt: "",
      error: error as Error,
    };
  }
};

const normalizeEmergency = (raw: any): PatientEmergency => {
  const parsed = parsePostGISPoint(raw?.patient_location);
  const latitude = Number(raw?.latitude);
  const longitude = Number(raw?.longitude);
  const hasNumericLatLng =
    Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    ...raw,
    emergency_type: raw?.emergency_type ?? "medical",
    latitude: hasNumericLatLng
      ? latitude
      : Number.isFinite(parsed?.latitude)
        ? Number(parsed?.latitude)
        : 0,
    longitude: hasNumericLatLng
      ? longitude
      : Number.isFinite(parsed?.longitude)
        ? Number(parsed?.longitude)
        : 0,
    status: (raw?.status ?? "pending") as PatientEmergency["status"],
    created_at: raw?.created_at ?? new Date().toISOString(),
    updated_at: raw?.updated_at ?? raw?.created_at ?? new Date().toISOString(),
  } as PatientEmergency;
};

const firstNonEmptyPhone = (...values: any[]): string => {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
};

export const createEmergency = async (
  patientId: string,
  latitude: number,
  longitude: number,
  emergencyType: string = "medical",
  description?: string,
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    if (!patientId || latitude === undefined || longitude === undefined) {
      throw new Error(
        "Missing required fields: patientId, latitude, longitude",
      );
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(
        "Invalid location coordinates. Please refresh location and try again.",
      );
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error(
        "Location coordinates are out of range. Please refresh location and try again.",
      );
    }

    const normalizedEmergencyType =
      String(emergencyType || "medical")
        .trim()
        .slice(0, 40) || "medical";
    const normalizedDescription =
      typeof description === "string" && description.trim().length > 0
        ? description.trim().slice(0, 1500)
        : null;

    // Backend-first dispatch — fetch national_id in parallel with dispatch
    try {
      // Fire national_id fetch in parallel (don't block dispatch)
      const nationalIdPromise = backendGet<{ national_id?: string }>(
        "/profiles/me",
      ).then(
        (p) => {
          const nid = p?.national_id;
          return typeof nid === "string" && /^\d{16}$/.test(nid.trim())
            ? nid.trim()
            : undefined;
        },
        () => undefined,
      );

      // Start dispatch immediately (national_id is optional)
      const dispatchPromise = backendPost<EmergencyDispatchApiResponse>(
        "/ops/patient/emergencies",
        {
          latitude: lat,
          longitude: lng,
          emergency_type: normalizedEmergencyType,
          description: normalizedDescription,
          max_radius_km: 100,
          national_id: await nationalIdPromise,
        },
      );

      const dispatch = await dispatchPromise;

      // Build emergency from dispatch response directly — skip extra detail fetch
      // The dispatch response already contains: emergency_id, ambulance_id, hospital_id, reason, eta
      const emergency = normalizeEmergency({
        id: dispatch.emergency_id,
        patient_id: patientId,
        patient_location: toPostGISPoint(lat, lng),
        emergency_type: normalizedEmergencyType,
        description: normalizedDescription,
        status: dispatch.ambulance_id ? "assigned" : "pending",
        assigned_ambulance_id: dispatch.ambulance_id,
        hospital_id: dispatch.hospital_id,
        latitude: lat,
        longitude: lng,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      emergency.dispatch_reason = dispatch.reason;
      emergency.eta_minutes = dispatch.eta_minutes ?? undefined;
      emergency.route_to_patient_url =
        dispatch.route_to_patient_url ?? undefined;
      emergency.route_to_hospital_url =
        dispatch.route_to_hospital_url ?? undefined;

      return { emergency, error: null };
    } catch (backendErr) {
      console.warn(
        "Backend dispatch unavailable, using legacy fallback:",
        backendErr,
      );
    }

    // Supabase direct fallback
    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from("emergency_requests")
      .insert({
        patient_id: patientId,
        patient_location: toPostGISPoint(lat, lng),
        emergency_type: normalizedEmergencyType,
        status: "pending",
        description: normalizedDescription,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select()
      .single();

    if (error) throw error;

    const emergency = normalizeEmergency(data);

    // Try to auto-assign nearest available ambulance with retry on CAS conflicts
    try {
      const { ambulances } = await getAvailableAmbulances();
      if (ambulances && ambulances.length > 0) {
        // Sort by distance to patient
        const ranked = ambulances
          .map((a) => {
            const loc = parsePostGISPoint(a.last_known_location);
            if (!loc) return null;
            const dist = calculateDistance(
              lat,
              lng,
              loc.latitude,
              loc.longitude,
            );
            return { id: a.id, dist };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => a.dist - b.dist) as {
          id: string;
          dist: number;
        }[];

        for (const candidate of ranked.slice(0, 5)) {
          const { success } = await assignAmbulance(emergency.id, candidate.id);
          if (success) {
            emergency.assigned_ambulance_id = candidate.id;
            emergency.status = "assigned";
            break;
          }
          // CAS failed — ambulance grabbed by another request, try next
        }
      }
    } catch (assignErr) {
      console.warn("Auto-assign ambulance skipped:", assignErr);
    }

    return { emergency, error: null };
  } catch (error) {
    console.error("Error creating emergency:", error);
    return { emergency: null, error: error as Error };
  }
};

export const getActiveEmergency = async (
  patientId: string,
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    // Try backend first
    let activeRow: any = null;
    try {
      const res = await backendGet<{ emergency: any }>(
        "/ops/patient/emergencies/active",
      );
      activeRow = res?.emergency ?? null;
    } catch {
      // Fall through to Supabase
    }

    // Supabase fallback
    if (!activeRow) {
      const { data, error } = await supabase
        .from("emergency_requests")
        .select("*")
        .eq("patient_id", patientId)
        .not("status", "in", "(completed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      activeRow = data;
    }

    if (
      activeRow &&
      String(activeRow.status || "") === "pending" &&
      !activeRow.assigned_ambulance_id
    ) {
      try {
        const retry = await backendPost<EmergencyDispatchApiResponse>(
          `/ops/patient/emergencies/${activeRow.id}/retry-dispatch`,
          { max_radius_km: 100 },
        );
        if (retry?.assigned_ambulance_id) {
          activeRow.assigned_ambulance_id = retry.assigned_ambulance_id;
          activeRow.status = "assigned";
        }
      } catch (retryError) {
        console.warn(
          "Active emergency auto-dispatch retry failed:",
          retryError,
        );
      }
    }

    return {
      emergency: activeRow ? normalizeEmergency(activeRow) : null,
      error: null,
    };
  } catch (error) {
    console.error("Error fetching active emergency:", error);
    return { emergency: null, error: error as Error };
  }
};

export const getEmergencyDetails = async (
  emergencyId: string,
): Promise<{
  emergency: PatientEmergency | null;
  assignment: EmergencyAssignment | null;
  ambulance: AmbulanceInfo | null;
  error: Error | null;
}> => {
  try {
    // Try backend first
    try {
      const res = await backendGet<{
        emergency: any;
        assignment: any;
        ambulance: any;
      }>(`/ops/patient/emergencies/${emergencyId}/detail`);

      if (res?.emergency) {
        const assignmentData = res.assignment ?? null;
        const ambulanceData = res.ambulance ?? null;
        return {
          emergency: normalizeEmergency(res.emergency),
          assignment: assignmentData
            ? ({
                ...assignmentData,
                status: assignmentData.status ?? "pending",
              } as EmergencyAssignment)
            : null,
          ambulance: ambulanceData as AmbulanceInfo | null,
          error: null,
        };
      }
    } catch {
      // Fall through to Supabase
    }

    // Supabase fallback with rich driver phone resolution
    const { data: emergencyData, error: emergencyError } = await supabase
      .from("emergency_requests")
      .select("*")
      .eq("id", emergencyId)
      .maybeSingle();

    if (emergencyError) throw emergencyError;
    if (!emergencyData) {
      return {
        emergency: null,
        assignment: null,
        ambulance: null,
        error: new Error("Emergency not found"),
      };
    }

    let assignmentData: any = null;
    let ambulance: AmbulanceInfo | null = null;

    try {
      const { data } = await supabase
        .from("emergency_assignments")
        .select("*")
        .eq("emergency_id", emergencyId)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      assignmentData = data;
    } catch {
      /* emergency_assignments may not exist */
    }

    const ambulanceId =
      assignmentData?.ambulance_id || emergencyData?.assigned_ambulance_id;

    if (ambulanceId) {
      const { data: ambulanceData } = await supabase
        .from("ambulances")
        .select("*")
        .eq("id", ambulanceId)
        .maybeSingle();

      ambulance = ambulanceData as AmbulanceInfo | null;

      let resolvedPhone = firstNonEmptyPhone(
        assignmentData?.driver_phone,
        assignmentData?.driver_contact,
        (ambulanceData as any)?.driver_phone,
        (ambulanceData as any)?.phone_number,
        (ambulanceData as any)?.phone,
      );

      if (!resolvedPhone) {
        const candidateIds = Array.from(
          new Set(
            [
              (ambulanceData as any)?.current_driver_id,
              (ambulanceData as any)?.driver_id,
              (ambulanceData as any)?.user_id,
              (ambulanceData as any)?.driver_user_id,
              assignmentData?.driver_id,
              assignmentData?.assigned_driver_id,
              assignmentData?.user_id,
            ]
              .map((v) => String(v ?? "").trim())
              .filter((v) => v.length > 0),
          ),
        );

        if (candidateIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, phone")
            .in("id", candidateIds)
            .limit(10);
          resolvedPhone = firstNonEmptyPhone(
            ...(profiles || []).map((p: any) => p.phone),
          );
        }
      }

      if (resolvedPhone) {
        ambulance = {
          ...(ambulanceData as any),
          driver_phone: resolvedPhone,
          phone: firstNonEmptyPhone(
            (ambulanceData as any)?.phone,
            resolvedPhone,
          ),
          phone_number: firstNonEmptyPhone(
            (ambulanceData as any)?.phone_number,
            resolvedPhone,
          ),
        } as AmbulanceInfo;

        if (assignmentData) {
          assignmentData = {
            ...assignmentData,
            driver_phone: firstNonEmptyPhone(
              assignmentData.driver_phone,
              assignmentData.driver_contact,
              resolvedPhone,
            ),
            driver_contact: firstNonEmptyPhone(
              assignmentData.driver_contact,
              assignmentData.driver_phone,
              resolvedPhone,
            ),
          };
        }
      }
    }

    return {
      emergency: normalizeEmergency(emergencyData),
      assignment: assignmentData
        ? ({
            ...assignmentData,
            status: assignmentData.status ?? "pending",
          } as EmergencyAssignment)
        : null,
      ambulance,
      error: null,
    };
  } catch (error) {
    console.error("Error fetching emergency details:", error);
    return {
      emergency: null,
      assignment: null,
      ambulance: null,
      error: error as Error,
    };
  }
};

export const updateEmergencyStatus = async (
  emergencyId: string,
  status:
    | "pending"
    | "assigned"
    | "en_route"
    | "at_scene"
    | "arrived"
    | "transporting"
    | "at_hospital"
    | "completed"
    | "cancelled",
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    await backendPatch(`/ops/patient/emergencies/${emergencyId}/status`, {
      status,
    });
    return { success: true, error: null };
  } catch (error) {
    console.error("Error updating emergency status:", error);
    return { success: false, error: error as Error };
  }
};

export const getEmergencyCancelWindowState = (
  createdAt: string,
  maxMinutes: number = EMERGENCY_CANCEL_WINDOW_MINUTES,
) => {
  const createdMs = new Date(createdAt).getTime();
  const deadlineMs = createdMs + maxMinutes * 60 * 1000;
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  return {
    canCancel: remainingMs > 0,
    remainingSeconds,
  };
};

export const cancelEmergencyWithinWindow = async (
  emergencyId: string,
  patientId: string,
  maxMinutes: number = EMERGENCY_CANCEL_WINDOW_MINUTES,
): Promise<{
  success: boolean;
  error: Error | null;
  remainingSeconds: number;
}> => {
  try {
    const detailRes = await backendGet<{ emergency: any }>(
      `/ops/patient/emergencies/${emergencyId}/detail`,
    );
    const data = detailRes?.emergency ?? null;

    if (!data) {
      return {
        success: false,
        error: new Error("Emergency request not found."),
        remainingSeconds: 0,
      };
    }

    if (data.patient_id !== patientId) {
      return {
        success: false,
        error: new Error(
          "You are not allowed to cancel this emergency request.",
        ),
        remainingSeconds: 0,
      };
    }

    if (["completed", "cancelled"].includes(String(data.status))) {
      return {
        success: false,
        error: new Error("This emergency request is already closed."),
        remainingSeconds: 0,
      };
    }

    const currentStatus = String(data.status || "pending");
    if (!["pending", "assigned"].includes(currentStatus)) {
      return {
        success: false,
        error: new Error(
          "Cancellation is closed because an ambulance already accepted this request.",
        ),
        remainingSeconds: 0,
      };
    }

    const { canCancel, remainingSeconds } = getEmergencyCancelWindowState(
      data.created_at,
      maxMinutes,
    );

    if (!canCancel) {
      return {
        success: false,
        error: new Error(
          `Cancellation window expired. You can only cancel within ${maxMinutes} minutes.`,
        ),
        remainingSeconds: 0,
      };
    }

    const { success, error: statusError } = await updateEmergencyStatus(
      emergencyId,
      "cancelled",
    );

    if (!success || statusError) {
      return {
        success: false,
        error: statusError ?? new Error("Failed to cancel emergency request."),
        remainingSeconds,
      };
    }

    return { success: true, error: null, remainingSeconds: 0 };
  } catch (error) {
    return {
      success: false,
      error: error as Error,
      remainingSeconds: 0,
    };
  }
};

export const subscribeToEmergency = (
  emergencyId: string,
  onUpdate: (emergency: PatientEmergency) => void,
) => {
  const channel = supabase
    .channel(`emergency_status:${emergencyId}:${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "emergency_requests",
        filter: `id=eq.${emergencyId}`,
      },
      (payload: any) => {
        if (payload.new) {
          onUpdate(normalizeEmergency(payload.new));
        }
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void supabase
        .from("emergency_requests")
        .select("*")
        .eq("id", emergencyId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) onUpdate(normalizeEmergency(data));
        });
    });

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const subscribeToAmbulanceLocation = (
  ambulanceId: string,
  onUpdate: (latitude: number, longitude: number) => void,
) => {
  const channel = supabase
    .channel(`ambulance_loc:${ambulanceId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "ambulances",
        filter: `id=eq.${ambulanceId}`,
      },
      (payload: any) => {
        const parsed = parsePostGISPoint(payload.new?.last_known_location);
        if (parsed) {
          onUpdate(parsed.latitude, parsed.longitude);
        }
      },
    )
    .subscribe((status) => {
      // Re-sync on reconnect so no position updates are missed
      if (status !== "SUBSCRIBED") return;
      void supabase
        .from("ambulances")
        .select("last_known_location")
        .eq("id", ambulanceId)
        .maybeSingle()
        .then(({ data }) => {
          const parsed = parsePostGISPoint(data?.last_known_location);
          if (parsed) onUpdate(parsed.latitude, parsed.longitude);
        });
    });

  return () => {
    void supabase.removeChannel(channel);
  };
};
