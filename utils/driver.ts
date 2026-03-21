import { supabase } from "./supabase";

import { backendGet, backendPost } from "./api";
import { calculateDistance, parsePostGISPoint, toPostGISPoint } from "./emergency";

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

  return Array.from(new Set([raw, digits, local, local.replace(/^0/, ""), intl]));
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

/**
 * Get ambulance ID for a driver (DB column: current_driver_id)
 */
export const getDriverAmbulanceId = async (
  driverId: string,
): Promise<{ ambulanceId: string | null; error: Error | null }> => {
  try {
    let { data, error } = await supabase
      .from("ambulances")
      .select("id")
      .eq("current_driver_id", driverId)
      .limit(1)
      .maybeSingle();

    // Legacy schema fallback: some projects still use different driver-link columns.
    if (error && isMissingColumnError(error, "current_driver_id")) {
      const { data: legacyRows, error: legacyError } = await supabase
        .from("ambulances")
        .select("*")
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
        return candidates.some((value) => String(value ?? "") === driverId);
      });

      data = legacyMatch ? { id: legacyMatch.id } : null;
      error = null;
    }

    if (error) {
      throw error;
    }

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
  try {
    const { error } = await supabase
      .from("ambulances")
      .update({
        is_available: isAvailable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ambulanceId);
    if (error) throw error;
    return { success: true, error: null };
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
    let { data, error } = await supabase
      .from("ambulances")
      .select(
        "id, vehicle_number, registration_number, type, is_available, hospital_id, created_at, updated_at",
      )
      .eq("current_driver_id", driverId)
      .limit(1)
      .maybeSingle();

    // Fallback if registration_number column doesn't exist yet
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
    const now = new Date().toISOString();
    const db = supabase;
    // Check if an ambulance with this vehicle_number already exists
    const { data: existing } = await db
      .from("ambulances")
      .select("id")
      .eq("vehicle_number", vehicleNumber)
      .maybeSingle();

    if (existing) {
      // Link the driver to the existing ambulance
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
      // Retry without registration_number if column doesn't exist
      if (updateErr && isMissingColumnError(updateErr, "registration_number")) {
        const { error: retryErr } = await db
          .from("ambulances")
          .update({ current_driver_id: driverId, updated_at: now })
          .eq("id", existing.id);
        if (retryErr) throw retryErr;
      } else if (updateErr) throw updateErr;
      return { ambulanceId: existing.id, error: null };
    }

    // Insert new ambulance
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

    // Retry without registration_number if column doesn't exist
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

    // Retry without type if check constraint fails (code 23514)
    if (insertResult.error && (insertResult.error as any).code === "23514") {
      delete insertPayload.type;
      delete insertPayload.registration_number; // also strip in case column missing
      insertResult = await db
        .from("ambulances")
        .insert(insertPayload)
        .select("id")
        .single();
    }

    if (insertResult.error) {
      // Enhanced error handling for RLS violations
      if (
        insertResult.error.code === "42501" &&
        insertResult.error.message.includes("row-level security")
      ) {
        console.error(
          "Ambulance creation failed due to RLS policy:",
          insertResult.error,
        );
        alert(
          "Ambulance creation failed due to security policy. Please contact admin to enable ambulance creation for drivers.",
        );
      } else {
        console.error("Error upserting driver ambulance:", insertResult.error);
      }
      return { ambulanceId: null, error: insertResult.error };
    }
    return { ambulanceId: insertResult.data?.id ?? null, error: null };
  } catch (error) {
    console.error("Error upserting driver ambulance:", error);
    alert("Ambulance creation failed. Please contact admin.");
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
    const { ambulanceId, error: ambulanceError } =
      await getDriverAmbulanceId(driverId);
    if (ambulanceError) throw ambulanceError;
    if (!ambulanceId) return { assignment: null, error: null };

    const db = supabase;

    let data: any = null;
    let error: any = null;

    // Get the latest non-completed assignment with its emergency request
    ({ data, error } = await db
      .from("emergency_assignments")
      .select("*, emergency_requests(*)")
      .eq("ambulance_id", ambulanceId)
      .in("status", ["pending", "accepted"])
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle());

    // Filter out assignments whose emergency is completed/cancelled
    if (!error && data && data.emergency_requests) {
      const erStatus = data.emergency_requests.status;
      if (erStatus === "completed" || erStatus === "cancelled") {
        // Close this assignment with a DB-valid terminal value
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

    // If join returned null emergency_requests but assignment exists, fetch emergency separately
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

    // Fallback without status filter if column missing
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

    // CRITICAL FALLBACK: If emergency_assignments table doesn't exist at all,
    // query emergency_requests directly by assigned_ambulance_id
    if (
      error &&
      (error.code === "42P01" ||
        error.code === "PGRST204" ||
        error.code === "PGRST205" ||
        String(error.message || "")
          .toLowerCase()
          .includes("could not find"))
    ) {
      console.warn(
        "emergency_assignments table not found, falling back to emergency_requests",
      );
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
    // Update assignment status (non-blocking — table may not exist for fallback path)
    try {
      await supabase
        .from("emergency_assignments")
        .update({ status: "accepted" })
        .eq("id", assignmentId);
    } catch {
      /* ignore if table missing */
    }

    // Update emergency status to 'en_route' (driver is now heading to patient)
    const { error: emergencyError } = await supabase
      .from("emergency_requests")
      .update({ status: "en_route", updated_at: new Date().toISOString() })
      .eq("id", emergencyId);

    if (emergencyError) {
      throw emergencyError;
    }

    console.log("Emergency accepted:", assignmentId);
    return { success: true, error: null };
  } catch (error) {
    console.error("Error accepting emergency:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Decline emergency assignment
 */
export const declineEmergency = async (
  assignmentId: string,
  emergencyId?: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    // Try emergency_assignments table first
    try {
      await supabase
        .from("emergency_assignments")
        .update({ status: "declined" })
        .eq("id", assignmentId);
    } catch {
      /* ignore if table missing */
    }

    // Cancel the emergency request
    // Use emergencyId if provided (normal path), otherwise assignmentId (fallback path where they're the same)
    const erId = emergencyId || assignmentId;
    await supabase
      .from("emergency_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", erId);

    console.log("Emergency declined:", assignmentId);
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
    const { ambulanceId, error: ambErr } = await getDriverAmbulanceId(driverId);
    if (ambErr || !ambulanceId)
      return { active: 0, completed: 0, error: ambErr };

    const db = supabase;

    // Active = assigned + en_route + at_scene + transporting + at_hospital
    const { count: active } = await db
      .from("emergency_requests")
      .select("id", { count: "exact", head: true })
      .eq("assigned_ambulance_id", ambulanceId)
      .not("status", "in", "(completed,cancelled,pending)");

    // Completed
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
    const db = supabase;
    const now = new Date().toISOString();

    const { error } = await db
      .from("emergency_requests")
      .update({ status, updated_at: now })
      .eq("id", emergencyId);

    if (error) throw error;

    // When completing/cancelling, close associated assignment with valid status
    if (status === "completed" || status === "cancelled") {
      await db
        .from("emergency_assignments")
        .update({ status: "declined", completed_at: now })
        .eq("emergency_id", emergencyId)
        .in("status", ["pending", "accepted"]);

      // Also re-enable ambulance availability
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

    console.log(`Emergency status updated to ${status}:`, emergencyId);
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
    const { error } = await supabase
      .from("ambulances")
      .update({
        last_known_location: toPostGISPoint(latitude, longitude),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ambulanceId);

    if (error) {
      throw error;
    }

    return { success: true, error: null };
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
    const { ambulanceId, error: ambErr } = await getDriverAmbulanceId(driverId);
    if (ambErr || !ambulanceId) return { history: [], error: ambErr };

    const db = supabase;
    const { data, error } = await db
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

    // Preferred path: medical_profiles.user_id references profile id.
    try {
      const { data } = await supabase
        .from("medical_profiles")
        .select("*")
        .eq("user_id", patientId)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) medicalProfiles = data;
    } catch {
      // ignore and continue fallback paths
    }

    // Fallback path: some datasets use medical_profiles.id as patient id.
    if (medicalProfiles.length === 0) {
      try {
        const { data } = await supabase
          .from("medical_profiles")
          .select("*")
          .eq("id", patientId)
          .limit(1);
        if (data && data.length > 0) medicalProfiles = data;
      } catch {
        // ignore and continue
      }
    }

    // Fallback path: resolve profile IDs by phone and query medical_profiles.user_id.
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
        // ignore and continue
      }
    }

    // Final fallback: emergency contact phone mapping in legacy rows.
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
          // ignore and try next
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
    const { data: amb, error: ambError } = await supabase
      .from("ambulances")
      .select("id,hospital_id,last_known_location,current_driver_id")
      .eq("id", ambulanceId)
      .maybeSingle();
    if (ambError) throw ambError;
    if (!amb) {
      return {
        success: false,
        hospitalId: null,
        distanceKm: null,
        error: new Error("Ambulance not found"),
      };
    }

    if (amb.hospital_id && !opts?.force) {
      return { success: true, hospitalId: amb.hospital_id, distanceKm: null, error: null };
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
      const dist = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestHospitalId = String(hospital.id);
      }
    }

    if (!bestHospitalId) {
      return {
        success: false,
        hospitalId: null,
        distanceKm: null,
        error: new Error("No eligible hospital found"),
      };
    }

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
      distanceKm: Number.isFinite(bestDistance) ? Math.round(bestDistance * 100) / 100 : null,
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
