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

import {
    assignAmbulance,
    findNearestAmbulance,
    parsePostGISPoint,
    toPostGISPoint,
} from "./emergency";
import { supabase } from "./supabase";

const EMERGENCY_CANCEL_WINDOW_MINUTES = 3;

// ─── Interfaces aligned with actual DB schema ────────────────────────

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
  driver_phone?: string;
  driver_contact?: string;
}

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
  location?: string; // raw PostGIS hex WKB
}

// ─── Helpers ─────────────────────────────────────────────────────────

const normalizeEmergency = (raw: any): PatientEmergency => {
  const parsed = parsePostGISPoint(raw?.patient_location);
  return {
    ...raw,
    emergency_type: raw?.emergency_type ?? "medical",
    latitude: parsed?.latitude ?? 0,
    longitude: parsed?.longitude ?? 0,
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
  emergencyType: string = "medical",
  description?: string,
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    if (!patientId || latitude === undefined || longitude === undefined) {
      throw new Error(
        "Missing required fields: patientId, latitude, longitude",
      );
    }

    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from("emergency_requests")
      .insert({
        patient_id: patientId,
        patient_location: toPostGISPoint(latitude, longitude),
        emergency_type: emergencyType,
        status: "pending",
        description: description || null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select()
      .single();

    if (error) throw error;

    const emergency = normalizeEmergency(data);

    // Auto-assign nearest ambulance (best-effort, non-blocking)
    try {
      const { ambulanceId } = await findNearestAmbulance(
        latitude,
        longitude,
        50,
      );
      if (ambulanceId && emergency) {
        await assignAmbulance(emergency.id, ambulanceId);
        emergency.assigned_ambulance_id = ambulanceId;
        emergency.status = "assigned";
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

/**
 * Get patient's current active emergency
 */
export const getActiveEmergency = async (
  patientId: string,
): Promise<{ emergency: PatientEmergency | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from("emergency_requests")
      .select("*")
      .eq("patient_id", patientId)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return { emergency: data ? normalizeEmergency(data) : null, error: null };
  } catch (error) {
    console.error("Error fetching active emergency:", error);
    return { emergency: null, error: error as Error };
  }
};

/**
 * Get emergency details with assignment and ambulance info
 */
export const getEmergencyDetails = async (
  emergencyId: string,
): Promise<{
  emergency: PatientEmergency | null;
  assignment: EmergencyAssignment | null;
  ambulance: AmbulanceInfo | null;
  error: Error | null;
}> => {
  try {
    // Get emergency
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

    // Get assignment (with fallback if emergency_assignments table is missing)
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
      // Table may not exist — ignore
    }

    // Get ambulance from assignment or directly from emergency_requests
    const ambulanceId =
      assignmentData?.ambulance_id || emergencyData?.assigned_ambulance_id;
    if (ambulanceId) {
      const { data: ambulanceData } = await supabase
        .from("ambulances")
        .select("*")
        .eq("id", ambulanceId)
        .maybeSingle();

      ambulance = ambulanceData as AmbulanceInfo | null;

      // Resolve ambulance/driver phone robustly across multiple schema variants.
      let resolvedPhone = firstNonEmptyPhone(
        (assignmentData as any)?.driver_phone,
        (assignmentData as any)?.driver_contact,
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
              (assignmentData as any)?.driver_id,
              (assignmentData as any)?.assigned_driver_id,
              (assignmentData as any)?.user_id,
              emergencyData?.assigned_ambulance_id,
            ]
              .map((v) => String(v ?? "").trim())
              .filter((v) => v.length > 0),
          ),
        );

        if (candidateIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, phone, role")
            .in("id", candidateIds)
            .limit(10);

          resolvedPhone =
            firstNonEmptyPhone(
              ...(profiles || [])
                .map((p: any) => p.phone),
            ) || "";
        }
      }

      if (resolvedPhone) {
        ambulance = {
          ...(ambulanceData as any),
          driver_phone: resolvedPhone,
          phone: firstNonEmptyPhone((ambulanceData as any)?.phone, resolvedPhone),
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
      emergency: emergencyData ? normalizeEmergency(emergencyData) : null,
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

/**
 * Update emergency status (patient can cancel)
 */
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
    const { error } = await supabase
      .from("emergency_requests")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", emergencyId);

    if (error) throw error;

    // When terminal, close assignments and free ambulance
    if (status === "cancelled" || status === "completed") {
      await supabase
        .from("emergency_assignments")
        .update({ status: "declined", completed_at: new Date().toISOString() })
        .eq("emergency_id", emergencyId)
        .in("status", ["pending", "accepted"]);

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

/**
 * Patient cancellation guardrail:
 * - only the same patient can cancel
 * - only within first N minutes (default 3)
 * - only while request is non-terminal
 */
export const cancelEmergencyWithinWindow = async (
  emergencyId: string,
  patientId: string,
  maxMinutes: number = EMERGENCY_CANCEL_WINDOW_MINUTES,
): Promise<{ success: boolean; error: Error | null; remainingSeconds: number }> => {
  try {
    const { data, error } = await supabase
      .from("emergency_requests")
      .select("id, patient_id, status, created_at")
      .eq("id", emergencyId)
      .maybeSingle();

    if (error) throw error;
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
        error: new Error("You are not allowed to cancel this emergency request."),
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

    const status = String(data.status || "pending");
    if (!["pending", "assigned"].includes(status)) {
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

/**
 * Subscribe to emergency status updates
 */
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

      // Immediate sync prevents stale UI when subscription attaches late.
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

/**
 * Subscribe to ambulance location updates (listens on ambulances table,
 * so we track changes to last_known_location).
 */
export const subscribeToAmbulanceLocation = (
  ambulanceId: string,
  onUpdate: (latitude: number, longitude: number) => void,
) => {
  const subscription = supabase
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
    .subscribe();

  return () => {
    supabase.removeChannel(subscription);
  };
};
