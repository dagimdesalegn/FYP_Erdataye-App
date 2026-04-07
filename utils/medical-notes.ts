/**
 * Medical Notes — utilities for adding / reading clinical notes on emergencies.
 *
 * Drivers can record initial assessment & transport observations.
 * Hospital staff can record treatment notes & discharge summaries.
 */
import { backendGet, backendPost } from "./api";
import { supabase } from "./supabase";

/* ─── Types ───────────────────────────────────────────────────── */

export type NoteType =
  | "initial_assessment"
  | "transport_observation"
  | "treatment"
  | "discharge"
  | "general";

export interface Vitals {
  blood_pressure?: string;
  heart_rate?: number;
  spo2?: number;
  temperature?: number;
  respiratory_rate?: number;
  consciousness_level?: string;
}

export interface MedicalNote {
  id: string;
  emergency_id: string;
  author_id: string;
  author_role: string;
  author_name?: string | null;
  note_type: NoteType;
  content: string;
  vitals?: Vitals | null;
  created_at: string;
}

interface MedicalNoteRow {
  id: string;
  emergency_id: string;
  author_id: string;
  author_role: string;
  author_name?: string | null;
  note_type: NoteType;
  content: string;
  vitals?: Vitals | null;
  created_at: string;
}

const isMissingMedicalNotesEndpoint = (message: string): boolean => {
  const m = message.toLowerCase();
  return m.includes("404") || m.includes("not found");
};

const mapRowToNote = (row: MedicalNoteRow): MedicalNote => ({
  id: row.id,
  emergency_id: row.emergency_id,
  author_id: row.author_id,
  author_role: row.author_role,
  author_name: row.author_name ?? null,
  note_type: row.note_type,
  content: row.content,
  vitals: row.vitals ?? null,
  created_at: row.created_at,
});

async function fallbackInsertMedicalNote(
  emergencyId: string,
  noteType: NoteType,
  content: string,
  vitals?: Vitals | null,
): Promise<{ note: MedicalNote | null; error: string | null }> {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { note: null, error: "Authentication required" };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role,full_name")
      .eq("id", user.id)
      .maybeSingle();

    const role = String((profile as any)?.role || "ambulance").toLowerCase();
    const authorName =
      String((profile as any)?.full_name || "").trim() || user.email || null;

    const payload: Record<string, unknown> = {
      emergency_id: emergencyId,
      author_id: user.id,
      author_role: role,
      author_name: authorName,
      note_type: noteType,
      content,
    };

    if (
      vitals &&
      Object.values(vitals).some(
        (v) => v !== undefined && v !== "" && v !== null,
      )
    ) {
      payload.vitals = vitals;
    }

    const { data, error } = await supabase
      .from("medical_notes")
      .insert(payload)
      .select(
        "id,emergency_id,author_id,author_role,author_name,note_type,content,vitals,created_at",
      )
      .single();

    if (error || !data) {
      return {
        note: null,
        error: error?.message || "Failed to add medical note",
      };
    }

    return { note: mapRowToNote(data as MedicalNoteRow), error: null };
  } catch (err: any) {
    return { note: null, error: err?.message || "Failed to add medical note" };
  }
}

async function fallbackGetMedicalNotes(
  emergencyId: string,
): Promise<{ notes: MedicalNote[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("medical_notes")
      .select(
        "id,emergency_id,author_id,author_role,author_name,note_type,content,vitals,created_at",
      )
      .eq("emergency_id", emergencyId)
      .order("created_at", { ascending: true });

    if (error) {
      return {
        notes: [],
        error: error.message || "Failed to load medical notes",
      };
    }

    return {
      notes: (data || []).map((row) => mapRowToNote(row as MedicalNoteRow)),
      error: null,
    };
  } catch (err: any) {
    return { notes: [], error: err?.message || "Failed to load medical notes" };
  }
}

/* ─── API helpers ─────────────────────────────────────────────── */

export async function addMedicalNote(
  emergencyId: string,
  noteType: NoteType,
  content: string,
  vitals?: Vitals | null,
): Promise<{ note: MedicalNote | null; error: string | null }> {
  if (!emergencyId) {
    return { note: null, error: "Missing emergency ID for note submission" };
  }
  try {
    const body: Record<string, unknown> = { note_type: noteType, content };
    if (
      vitals &&
      Object.values(vitals).some(
        (v) => v !== undefined && v !== "" && v !== null,
      )
    ) {
      body.vitals = vitals;
    }
    const note = await backendPost<MedicalNote>(
      `/ops/emergencies/${emergencyId}/medical-notes`,
      body,
    );
    return { note, error: null };
  } catch (err: any) {
    const message = err?.message || "Failed to add medical note";
    if (isMissingMedicalNotesEndpoint(message)) {
      return fallbackInsertMedicalNote(emergencyId, noteType, content, vitals);
    }
    return { note: null, error: message };
  }
}

export async function getMedicalNotes(
  emergencyId: string,
): Promise<{ notes: MedicalNote[]; error: string | null }> {
  if (!emergencyId) {
    return { notes: [], error: "Missing emergency ID for note lookup" };
  }
  try {
    const notes = await backendGet<MedicalNote[]>(
      `/ops/emergencies/${emergencyId}/medical-notes`,
    );
    return { notes: notes || [], error: null };
  } catch (err: any) {
    const message = err?.message || "Failed to load medical notes";
    if (isMissingMedicalNotesEndpoint(message)) {
      return fallbackGetMedicalNotes(emergencyId);
    }
    return { notes: [], error: message };
  }
}

/* ─── Display helpers ─────────────────────────────────────────── */

export const NOTE_TYPE_LABELS: Record<
  NoteType,
  { label: string; icon: string; color: string }
> = {
  initial_assessment: {
    label: "Initial Assessment",
    icon: "assignment",
    color: "#0EA5E9",
  },
  transport_observation: {
    label: "Transport Observation",
    icon: "local-shipping",
    color: "#8B5CF6",
  },
  treatment: { label: "Treatment", icon: "healing", color: "#10B981" },
  discharge: {
    label: "Discharge Summary",
    icon: "check-circle",
    color: "#059669",
  },
  general: { label: "General Note", icon: "notes", color: "#6B7280" },
};

export function formatNoteTime(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return (
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
      " · " +
      d.toLocaleDateString([], { month: "short", day: "numeric" })
    );
  } catch {
    return isoDate;
  }
}
