import { supabase } from "./supabase";

import { backendGet, backendPatch, backendPost, backendPut } from "./api";
import {
    calculateDistance,
    parsePostGISPoint,
    toPostGISPoint,
} from "./emergency";

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
  status: "pending" | "accepted" | "declined";
  assigned_at: string;
}

const isMissingColumnError = (error: any, column: string): boolean => {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" && message.includes(column.toLowerCase());
};

const toPhoneCandidates = (phone?: string | null): string[] => {
  const raw = String(phone ?? "")
    .trim()
    .replace(/[\s()-]/g, "");
  if (!raw) return [];

  const digits = raw.replace(/[^\d+]/g, "");
  const local = digits.startsWith("+251")
    ? `0${digits.slice(4)}`
    : digits.startsWith("251")
      ? `0${digits.slice(3)}`
      : digits.startsWith("0")
        ? digits
        : digits.length === 9
          ? `0${digits}`
          : digits;
  const intl = local.startsWith("0") ? `+251${local.slice(1)}` : `+${digits}`;

  return Array.from(
    new Set([raw, digits, local, local.replace(/^0/, ""), intl]),
  );
};

export interface AmbulanceDetails {
  id: string;
  vehicle_number: string;
  registration_number: string | null;
  type: string | null;
  is_available: boolean;
  hospital_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface HospitalSummary {
  id: string;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  is_accepting_emergencies?: boolean | null;
}

/**
 * Get ambulance ID for a driver (backend-first, Supabase fallback)
 */
export const getDriverAmbulanceId = async (
  driverId: string,
): Promise<{ ambulanceId: string | null; error: Error | null }> => {
  try {
    try {
      const res = await backendGet<{ ambulance: any | null }>(
        "/ops/driver/ambulance",
      );
      const amb = res?.ambulance;
      if (amb?.id) return { ambulanceId: amb.id, error: null };
    } catch {
      /* fall through to Supabase */
    }

    let { data, error } = await supabase
      .from("ambulances")
      .select("id")
      .eq("current_driver_id", driverId)
      .limit(1)
      .maybeSingle();

    if (error && isMissingColumnError(error, "current_driver_id")) {
      const { data: legacyRows, error: legacyError } = await supabase
        .from("ambulances")
        .select("*")
        .limit(200);
      if (legacyError) throw legacyError;
      const legacyMatch = (legacyRows || []).find((row: any) => {
        const candidates = [
          row?.current_driver_id,
          row?.driver_id,
          row?.user_id,
          row?.driver_user_id,
          row?.assigned_driver_id,
        ];
        return candidates.some((value) => String(value ?? "") === driverId);
      });
      data = legacyMatch ? { id: legacyMatch.id } : null;
      error = null;
    }

    if (error) throw error;
    return { ambulanceId: data?.id ?? null, error: null };
  } catch (error) {
    console.error("Error fetching driver ambulance:", error);
    return { ambulanceId: null, error: error as Error };
  }
};

/**
 * Toggle ambulance availability in the DB (syncs driver's online/offline status)
 */
export const toggleAmbulanceAvailability = async (
  ambulanceId: string,
  isAvailable: boolean,
): Promise<{ success: boolean; error: Error | null }> => {
  const isTransientBackendFailure = (error: unknown): boolean => {
    const message = String((error as any)?.message ?? "").toLowerCase();
    return (
      message.includes("backend error 502") ||
      message.includes("backend error 503") ||
      message.includes("backend error 504") ||
      message.includes("timeout") ||
      message.includes("network request failed")
    );
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  try {
    let backendOk = false;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await backendPut("/ops/driver/ambulance/availability", {
          ambulance_id: ambulanceId,
          is_available: isAvailable,
        });
        backendOk = true;
        break;
      } catch (error) {
        lastError = error as Error;
        if (!isTransientBackendFailure(error) || attempt === 2) break;
        await wait(350 * (attempt + 1));
      }
    }

    const { error: fallbackError } = await supabase
      .from("ambulances")
      .update({
        is_available: isAvailable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ambulanceId);

    if (backendOk || !fallbackError) {
      return { success: true, error: null };
    }

    if (lastError) {
      return {
        success: false,
        error: new Error(fallbackError.message || lastError.message),
      };
    }

    return {
      success: false,
      error: new Error(
        fallbackError.message || "Failed to update availability",
      ),
    };
  } catch (error) {
    console.error("Error toggling ambulance availability:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get full ambulance details for a driver
 */
export const getDriverAmbulanceDetails = async (
  driverId: string,
): Promise<{ ambulance: AmbulanceDetails | null; error: Error | null }> => {
  try {
    try {
      const res = await backendGet<{ ambulance: any | null }>(
        "/ops/driver/ambulance",
      );
      if (res?.ambulance)
        return { ambulance: res.ambulance as AmbulanceDetails, error: null };
    } catch {
      /* fall through to Supabase */
    }

    let { data, error } = await supabase
      .from("ambulances")
      .select(
        "id, vehicle_number, registration_number, type, is_available, hospital_id, created_at, updated_at",
      )
      .eq("current_driver_id", driverId)
      .limit(1)
      .maybeSingle();

    if (error && isMissingColumnError(error, "registration_number")) {
      const fallback = await supabase
        .from("ambulances")
        .select(
          "id, vehicle_number, type, is_available, hospital_id, created_at, updated_at",
        )
        .eq("current_driver_id", driverId)
        .limit(1)
        .maybeSingle();
      data = fallback.data
        ? { ...fallback.data, registration_number: null }
        : null;
      error = fallback.error;
    }

    if (error) throw error;
    return { ambulance: data as AmbulanceDetails | null, error: null };
  } catch (error) {
    console.error("Error fetching ambulance details:", error);
    return { ambulance: null, error: error as Error };
  }
};

export const getHospitalSummary = async (
  hospitalId: string,
): Promise<{ hospital: HospitalSummary | null; error: Error | null }> => {
  try {
    if (!hospitalId) {
      throw new Error("Hospital ID required");
    }
    try {
      const hospital = await backendGet<HospitalSummary>(
        `/ops/hospitals/${encodeURIComponent(hospitalId)}/basic`,
      );
      if (hospital) return { hospital, error: null };
    } catch {
      /* fall through to Supabase */
    }

    const { data, error } = await supabase
      .from("hospitals")
      .select("id, name, address, phone, is_accepting_emergencies")
      .eq("id", hospitalId)
      .maybeSingle();
    if (error) throw error;
    return { hospital: data as HospitalSummary | null, error: null };
  } catch (error) {
    console.error("Error fetching hospital summary:", error);
    return { hospital: null, error: error as Error };
  }
};

/**
 * Create or link an ambulance to a driver during registration
 */
export const upsertDriverAmbulance = async (
  driverId: string,
  vehicleNumber: string,
  registrationNumber: string = "",
  ambulanceType: string = "standard",
  hospitalId?: string,
): Promise<{ ambulanceId: string | null; error: Error | null }> => {
  try {
    try {
      const res = await backendPost<{ ambulance_id: string | null }>(
        "/ops/driver/ambulance",
        {
          vehicle_number: vehicleNumber,
          registration_number: registrationNumber || undefined,
          type: ambulanceType,
          hospital_id: hospitalId || undefined,
        },
      );
      if (res?.ambulance_id)
        return { ambulanceId: res.ambulance_id, error: null };
    } catch {
      /* fall through to Supabase */
    }

    const now = new Date().toISOString();
    const db = supabase;
    const { data: existing } = await db
      .from("ambulances")
      .select("id")
      .eq("vehicle_number", vehicleNumber)
      .maybeSingle();

    if (existing) {
      const updatePayload: any = {
        current_driver_id: driverId,
        type: ambulanceType,
        updated_at: now,
      };
      if (hospitalId) updatePayload.hospital_id = hospitalId;
      if (registrationNumber)
        updatePayload.registration_number = registrationNumber;
      const { error: updateErr } = await db
        .from("ambulances")
        .update(updatePayload)
        .eq("id", existing.id);
      if (updateErr && isMissingColumnError(updateErr, "registration_number")) {
        const { error: retryErr } = await db
          .from("ambulances")
          .update({ current_driver_id: driverId, updated_at: now })
          .eq("id", existing.id);
        if (retryErr) throw retryErr;
      } else if (updateErr) throw updateErr;
      return { ambulanceId: existing.id, error: null };
    }

    const insertPayload: any = {
      vehicle_number: vehicleNumber,
      current_driver_id: driverId,
      type: ambulanceType,
      is_available: true,
      created_at: now,
      updated_at: now,
    };
    if (hospitalId) insertPayload.hospital_id = hospitalId;
    if (registrationNumber)
      insertPayload.registration_number = registrationNumber;

    let insertResult = await db
      .from("ambulances")
      .insert(insertPayload)
      .select("id")
      .single();

    if (
      insertResult.error &&
      isMissingColumnError(insertResult.error, "registration_number")
    ) {
      delete insertPayload.registration_number;
      insertResult = await db
        .from("ambulances")
        .insert(insertPayload)
        .select("id")
        .single();
    }

    if (insertResult.error && (insertResult.error as any).code === "23514") {
      delete insertPayload.type;
      delete insertPayload.registration_number;
      insertResult = await db
        .from("ambulances")
        .insert(insertPayload)
        .select("id")
        .single();
    }

    if (insertResult.error) throw insertResult.error;
    return { ambulanceId: insertResult.data?.id ?? null, error: null };
  } catch (error) {
    console.error("Error upserting driver ambulance:", error);
    return { ambulanceId: null, error: error as Error };
  }
};

/**
 * Get driver's ambulance assignment
 */
export const getDriverAssignment = async (
  driverId: string,
): Promise<{ assignment: AmbulanceAssignment | null; error: Error | null }> => {
  try {
    try {
      const res = await backendGet<{ assignment: any | null }>(
        "/ops/driver/assignment",
      );
      const data = res?.assignment;
      if (data)
        return {
          assignment: {
            ...data,
            status: data.status ?? "pending",
          } as AmbulanceAssignment,
          error: null,
        };
      if (res && !data) return { assignment: null, error: null };
    } catch {
      /* fall through to Supabase */
    }

    const { ambulanceId, error: ambulanceError } =
      await getDriverAmbulanceId(driverId);
    if (ambulanceError) throw ambulanceError;
    if (!ambulanceId) return { assignment: null, error: null };

    const db = supabase;
    let data: any = null;
    let error: any = null;

    ({ data, error } = await db
      .from("emergency_assignments")
      .select("*, emergency_requests(*)")
      .eq("ambulance_id", ambulanceId)
      .in("status", ["pending", "accepted"])
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle());

    if (!error && data && data.emergency_requests) {
      const erStatus = data.emergency_requests.status;
      if (erStatus === "completed" || erStatus === "cancelled") {
        await db
          .from("emergency_assignments")
          .update({
            status: "declined",
            completed_at: new Date().toISOString(),
          })
          .eq("id", data.id);
        return { assignment: null, error: null };
      }
    }

    if (!error && data && !data.emergency_requests) {
      const { data: erData } = await db
        .from("emergency_requests")
        .select("*")
        .eq("id", data.emergency_id)
        .maybeSingle();
      if (erData) {
        if (erData.status === "completed" || erData.status === "cancelled") {
          await db
            .from("emergency_assignments")
            .update({
              status: "declined",
              completed_at: new Date().toISOString(),
            })
            .eq("id", data.id);
          return { assignment: null, error: null };
        }
        data.emergency_requests = erData;
      }
    }

    if (
      error &&
      (error.code === "42703" ||
        String(error.message || "")
          .toLowerCase()
          .includes("status"))
    ) {
      ({ data, error } = await db
        .from("emergency_assignments")
        .select("*, emergency_requests(*)")
        .eq("ambulance_id", ambulanceId)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (
      error &&
      (error.code === "42P01" ||
        error.code === "PGRST204" ||
        error.code === "PGRST205" ||
        String(error.message || "")
          .toLowerCase()
          .includes("could not find"))
    ) {
      const { data: emergencyData, error: emergencyError } = await db
        .from("emergency_requests")
        .select("*")
        .eq("assigned_ambulance_id", ambulanceId)
        .not("status", "in", "(completed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (emergencyError) throw emergencyError;
      if (emergencyData) {
        return {
          assignment: {
            id: emergencyData.id,
            ambulance_id: ambulanceId,
            emergency_id: emergencyData.id,
            emergency_requests: emergencyData,
            status: "pending",
            assigned_at: emergencyData.updated_at || emergencyData.created_at,
          } as AmbulanceAssignment,
          error: null,
        };
      }
      return { assignment: null, error: null };
    }

    if (error) throw error;
    const assignment = data
      ? ({ ...data, status: data.status ?? "pending" } as AmbulanceAssignment)
      : null;
    return { assignment, error: null };
  } catch (error) {
    console.error("Error fetching driver assignment:", error);
    return { assignment: null, error: error as Error };
  }
};

/**
 * Accept emergency assignment
 */
export const acceptEmergency = async (
  assignmentId: string,
  emergencyId: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    try {
      await backendPost(`/ops/driver/assignment/${assignmentId}/accept`, {
        emergency_id: emergencyId,
      });
      console.log("Emergency accepted:", assignmentId);
      return { success: true, error: null };
    } catch {
      /* fall through to Supabase */
    }

    try {
      await supabase
        .from("emergency_assignments")
        .update({ status: "accepted" })
        .eq("id", assignmentId);
    } catch {
      /* ignore if table missing */
    }

    const { error: emergencyError } = await supabase
      .from("emergency_requests")
      .update({ status: "assigned", updated_at: new Date().toISOString() })
      .eq("id", emergencyId);
    if (emergencyError) throw emergencyError;

    console.log("Emergency accepted (Supabase fallback):", assignmentId);
    return { success: true, error: null };
  } catch (error) {
    console.error("Error accepting emergency:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Decline emergency assignment — puts the emergency back to pending for re-dispatch
 */
export const declineEmergency = async (
  assignmentId: string,
  emergencyId?: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    try {
      await backendPost(`/ops/driver/assignment/${assignmentId}/decline`, {
        emergency_id: emergencyId || assignmentId,
      });
      console.log("Emergency declined:", assignmentId);
      return { success: true, error: null };
    } catch {
      /* fall through to Supabase */
    }

    const now = new Date().toISOString();

    // Mark the assignment as declined
    try {
      await supabase
        .from("emergency_assignments")
        .update({ status: "declined", completed_at: now })
        .eq("id", assignmentId);
    } catch {
      /* ignore if table missing */
    }

    const erId = emergencyId || assignmentId;

    // Get the ambulance that was assigned so we can re-enable it
    const { data: erRow } = await supabase
      .from("emergency_requests")
      .select("assigned_ambulance_id")
      .eq("id", erId)
      .maybeSingle();

    // Reset emergency back to pending for re-dispatch (not cancelled)
    await supabase
      .from("emergency_requests")
      .update({
        status: "pending",
        assigned_ambulance_id: null,
        updated_at: now,
      })
      .eq("id", erId);

    // Re-enable the ambulance
    if (erRow?.assigned_ambulance_id) {
      await supabase
        .from("ambulances")
        .update({ is_available: true, updated_at: now })
        .eq("id", erRow.assigned_ambulance_id);
    }

    console.log(
      "Emergency declined (Supabase fallback) — reset to pending:",
      assignmentId,
    );
    return { success: true, error: null };
  } catch (error) {
    console.error("Error declining emergency:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get driver stats (active / completed counts) for the driver home screen.
 */
export const getDriverStats = async (
  driverId: string,
): Promise<{ active: number; completed: number; error: Error | null }> => {
  try {
    try {
      const res = await backendGet<{ active: number; completed: number }>(
        "/ops/driver/stats",
      );
      if (res)
        return {
          active: res.active ?? 0,
          completed: res.completed ?? 0,
          error: null,
        };
    } catch {
      /* fall through to Supabase */
    }

    const { ambulanceId, error: ambErr } = await getDriverAmbulanceId(driverId);
    if (ambErr || !ambulanceId)
      return { active: 0, completed: 0, error: ambErr };

    const db = supabase;
    const { count: active } = await db
      .from("emergency_requests")
      .select("id", { count: "exact", head: true })
      .eq("assigned_ambulance_id", ambulanceId)
      .not("status", "in", "(completed,cancelled,pending)");

    const { count: completed } = await db
      .from("emergency_requests")
      .select("id", { count: "exact", head: true })
      .eq("assigned_ambulance_id", ambulanceId)
      .eq("status", "completed");

    return { active: active ?? 0, completed: completed ?? 0, error: null };
  } catch (error) {
    console.error("Error fetching driver stats:", error);
    return { active: 0, completed: 0, error: error as Error };
  }
};

/**
 * Update emergency status (enroute, at_scene, transporting, at_hospital, closed)
 */
export const updateEmergencyStatus = async (
  emergencyId: string,
  status:
    | "pending"
    | "assigned"
    | "en_route"
    | "at_scene"
    | "transporting"
    | "at_hospital"
    | "completed"
    | "cancelled",
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    try {
      await backendPatch(`/ops/patient/emergencies/${emergencyId}/status`, {
        status,
      });
      console.log(`Emergency status updated to ${status}:`, emergencyId);
      return { success: true, error: null };
    } catch {
      /* fall through to Supabase */
    }

    const db = supabase;
    const now = new Date().toISOString();
    const { error } = await db
      .from("emergency_requests")
      .update({ status, updated_at: now })
      .eq("id", emergencyId);
    if (error) throw error;

    if (status === "completed" || status === "cancelled") {
      await db
        .from("emergency_assignments")
        .update({ status: "declined", completed_at: now })
        .eq("emergency_id", emergencyId)
        .in("status", ["pending", "accepted"]);
      const { data: er } = await db
        .from("emergency_requests")
        .select("assigned_ambulance_id")
        .eq("id", emergencyId)
        .maybeSingle();
      if (er?.assigned_ambulance_id) {
        await db
          .from("ambulances")
          .update({ is_available: true, updated_at: now })
          .eq("id", er.assigned_ambulance_id);
      }
    }

    console.log(
      `Emergency status updated to ${status} (Supabase fallback):`,
      emergencyId,
    );
    return { success: true, error: null };
  } catch (error) {
    console.error("Error updating emergency status:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Send live location update
 */
export const sendLocationUpdate = async (
  ambulanceId: string,
  latitude: number,
  longitude: number,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const isTransientBackendFailure = (error: unknown): boolean => {
      const message = String((error as any)?.message ?? "").toLowerCase();
      return (
        message.includes("backend error 502") ||
        message.includes("backend error 503") ||
        message.includes("backend error 504") ||
        message.includes("timeout") ||
        message.includes("network request failed")
      );
    };

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    let backendOk = false;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await backendPut("/ops/driver/ambulance/location", {
          ambulance_id: ambulanceId,
          latitude,
          longitude,
        });
        backendOk = true;
        break;
      } catch (error) {
        lastError = error as Error;
        if (!isTransientBackendFailure(error) || attempt === 2) {
          break;
        }
        await wait(350 * (attempt + 1));
      }
    }

    // Always try direct Supabase write as a safety net.
    const { error: fallbackError } = await supabase
      .from("ambulances")
      .update({
        last_known_location: toPostGISPoint(latitude, longitude),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ambulanceId);

    if (backendOk || !fallbackError) {
      return { success: true, error: null };
    }

    if (lastError) {
      return {
        success: false,
        error: new Error(fallbackError.message || lastError.message),
      };
    }

    return {
      success: false,
      error: new Error(
        fallbackError.message || "Failed to send location update",
      ),
    };
  } catch (error) {
    console.error("Error sending location update:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get patient info for assigned emergency
 */
/**
 * Get driver's completed emergency history
 */
export const getDriverHistory = async (
  driverId: string,
  limit: number = 20,
): Promise<{ history: any[]; error: Error | null }> => {
  try {
    try {
      const res = await backendGet<{ history: any[] }>(
        `/ops/driver/history?limit=${limit}`,
      );
      if (res?.history) return { history: res.history, error: null };
    } catch {
      /* fall through to Supabase */
    }

    const { ambulanceId, error: ambErr } = await getDriverAmbulanceId(driverId);
    if (ambErr || !ambulanceId) return { history: [], error: ambErr };

    const { data, error } = await supabase
      .from("emergency_requests")
      .select("*")
      .eq("assigned_ambulance_id", ambulanceId)
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return { history: data || [], error: null };
  } catch (error) {
    console.error("Error fetching driver history:", error);
    return { history: [], error: error as Error };
  }
};

export const getPatientInfo = async (
  patientId: string,
  emergencyId?: string,
): Promise<{
  info: any | null;
  error: Error | null;
}> => {
  try {
    if (!patientId) {
      return { info: null, error: new Error("Patient ID required") };
    }

    // Preferred path: backend service-role endpoint bypasses client-side RLS limits.
    try {
      const path = emergencyId
        ? `/ops/patient-context?patient_id=${encodeURIComponent(patientId)}&emergency_id=${encodeURIComponent(emergencyId)}`
        : `/ops/patient-context?patient_id=${encodeURIComponent(patientId)}`;
      const backendInfo = await backendGet<any>(path);
      if (backendInfo?.id) {
        return {
          info: {
            id: backendInfo.id,
            full_name: backendInfo.full_name ?? "Unknown Patient",
            phone: backendInfo.phone ?? "N/A",
            medical_profiles: backendInfo.medical_profiles ?? [],
          },
          error: null,
        };
      }
    } catch {
      // Fall back to direct Supabase reads below.
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", patientId)
      .maybeSingle();

    if (profileError && profileError.code !== "PGRST116") throw profileError;

    let medicalProfiles: any[] = [];

    try {
      const { data } = await supabase
        .from("medical_profiles")
        .select("*")
        .eq("user_id", patientId)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) medicalProfiles = data;
    } catch {
      /* ignore */
    }

    if (medicalProfiles.length === 0) {
      try {
        const { data } = await supabase
          .from("medical_profiles")
          .select("*")
          .eq("id", patientId)
          .limit(1);
        if (data && data.length > 0) medicalProfiles = data;
      } catch {
        /* ignore */
      }
    }

    const phoneCandidates = toPhoneCandidates(profileData?.phone);
    if (medicalProfiles.length === 0 && phoneCandidates.length > 0) {
      try {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id")
          .in("phone", phoneCandidates)
          .limit(5);
        const ids = (profileRows || []).map((p: any) => p.id).filter(Boolean);
        if (ids.length > 0) {
          const { data } = await supabase
            .from("medical_profiles")
            .select("*")
            .in("user_id", ids)
            .order("updated_at", { ascending: false })
            .limit(1);
          if (data && data.length > 0) medicalProfiles = data;
        }
      } catch {
        /* ignore */
      }
    }

    if (medicalProfiles.length === 0 && phoneCandidates.length > 0) {
      for (const p of phoneCandidates) {
        try {
          const { data } = await supabase
            .from("medical_profiles")
            .select("*")
            .eq("emergency_contact_phone", p)
            .order("updated_at", { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            medicalProfiles = data;
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    const info = {
      id: profileData?.id,
      full_name: profileData?.full_name ?? "Unknown Patient",
      phone: profileData?.phone ?? "N/A",
      medical_profiles: medicalProfiles,
    };

    return { info, error: null };
  } catch (error) {
    console.error("Error fetching patient info:", error);
    return { info: null, error: error as Error };
  }
};

/**
 * Subscribe to incoming assignments for driver
 */
export const subscribeToAssignments = (
  driverId: string,
  onAssignment: (assignment: AmbulanceAssignment) => void,
) => {
  let isClosed = false;
  let subscription: ReturnType<typeof supabase.channel> | null = null;

  void (async () => {
    const { ambulanceId, error } = await getDriverAmbulanceId(driverId);
    if (isClosed) return;

    if (error) {
      console.error("Failed to subscribe to assignments:", error);
      return;
    }

    if (!ambulanceId) {
      console.warn(
        "No ambulance linked to this driver. Assignment subscription skipped.",
      );
      return;
    }

    subscription = supabase
      .channel(`assignments:${ambulanceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "emergency_assignments",
          filter: `ambulance_id=eq.${ambulanceId}`,
        },
        (payload: any) => {
          console.log("New assignment received:", payload.new);
          onAssignment({
            ...(payload.new as AmbulanceAssignment),
            status: payload.new.status ?? "pending",
          });
        },
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
  onUpdate: (status: string) => void,
) => {
  const channel = supabase
    .channel(`emergency:${emergencyId}:${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "emergency_requests",
        filter: `id=eq.${emergencyId}`,
      },
      (payload: any) => {
        if (!payload?.new?.status) return;
        console.log("Emergency status updated:", payload.new.status);
        onUpdate(payload.new.status);
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;

      // Ensure initial status is synced even if realtime event was missed.
      void supabase
        .from("emergency_requests")
        .select("status")
        .eq("id", emergencyId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.status) onUpdate(data.status);
        });
    });

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const ensureAmbulanceHospitalLink = async (
  ambulanceId: string,
  opts?: { latitude?: number; longitude?: number; force?: boolean },
): Promise<{
  success: boolean;
  hospitalId: string | null;
  distanceKm: number | null;
  error: Error | null;
}> => {
  try {
    try {
      const res = await backendGet<{
        success: boolean;
        hospital_id: string | null;
        distance_km: number | null;
      }>(
        `/ops/driver/hospital-link?ambulance_id=${encodeURIComponent(ambulanceId)}&latitude=${opts?.latitude ?? 0}&longitude=${opts?.longitude ?? 0}&force=${opts?.force ?? false}`,
      );
      if (res?.success)
        return {
          success: true,
          hospitalId: res.hospital_id,
          distanceKm: res.distance_km,
          error: null,
        };
    } catch {
      /* fall through to Supabase */
    }

    const { data: amb, error: ambError } = await supabase
      .from("ambulances")
      .select("id,hospital_id,last_known_location,current_driver_id")
      .eq("id", ambulanceId)
      .maybeSingle();
    if (ambError) throw ambError;
    if (!amb)
      return {
        success: false,
        hospitalId: null,
        distanceKm: null,
        error: new Error("Ambulance not found"),
      };

    if (amb.hospital_id && !opts?.force) {
      return {
        success: true,
        hospitalId: amb.hospital_id,
        distanceKm: null,
        error: null,
      };
    }

    let latitude = opts?.latitude;
    let longitude = opts?.longitude;
    if (latitude === undefined || longitude === undefined) {
      const parsed = parsePostGISPoint(amb.last_known_location);
      if (parsed) {
        latitude = parsed.latitude;
        longitude = parsed.longitude;
      }
    }

    if (latitude === undefined || longitude === undefined) {
      return {
        success: false,
        hospitalId: null,
        distanceKm: null,
        error: new Error("Live location unavailable for hospital linking"),
      };
    }

    const { data: hospitals, error: hospError } = await supabase
      .from("hospitals")
      .select("id,location,is_accepting_emergencies");
    if (hospError) throw hospError;

    let bestHospitalId: string | null = null;
    let bestDistance = Infinity;
    for (const hospital of hospitals || []) {
      if (hospital?.is_accepting_emergencies === false) continue;
      const loc = parsePostGISPoint(hospital?.location);
      if (!loc) continue;
      const dist = calculateDistance(
        latitude,
        longitude,
        loc.latitude,
        loc.longitude,
      );
      if (dist < bestDistance) {
        bestDistance = dist;
        bestHospitalId = String(hospital.id);
      }
    }

    if (!bestHospitalId)
      return {
        success: false,
        hospitalId: null,
        distanceKm: null,
        error: new Error("No eligible hospital found"),
      };

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("ambulances")
      .update({ hospital_id: bestHospitalId, updated_at: now })
      .eq("id", ambulanceId);
    if (updateError) throw updateError;

    if (amb.current_driver_id) {
      await supabase
        .from("profiles")
        .update({ hospital_id: bestHospitalId, updated_at: now })
        .eq("id", amb.current_driver_id);
    }

    return {
      success: true,
      hospitalId: bestHospitalId,
      distanceKm: Number.isFinite(bestDistance)
        ? Math.round(bestDistance * 100) / 100
        : null,
      error: null,
    };
  } catch (error) {
    console.error("Error linking ambulance to nearest hospital:", error);
    return {
      success: false,
      hospitalId: null,
      distanceKm: null,
      error: error as Error,
    };
  }
};
