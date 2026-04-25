import { AppHeader } from "@/components/app-header";
import { useAppState } from "@/components/app-state";
import { HtmlMapView } from "@/components/html-map-view";
import { LanguageToggle } from "@/components/language-toggle";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { backendGet, backendPost, backendPut } from "@/utils/api";
import { signOut } from "@/utils/auth";
import {
    EmergencyRequest,
    buildDriverPatientMapHtml,
    buildMapHtml,
    formatCoords,
    normalizeEmergency,
    parsePostGISPoint,
} from "@/utils/emergency";
import {
    NOTE_TYPE_LABELS,
    addMedicalNote,
    formatNoteTime,
    getMedicalNotes,
    type MedicalNote,
    type NoteType,
    type Vitals,
} from "@/utils/medical-notes";
import { subscribeToAmbulanceLocation } from "@/utils/patient";
import { MedicalProfile, UserProfile } from "@/utils/profile";
import { supabase } from "@/utils/supabase";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    FlatList,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from "react-native";

/* ─── Types ───────────────────────────────────────────────────── */

interface EmergencyWithPatient extends EmergencyRequest {
  patient_profile?: UserProfile;
  patient_medical?: MedicalProfile;
  national_id?: string | null;
  ambulance_vehicle?: string | null;
  ambulance_latitude?: number | null;
  ambulance_longitude?: number | null;
}

interface HospitalFleetResponse {
  hospital_id: string;
  total_ambulances: number;
  available_ambulances: number;
  busy_ambulances: number;
  ambulances: any[];
}

interface HospitalProfileResponse {
  hospital_id: string;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  is_accepting_emergencies?: boolean | null;
  max_concurrent_emergencies?: number | null;
  dispatch_weight?: number | null;
  trauma_capable?: boolean | null;
  icu_beds_available?: number | null;
  average_handover_minutes?: number | null;
}

interface AmbulanceApprovalRequest {
  user_id: string;
  hospital_id: string;
  full_name?: string | null;
  phone?: string | null;
  national_id?: string | null;
  vehicle_number?: string | null;
  registration_number?: string | null;
  ambulance_type?: string | null;
  status: "pending" | "approved" | "rejected";
  requested_at?: string | null;
  updated_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
}

type StatusFilter = "all" | "active" | "at_hospital" | "completed";

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  assigned: "#3B82F6",
  en_route: "#8B5CF6",
  arrived: "#10B981",
  at_hospital: "#06B6D4",
  completed: "#6B7280",
  cancelled: "#EF4444",
};

const TYPE_COLORS: Record<string, string> = {
  accident: "#DC2626",
  cardiac: "#EF4444",
  medical: "#3B82F6",
  maternity: "#EC4899",
  fire: "#F97316",
  other: "#6B7280",
};

/* ─── Component ───────────────────────────────────────────────── */

export default function HospitalDashboard() {
  const _authLoading = useAuthGuard(["hospital"]);
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? "light";
  const isDark = theme === "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const { user, setUser, setRegistered } = useAppState();
  const { showError, showSuccess } = useModal();

  const [emergencies, setEmergencies] = useState<EmergencyWithPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmergency, setSelectedEmergency] =
    useState<EmergencyWithPatient | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const livePulse = useRef(new Animated.Value(1)).current;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [fleet, setFleet] = useState<HospitalFleetResponse | null>(null);
  const [hospitalName, setHospitalName] = useState("Hospital Dashboard");
  const [hospitalProfile, setHospitalProfile] =
    useState<HospitalProfileResponse | null>(null);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    address: "",
    phone: "",
    isAcceptingEmergencies: true,
    traumaCapable: false,
    maxConcurrent: "",
    dispatchWeight: "1",
    icuBeds: "0",
    averageHandover: "25",
  });
  const [approvalRequests, setApprovalRequests] = useState<AmbulanceApprovalRequest[]>([]);
  const [approvalUpdatingUserId, setApprovalUpdatingUserId] = useState<string | null>(null);
  const [approvalConfirm, setApprovalConfirm] = useState<{
    request: AmbulanceApprovalRequest;
    decision: "approved" | "rejected";
  } | null>(null);

  // Medical notes state
  const [medicalNotes, setMedicalNotes] = useState<MedicalNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [hospitalNoteContent, setHospitalNoteContent] = useState("");
  const [hospitalNoteType, setHospitalNoteType] =
    useState<NoteType>("treatment");
  const [hospitalMedicalConditions, setHospitalMedicalConditions] =
    useState("");
  const [hospitalVitals, setHospitalVitals] = useState<Vitals>({});
  const [showHospitalVitals, setShowHospitalVitals] = useState(false);
  const [submittingHospitalNote, setSubmittingHospitalNote] = useState(false);

  // Notification bell badge state
  const [notifCount, setNotifCount] = useState(0);
  const [notifHistory, setNotifHistory] = useState<
    { message: string; color: string; time: number }[]
  >([]);
  const [notifPanelVisible, setNotifPanelVisible] = useState(false);
  const isLoggingOutRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const inputBg = colors.surfaceMuted;
  const inputBorder = colors.border;
  const subText = colors.textMuted;

  /* ─── Notification banner ───────────────────────────────────── */
  const [notification, setNotification] = useState<{
    message: string;
    color: string;
  } | null>(null);
  const notifOpacity = useRef(new Animated.Value(0)).current;
  const prevStatusMap = useRef<Record<string, string>>({});

  // Keep open modal in sync with realtime data
  useEffect(() => {
    if (!selectedEmergency || !modalVisible) return;
    const updated = emergencies.find((e) => e.id === selectedEmergency.id);
    if (updated) {
      const changed =
        updated.status !== selectedEmergency.status ||
        updated.ambulance_latitude !== selectedEmergency.ambulance_latitude ||
        updated.ambulance_longitude !== selectedEmergency.ambulance_longitude;
      if (changed) setSelectedEmergency(updated);
    }
  }, [emergencies, selectedEmergency, modalVisible]);

  // Realtime ambulance location tracking when modal is open
  useEffect(() => {
    if (!selectedEmergency || !modalVisible) return;
    const ambId = selectedEmergency.assigned_ambulance_id;
    if (!ambId) return;
    const unsub = subscribeToAmbulanceLocation(ambId, (lat, lng) => {
      setSelectedEmergency((prev) =>
        prev
          ? { ...prev, ambulance_latitude: lat, ambulance_longitude: lng }
          : prev,
      );
      // Also update the emergencies list so it stays in sync
      setEmergencies((prev) =>
        prev.map((e) =>
          e.id === selectedEmergency.id
            ? { ...e, ambulance_latitude: lat, ambulance_longitude: lng }
            : e,
        ),
      );
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedEmergency?.id,
    selectedEmergency?.assigned_ambulance_id,
    modalVisible,
  ]);

  // Load medical notes when modal opens
  useEffect(() => {
    if (!selectedEmergency || !modalVisible) return;
    let cancelled = false;
    const load = async () => {
      setLoadingNotes(true);
      const { notes } = await getMedicalNotes(selectedEmergency.id);
      if (!cancelled) setMedicalNotes(notes);
      setLoadingNotes(false);
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmergency?.id, modalVisible]);

  useEffect(() => {
    if (!selectedEmergency || !modalVisible) return;
    setHospitalMedicalConditions(
      selectedEmergency.patient_medical?.medical_conditions || "",
    );
  }, [
    selectedEmergency?.id,
    selectedEmergency?.patient_medical?.medical_conditions,
    modalVisible,
  ]);

  const handleSubmitHospitalNote = async () => {
    if (!selectedEmergency) return;
    const nextMedicalConditions = hospitalMedicalConditions.trim();
    const prevMedicalConditions = String(
      selectedEmergency.patient_medical?.medical_conditions || "",
    ).trim();
    const shouldUpdateMedicalConditions =
      nextMedicalConditions !== prevMedicalConditions;
    if (!hospitalNoteContent.trim() && !shouldUpdateMedicalConditions) return;

    setSubmittingHospitalNote(true);
    const hasVitals = Object.values(hospitalVitals).some(
      (v) => v !== undefined && v !== "" && v !== null,
    );

    let savedNote = false;
    let savedMedicalConditions = false;

    if (hospitalNoteContent.trim()) {
      const { note, error } = await addMedicalNote(
        selectedEmergency.id,
        hospitalNoteType,
        hospitalNoteContent.trim(),
        hasVitals ? hospitalVitals : null,
      );
      if (error) {
        showError("Note Failed", error);
      } else if (note) {
        savedNote = true;
        setMedicalNotes((prev) => [...prev, note]);
        setHospitalNoteContent("");
        setHospitalVitals({});
        setShowHospitalVitals(false);
      }
    }

    if (shouldUpdateMedicalConditions) {
      try {
        await backendPut(
          `/ops/emergencies/${selectedEmergency.id}/patient-medical`,
          { medical_conditions: nextMedicalConditions },
        );
        savedMedicalConditions = true;
        const now = new Date().toISOString();
        const fallbackMedical: MedicalProfile = {
          id: selectedEmergency.patient_medical?.id || "",
          user_id:
            selectedEmergency.patient_medical?.user_id ||
            selectedEmergency.patient_id,
          blood_type: selectedEmergency.patient_medical?.blood_type || "",
          allergies: selectedEmergency.patient_medical?.allergies || "",
          medical_conditions: nextMedicalConditions,
          emergency_contact_name:
            selectedEmergency.patient_medical?.emergency_contact_name || "",
          emergency_contact_phone:
            selectedEmergency.patient_medical?.emergency_contact_phone || "",
          created_at: selectedEmergency.patient_medical?.created_at || now,
          updated_at: now,
        };
        setSelectedEmergency((prev) =>
          prev && prev.id === selectedEmergency.id
            ? { ...prev, patient_medical: fallbackMedical }
            : prev,
        );
        setEmergencies((prev) =>
          prev.map((emergency) =>
            emergency.id === selectedEmergency.id
              ? { ...emergency, patient_medical: fallbackMedical }
              : emergency,
          ),
        );
      } catch (error: any) {
        showError(
          "Medical Conditions Failed",
          error?.message || "Unable to update patient medical conditions.",
        );
      }
    }

    if (savedNote || savedMedicalConditions) {
      const parts = [];
      if (savedNote) parts.push("medical note saved");
      if (savedMedicalConditions) parts.push("medical conditions updated");
      showSuccess("Saved", `${parts.join(" and ")} successfully.`);
    }
    setSubmittingHospitalNote(false);
  };

  // Pulse animation for live indicators
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(livePulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [livePulse]);

  const showNotification = useCallback(
    (message: string, color: string) => {
      setNotification({ message, color });
      setNotifHistory((prev) => [
        { message, color, time: Date.now() },
        ...prev.slice(0, 49),
      ]);
      notifOpacity.setValue(0);
      Animated.sequence([
        Animated.timing(notifOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(4000),
        Animated.timing(notifOpacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => setNotification(null));
    },
    [notifOpacity],
  );

  const STATUS_LABELS: Record<string, string> = {
    pending: "New Emergency Request",
    assigned: "Ambulance Assigned",
    en_route: "Ambulance En Route",
    at_scene: "Ambulance At Scene",
    arrived: "Ambulance Arrived at Patient",
    transporting: "Patient Being Transported",
    at_hospital: "Patient Arriving at Hospital",
    completed: "Emergency Completed",
    cancelled: "Emergency Cancelled",
  };

  /* ─── Data fetching ─────────────────────────────────────────── */

  const fetchEmergencies = useCallback(async () => {
    if (isLoggingOutRef.current || !user?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const [emergencyResult, fleetResult, profileResult, approvalsResult] =
        await Promise.allSettled([
          backendGet<EmergencyWithPatient[]>("/ops/hospital/emergencies"),
          backendGet<HospitalFleetResponse>("/ops/hospital/fleet"),
          backendGet<HospitalProfileResponse>("/ops/hospital/profile"),
          backendGet<AmbulanceApprovalRequest[]>(
            "/ops/hospital/ambulance-approvals?status_filter=pending",
          ),
        ]);

      if (emergencyResult.status !== "fulfilled") {
        throw emergencyResult.reason;
      }

      const data = emergencyResult.value;
      const mapped = data.map(
        (e) =>
          ({
            ...normalizeEmergency(e),
            patient_profile: e.patient_profile,
            patient_medical: e.patient_medical,
            national_id: (e as any).national_id ?? null,
            ambulance_vehicle: (e as any).ambulance_vehicle ?? null,
            ambulance_latitude: (e as any).ambulance_latitude ?? null,
            ambulance_longitude: (e as any).ambulance_longitude ?? null,
          }) as EmergencyWithPatient,
      );
      setEmergencies(mapped);
      // Track statuses for notification diffing
      const newMap: Record<string, string> = {};
      for (const e of mapped) newMap[e.id] = e.status;
      prevStatusMap.current = newMap;

      if (fleetResult.status === "fulfilled") {
        setFleet(fleetResult.value);
      } else {
        // Keep dashboard usable when fleet linkage is missing.
        setFleet({
          hospital_id: "",
          total_ambulances: 0,
          available_ambulances: 0,
          busy_ambulances: 0,
          ambulances: [],
        });
        console.warn("Hospital fleet unavailable:", fleetResult.reason);
      }

      if (profileResult && profileResult.status === "fulfilled") {
        setHospitalProfile(profileResult.value);
        const resolvedName = String(profileResult.value?.name || "").trim();
        if (resolvedName) {
          setHospitalName(resolvedName);
          if (user && resolvedName !== (user.fullName || "")) {
            setUser({ ...user, fullName: resolvedName });
          }
        } else if (user?.fullName) {
          setHospitalName(user.fullName);
        }
      } else if (user?.fullName) {
        setHospitalName(user.fullName);
      }

      if (approvalsResult.status === "fulfilled") {
        setApprovalRequests(Array.isArray(approvalsResult.value) ? approvalsResult.value : []);
      }
    } catch (error) {
      console.error("Error fetching emergencies:", error);
      // Avoid noisy popup loops on free-tier/temporary data inconsistencies.
      const msg = String((error as any)?.message ?? error ?? "").toLowerCase();
      const isAuthTransitionError =
        msg.includes("auth session missing") ||
        msg.includes("not authenticated") ||
        msg.includes("session does not exist") ||
        msg.includes("session missing") ||
        msg.includes("jwt expired") ||
        msg.includes("401");
      if (!msg.includes("hospital_id is required") && !isAuthTransitionError) {
        showError("Load Failed", "Failed to load emergency requests");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError, setUser, user, user?.fullName, user?.id]);

  useEffect(() => {
    if (!hospitalProfile) return;
    setProfileForm({
      name: String(hospitalProfile.name || ""),
      address: String(hospitalProfile.address || ""),
      phone: String(hospitalProfile.phone || ""),
      isAcceptingEmergencies:
        hospitalProfile.is_accepting_emergencies !== false,
      traumaCapable: Boolean(hospitalProfile.trauma_capable),
      maxConcurrent: String(hospitalProfile.max_concurrent_emergencies ?? ""),
      dispatchWeight: String(hospitalProfile.dispatch_weight ?? "1"),
      icuBeds: String(hospitalProfile.icu_beds_available ?? "0"),
      averageHandover: String(hospitalProfile.average_handover_minutes ?? "25"),
    });
  }, [hospitalProfile]);

  const updateStatus = async (
    emergencyId: string,
    newStatus: EmergencyRequest["status"],
  ) => {
    if (statusUpdating) return;
    setStatusUpdating(newStatus);
    try {
      await backendPut(`/ops/emergencies/${emergencyId}/status`, {
        status: newStatus,
      });
      showSuccess(
        "Status Updated",
        `Status updated to ${newStatus.replace("_", " ")}`,
      );
      // Update selected emergency in-place so the modal stays open
      setSelectedEmergency((prev) =>
        prev && prev.id === emergencyId ? { ...prev, status: newStatus } : prev,
      );
      fetchEmergencies();
    } catch {
      showError("Update Failed", "Failed to update status");
    } finally {
      setStatusUpdating(null);
    }
  };

  /** Hospital-owned actions: only handover stages */
  const getHospitalStatusActions = (
    status: string,
  ): {
    label: string;
    next: EmergencyRequest["status"];
    color: string;
    icon: string;
  }[] => {
    if (status === "transporting")
      return [
        {
          label: "Mark at Hospital",
          next: "at_hospital",
          color: "#06B6D4",
          icon: "local-hospital",
        },
      ];
    if (status === "at_hospital")
      return [
        {
          label: "Mark Completed",
          next: "completed",
          color: "#10B981",
          icon: "check-circle",
        },
      ];
    return [];
  };

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      fetchEmergencies();
    }, 450);
  }, [fetchEmergencies]);

  useEffect(() => {
    fetchEmergencies();
    const channel = supabase
      .channel("hospital_emergency_updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "emergency_requests" },
        (payload: any) => {
          // Show notification for status updates (before re-fetch overwrites prevStatusMap)
          if (payload.eventType === "UPDATE" && payload.new) {
            const emergencyId = payload.new.id;
            const newStatus = payload.new.status;
            const oldStatus = prevStatusMap.current[emergencyId];
            if (oldStatus && oldStatus !== newStatus) {
              const type = (payload.new.emergency_type || "emergency").replace(
                /_/g,
                " ",
              );
              const label =
                STATUS_LABELS[newStatus] || newStatus.replace(/_/g, " ");
              const color = STATUS_COLORS[newStatus] || "#3B82F6";
              showNotification(
                `${label} — ${type.charAt(0).toUpperCase() + type.slice(1)} case`,
                color,
              );
              setNotifCount((c) => c + 1);
            }
          } else if (payload.eventType === "INSERT" && payload.new) {
            const type = (payload.new.emergency_type || "emergency").replace(
              /_/g,
              " ",
            );
            showNotification(
              `New Emergency — ${type.charAt(0).toUpperCase() + type.slice(1)} case`,
              "#F59E0B",
            );
            setNotifCount((c) => c + 1);
          }
          scheduleRefresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ambulances" },
        (payload: any) => {
          // Inline-update ambulance coords for instant map refresh
          if (payload.eventType === "UPDATE" && payload.new) {
            const ambId = String(payload.new.id || "");
            const parsed = parsePostGISPoint(payload.new.last_known_location);
            if (parsed && ambId) {
              setEmergencies((prev) =>
                prev.map((e) =>
                  e.assigned_ambulance_id === ambId
                    ? {
                        ...e,
                        ambulance_latitude: parsed.latitude,
                        ambulance_longitude: parsed.longitude,
                      }
                    : e,
                ),
              );
            }
          }
          scheduleRefresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hospitals" },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hospital_ambulance_links" },
        () => scheduleRefresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_profiles" },
        () => scheduleRefresh(),
      )
      .subscribe();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchEmergencies, scheduleRefresh]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchEmergencies();
  }, [fetchEmergencies]);

  const handleLogout = async () => {
    isLoggingOutRef.current = true;
    setProfileVisible(false);
    const { error: logoutErr } = await signOut();
    if (!logoutErr) {
      setEmergencies([]);
      setFleet(null);
      setHospitalProfile(null);
      setUser(null);
      setRegistered(false);
      router.replace("/staff");
    } else {
      isLoggingOutRef.current = false;
      showError("Logout Failed", "Failed to sign out");
    }
  };

  const saveHospitalProfile = async () => {
    setSavingProfile(true);
    try {
      const updatedProfile = await backendPut<HospitalProfileResponse>(
        "/ops/hospital/profile",
        {
          name: profileForm.name.trim() || undefined,
          address: profileForm.address.trim() || undefined,
          phone: profileForm.phone.trim() || undefined,
          is_accepting_emergencies: profileForm.isAcceptingEmergencies,
          trauma_capable: profileForm.traumaCapable,
          max_concurrent_emergencies: profileForm.maxConcurrent.trim()
            ? Number(profileForm.maxConcurrent)
            : undefined,
          dispatch_weight: profileForm.dispatchWeight.trim()
            ? Number(profileForm.dispatchWeight)
            : undefined,
          icu_beds_available: profileForm.icuBeds.trim()
            ? Number(profileForm.icuBeds)
            : undefined,
          average_handover_minutes: profileForm.averageHandover.trim()
            ? Number(profileForm.averageHandover)
            : undefined,
        },
      );

      setHospitalProfile(updatedProfile);
      const updatedName = String(
        updatedProfile?.name || profileForm.name || "",
      ).trim();
      if (updatedName) {
        setHospitalName(updatedName);
        if (user) {
          setUser({ ...user, fullName: updatedName });
        }
      }

      setEditProfileVisible(false);
      showSuccess("Profile Updated", "Hospital profile updated successfully.");
      fetchEmergencies();
    } catch (error) {
      showError(
        "Update Failed",
        String((error as any)?.message || "Failed to update hospital profile"),
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const approvalDisplay = (v: string | null | undefined) => {
    const s = String(v ?? "").trim();
    return s.length > 0 ? s : "—";
  };

  const handleApprovalDecision = async (
    requestUserId: string,
    decision: "approved" | "rejected",
  ) => {
    if (approvalUpdatingUserId) return;
    setApprovalConfirm(null);
    setApprovalUpdatingUserId(requestUserId);
    try {
      await backendPost(
        `/ops/hospital/ambulance-approvals/${requestUserId}/decision`,
        {
          decision,
          note: decision === "approved" ? "Approved by hospital dashboard" : "Rejected by hospital dashboard",
        },
      );
      showSuccess(
        decision === "approved" ? "Registration Approved" : "Registration Rejected",
        decision === "approved"
          ? "Ambulance registration approved and activated."
          : "Ambulance registration rejected.",
      );
      fetchEmergencies();
    } catch (error) {
      showError(
        "Approval Update Failed",
        String((error as any)?.message || "Unable to update registration approval status"),
      );
    } finally {
      setApprovalUpdatingUserId(null);
    }
  };

  const formatDateTime = (d: string) => {
    try {
      return new Date(d).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return d;
    }
  };

  /* ─── Computed ──────────────────────────────────────────────── */

  const counts = {
    all: emergencies.length,
    active: emergencies.filter((e) =>
      [
        "pending",
        "assigned",
        "en_route",
        "at_scene",
        "arrived",
        "transporting",
      ].includes(e.status),
    ).length,
    at_hospital: emergencies.filter((e) => e.status === "at_hospital").length,
    completed: emergencies.filter((e) => e.status === "completed").length,
    cancelled: emergencies.filter((e) => e.status === "cancelled").length,
    pending: emergencies.filter((e) => e.status === "pending").length,
  };

  const filtered = emergencies
    .filter((e) => {
      if (statusFilter === "active")
        return [
          "pending",
          "assigned",
          "en_route",
          "at_scene",
          "arrived",
          "transporting",
        ].includes(e.status);
      if (statusFilter === "at_hospital") return e.status === "at_hospital";
      if (statusFilter === "completed")
        return ["completed", "cancelled"].includes(e.status);
      return true;
    })
    .filter((e) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (e.patient_profile?.full_name ?? "").toLowerCase().includes(q) ||
        e.emergency_type.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q)
      );
    });

  /* ─── Stat cards ────────────────────────────────────────────── */

  const statCards = [
    {
      label: "Total",
      count: counts.all,
      icon: "list-alt" as const,
      color: "#6366F1",
    },
    {
      label: "Pending",
      count: counts.pending,
      icon: "hourglass-empty" as const,
      color: "#F59E0B",
    },
    {
      label: "Active (In Progress)",
      count: counts.active,
      icon: "local-shipping" as const,
      color: "#8B5CF6",
    },
    {
      label: "At Hospital",
      count: counts.at_hospital,
      icon: "local-hospital" as const,
      color: "#06B6D4",
    },
    {
      label: "Completed",
      count: counts.completed,
      icon: "check-circle" as const,
      color: "#10B981",
    },
    {
      label: "Cancelled",
      count: counts.cancelled,
      icon: "cancel" as const,
      color: "#EF4444",
    },
  ];

  /* ─── Card renderer ─────────────────────────────────────────── */

  const timeAgo = (dateStr: string): string => {
    try {
      const now = Date.now();
      const then = new Date(dateStr).getTime();
      const diffMs = now - then;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      return `${diffDay}d ago`;
    } catch {
      return dateStr;
    }
  };

  const isActiveStatus = (status: string) =>
    !["completed", "cancelled"].includes(status);

  const PRIORITY_TYPES = ["accident", "cardiac", "fire"];

  const renderEmergencyCard = ({ item }: { item: EmergencyWithPatient }) => {
    const statusColor = STATUS_COLORS[item.status] ?? "#6B7280";
    const typeColor = TYPE_COLORS[item.emergency_type] ?? "#6B7280";
    const isActive = isActiveStatus(item.status);
    const isHighPriority =
      isActive && PRIORITY_TYPES.includes(item.emergency_type);
    return (
      <Pressable
        style={[
          styles.itemCard,
          {
            backgroundColor: cardBg,
            borderColor: isHighPriority ? typeColor + "40" : cardBorder,
          },
        ]}
        onPress={() => {
          setSelectedEmergency(item);
          setModalVisible(true);
        }}
      >
        {/* Left accent stripe */}
        <View
          style={[styles.cardAccentStripe, { backgroundColor: statusColor }]}
        />

        <View style={styles.cardInner}>
          {/* Header: status + type badges + time */}
          <View style={styles.cardHeader}>
            <View style={styles.cardBadgesRow}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusColor + "18" },
                ]}
              >
                {isActive ? (
                  <Animated.View
                    style={[
                      styles.statusDot,
                      { backgroundColor: statusColor, opacity: livePulse },
                    ]}
                  />
                ) : (
                  <View
                    style={[styles.statusDot, { backgroundColor: statusColor }]}
                  />
                )}
                <ThemedText style={[styles.badgeText, { color: statusColor }]}>
                  {item.status.replace("_", " ")}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.typeBadge,
                  { backgroundColor: typeColor + "18" },
                ]}
              >
                <MaterialIcons
                  name={
                    item.emergency_type === "accident"
                      ? "car-crash"
                      : item.emergency_type === "cardiac"
                        ? "favorite"
                        : item.emergency_type === "maternity"
                          ? "pregnant-woman"
                          : item.emergency_type === "fire"
                            ? "local-fire-department"
                            : "medical-services"
                  }
                  size={12}
                  color={typeColor}
                />
                <ThemedText style={[styles.badgeText, { color: typeColor }]}>
                  {item.emergency_type || "medical"}
                </ThemedText>
              </View>
            </View>
            <ThemedText style={[styles.cardTimeAgo, { color: subText }]}>
              {timeAgo(item.created_at)}
            </ThemedText>
          </View>

          {/* Patient info row */}
          <View style={styles.cardBody}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: isActive
                    ? isDark
                      ? "rgba(220,38,38,0.18)"
                      : "rgba(220,38,38,0.10)"
                    : isDark
                      ? "rgba(107,114,128,0.15)"
                      : "rgba(107,114,128,0.08)",
                },
              ]}
            >
              <MaterialIcons
                name="person"
                size={22}
                color={isActive ? "#DC2626" : "#6B7280"}
              />
            </View>
            <View style={styles.cardInfo}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
                {item.patient_profile?.full_name || "Unknown Patient"}
              </ThemedText>
              <ThemedText style={[styles.cardSub, { color: subText }]}>
                {item.patient_profile?.phone || "No phone"}
              </ThemedText>
            </View>
            <View
              style={[
                styles.cardChevronWrap,
                {
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(0,0,0,0.04)",
                },
              ]}
            >
              <MaterialIcons name="chevron-right" size={20} color={subText} />
            </View>
          </View>

          {/* Description preview */}
          {item.description ? (
            <View style={styles.cardDescWrap}>
              <ThemedText
                style={[styles.descText, { color: subText }]}
                numberOfLines={2}
              >
                {item.description}
              </ThemedText>
            </View>
          ) : null}

          {/* Footer: location + time + ambulance */}
          <View
            style={[
              styles.cardFooter,
              {
                borderTopColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)",
              },
            ]}
          >
            {item.latitude !== 0 && (
              <View style={styles.footerItem}>
                <MaterialIcons name="location-on" size={13} color={subText} />
                <ThemedText style={[styles.footerText, { color: subText }]}>
                  {formatCoords(item.latitude, item.longitude)}
                </ThemedText>
              </View>
            )}
            <View style={styles.footerItem}>
              <MaterialIcons name="schedule" size={13} color={subText} />
              <ThemedText style={[styles.footerText, { color: subText }]}>
                {formatDateTime(item.created_at)}
              </ThemedText>
            </View>
            {item.ambulance_vehicle && (
              <View style={styles.footerItem}>
                <MaterialIcons
                  name="local-shipping"
                  size={13}
                  color="#8B5CF6"
                />
                <ThemedText style={[styles.footerText, { color: "#8B5CF6" }]}>
                  {item.ambulance_vehicle}
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  /* ─── Filter chips ──────────────────────────────────────────── */

  const renderFilterChip = (
    filter: StatusFilter,
    label: string,
    count: number,
  ) => {
    const isActive = statusFilter === filter;
    return (
      <Pressable
        key={filter}
        onPress={() => setStatusFilter(filter)}
        style={[
          styles.chip,
          {
            backgroundColor: isActive
              ? "#DC2626"
              : isDark
                ? "#1E2028"
                : "#F3F4F6",
            borderColor: isActive ? "#DC2626" : cardBorder,
          },
        ]}
      >
        <ThemedText
          style={[styles.chipText, { color: isActive ? "#FFF" : colors.text }]}
        >
          {label} ({count})
        </ThemedText>
      </Pressable>
    );
  };

  /* ─── Main render ────────────────────────────────────────────── */

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      {/* ─── Status notification banner ─── */}
      {notification && (
        <Animated.View
          style={[
            styles.notifBanner,
            { backgroundColor: notification.color, opacity: notifOpacity },
          ]}
        >
          <View style={styles.notifIconWrap}>
            <MaterialIcons name="notifications-active" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.notifText}>
              {notification.message}
            </ThemedText>
            <ThemedText style={styles.notifSub}>Live update</ThemedText>
          </View>
        </Animated.View>
      )}

      <AppHeader
        title={hospitalName}
        onProfilePress={() => setProfileVisible(true)}
        rightExtra={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <LanguageToggle />
            <Pressable
              style={styles.notifBellWrap}
              onPress={() => {
                setNotifPanelVisible(true);
                setNotifCount(0);
              }}
            >
              <MaterialIcons
                name={
                  notifCount > 0 ? "notifications-active" : "notifications-none"
                }
                size={22}
                color={notifCount > 0 ? "#DC2626" : subText}
              />
              {notifCount > 0 && (
                <View style={styles.notifBadge}>
                  <ThemedText style={styles.notifBadgeText}>
                    {notifCount > 99 ? "99+" : notifCount}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          </View>
        }
      />

      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          <View
            style={[
              styles.heroCard,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <ThemedText style={[styles.heroTitle, { color: colors.text }]}>
              {hospitalName}
            </ThemedText>
            <ThemedText style={[styles.heroSub, { color: subText }]}>
              {hospitalProfile?.address
                ? `${hospitalProfile.address} · ${hospitalProfile.phone || "No phone"}`
                : "Manage emergency intake, fleet readiness, and patient handover in real time."}
            </ThemedText>
          </View>

          {/* Stat cards */}
          <View style={styles.statsGrid}>
            {statCards.map((stat) => (
              <View
                key={stat.label}
                style={[
                  styles.statCard,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <View
                  style={[
                    styles.statIcon,
                    { backgroundColor: stat.color + "15" },
                  ]}
                >
                  <MaterialIcons
                    name={stat.icon}
                    size={20}
                    color={stat.color}
                  />
                </View>
                <ThemedText style={[styles.statCount, { color: colors.text }]}>
                  {stat.count}
                </ThemedText>
                <ThemedText style={[styles.statLabel, { color: subText }]}>
                  {stat.label}
                </ThemedText>
              </View>
            ))}
          </View>

          {/* Fleet readiness card */}
          {fleet && (
            <View
              style={[
                styles.fleetCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <View style={styles.sectionHeader}>
                <MaterialIcons
                  name="local-shipping"
                  size={18}
                  color="#8B5CF6"
                />
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.text }]}
                >
                  Fleet Readiness
                </ThemedText>
              </View>
              <View style={styles.fleetRow}>
                <View style={styles.fleetItem}>
                  <ThemedText style={[styles.fleetNum, { color: "#10B981" }]}>
                    {fleet.available_ambulances}
                  </ThemedText>
                  <ThemedText style={[styles.fleetLabel, { color: subText }]}>
                    Available
                  </ThemedText>
                </View>
                <View
                  style={[styles.fleetDivider, { backgroundColor: cardBorder }]}
                />
                <View style={styles.fleetItem}>
                  <ThemedText style={[styles.fleetNum, { color: "#F59E0B" }]}>
                    {fleet.busy_ambulances}
                  </ThemedText>
                  <ThemedText style={[styles.fleetLabel, { color: subText }]}>
                    Busy
                  </ThemedText>
                </View>
                <View
                  style={[styles.fleetDivider, { backgroundColor: cardBorder }]}
                />
                <View style={styles.fleetItem}>
                  <ThemedText style={[styles.fleetNum, { color: colors.text }]}>
                    {fleet.total_ambulances}
                  </ThemedText>
                  <ThemedText style={[styles.fleetLabel, { color: subText }]}>
                    Total
                  </ThemedText>
                </View>
              </View>
            </View>
          )}

          <View
            style={[
              styles.fleetCard,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.sectionHeader}>
              <MaterialIcons name="verified-user" size={18} color="#0EA5E9" />
              <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Ambulance Approvals ({approvalRequests.length})</ThemedText>
            </View>

            {approvalRequests.length === 0 ? (
              <View style={[styles.approvalItem, { borderColor: cardBorder, backgroundColor: isDark ? "#161A22" : "#F8FAFC" }]}>
                <ThemedText style={[styles.approvalMeta, { color: subText }]}>No pending ambulance approvals right now.</ThemedText>
                <Pressable
                  style={[styles.approvalBtn, { backgroundColor: "#2563EB", marginTop: 10, alignSelf: "flex-start" }]}
                  onPress={fetchEmergencies}
                >
                  <ThemedText style={styles.approvalBtnText}>Refresh Approvals</ThemedText>
                </Pressable>
              </View>
            ) : (
              approvalRequests.map((request) => (
                <View
                  key={request.user_id}
                  style={[
                    styles.approvalItem,
                    { borderColor: cardBorder, backgroundColor: isDark ? "#161A22" : "#F8FAFC" },
                  ]}
                >
                  <View style={styles.approvalHeader}>
                    <ThemedText style={[styles.approvalName, { color: colors.text }]}>
                      {request.full_name || "Ambulance Applicant"}
                    </ThemedText>
                    <ThemedText style={[styles.approvalMeta, { color: subText }]}>
                      {request.ambulance_type || "standard"}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.approvalMeta, { color: subText }]}>
                    {request.phone || "No phone"}
                    {request.national_id
                      ? ` • ID ${request.national_id}`
                      : ""}
                    {` • ${request.vehicle_number || "No plate"}`}
                  </ThemedText>
                  <View style={styles.approvalActions}>
                    <Pressable
                      style={[styles.approvalBtn, { backgroundColor: "#10B981" }]}
                      disabled={approvalUpdatingUserId === request.user_id}
                      onPress={() =>
                        setApprovalConfirm({ request, decision: "approved" })
                      }
                    >
                      <ThemedText style={styles.approvalBtnText}>Approve</ThemedText>
                    </Pressable>
                    <Pressable
                      style={[styles.approvalBtn, { backgroundColor: "#DC2626" }]}
                      disabled={approvalUpdatingUserId === request.user_id}
                      onPress={() =>
                        setApprovalConfirm({ request, decision: "rejected" })
                      }
                    >
                      <ThemedText style={styles.approvalBtnText}>Reject</ThemedText>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Search bar */}
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: inputBg, borderColor: inputBorder },
            ]}
          >
            <MaterialIcons name="search" size={20} color={subText} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search by patient, type, or status..."
              placeholderTextColor={subText}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch("")}>
                <MaterialIcons name="close" size={18} color={subText} />
              </Pressable>
            )}
          </View>

          {/* Filter chips */}
          <View style={styles.filterRow}>
            {renderFilterChip("all", "All", counts.all)}
            {renderFilterChip("active", "Active", counts.active)}
            {renderFilterChip("at_hospital", "At Hospital", counts.at_hospital)}
            {renderFilterChip(
              "completed",
              "Resolved",
              counts.completed + counts.cancelled,
            )}
          </View>

          {/* Emergency list */}
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#DC2626" />
              <ThemedText style={[styles.loadingText, { color: subText }]}>
                Loading emergencies...
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={renderEmergencyCard}
              scrollEnabled={false}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor="#DC2626"
                />
              }
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <MaterialIcons
                    name={search ? "search-off" : "check-circle"}
                    size={48}
                    color={subText}
                  />
                  <ThemedText style={[styles.emptyText, { color: subText }]}>
                    {search
                      ? "No emergencies match your search"
                      : "No emergencies found"}
                  </ThemedText>
                  {!search && (
                    <ThemedText style={[styles.emptySub, { color: subText }]}>
                      Pull down to refresh
                    </ThemedText>
                  )}
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      {/* Ambulance registration — review all submitted fields before confirm */}
      <Modal
        animationType="fade"
        transparent
        visible={approvalConfirm !== null}
        onRequestClose={() => setApprovalConfirm(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setApprovalConfirm(null)}
        >
          <Pressable
            style={[
              styles.modalContent,
              { backgroundColor: isDark ? "#1E2028" : "#FFFFFF", maxHeight: "88%" },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {approvalConfirm && (
              <>
                <View style={styles.modalHeader}>
                  <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                    {approvalConfirm.decision === "approved"
                      ? "Confirm approval"
                      : "Confirm rejection"}
                  </ThemedText>
                  <Pressable
                    onPress={() => setApprovalConfirm(null)}
                    style={styles.closeBtn}
                  >
                    <MaterialIcons name="close" size={22} color={colors.text} />
                  </Pressable>
                </View>
                <ThemedText
                  style={[styles.approvalMeta, { color: subText, marginBottom: 12 }]}
                >
                  Review every field below before you continue.
                </ThemedText>
                <ScrollView
                  style={{ maxHeight: 360 }}
                  showsVerticalScrollIndicator
                >
                  {(
                    [
                      ["Full name", approvalDisplay(approvalConfirm.request.full_name)],
                      ["Phone", approvalDisplay(approvalConfirm.request.phone)],
                      [
                        "National ID (Fayda)",
                        approvalDisplay(approvalConfirm.request.national_id),
                      ],
                      [
                        "Plate / vehicle number",
                        approvalDisplay(approvalConfirm.request.vehicle_number),
                      ],
                      [
                        "Registration number",
                        approvalDisplay(approvalConfirm.request.registration_number),
                      ],
                      [
                        "Ambulance type",
                        approvalDisplay(approvalConfirm.request.ambulance_type),
                      ],
                      ["Status", approvalDisplay(approvalConfirm.request.status)],
                      [
                        "Requested at",
                        approvalConfirm.request.requested_at
                          ? formatDateTime(approvalConfirm.request.requested_at)
                          : "—",
                      ],
                      [
                        "Last updated",
                        approvalConfirm.request.updated_at
                          ? formatDateTime(approvalConfirm.request.updated_at)
                          : "—",
                      ],
                      ["Driver account ID", approvalDisplay(approvalConfirm.request.user_id)],
                      ["Linked hospital ID", approvalDisplay(approvalConfirm.request.hospital_id)],
                      [
                        "Previously reviewed at",
                        approvalConfirm.request.reviewed_at
                          ? formatDateTime(approvalConfirm.request.reviewed_at)
                          : "—",
                      ],
                      ["Reviewed by (user id)", approvalDisplay(approvalConfirm.request.reviewed_by)],
                      ["Review note", approvalDisplay(approvalConfirm.request.review_note)],
                    ] as const
                  ).map(([label, value]) => (
                    <View
                      key={label}
                      style={[
                        styles.approvalDetailRow,
                        {
                          borderBottomColor: isDark
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(0,0,0,0.06)",
                        },
                      ]}
                    >
                      <ThemedText
                        style={[styles.approvalDetailLabel, { color: subText }]}
                      >
                        {label}
                      </ThemedText>
                      <ThemedText
                        style={[styles.approvalDetailValue, { color: colors.text }]}
                      >
                        {value}
                      </ThemedText>
                    </View>
                  ))}
                </ScrollView>
                <View style={[styles.approvalActions, { marginTop: 14 }]}>
                  <Pressable
                    style={[
                      styles.approvalBtn,
                      { backgroundColor: isDark ? "#374151" : "#E5E7EB" },
                    ]}
                    onPress={() => setApprovalConfirm(null)}
                  >
                    <ThemedText
                      style={[styles.approvalBtnText, { color: colors.text }]}
                    >
                      Cancel
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.approvalBtn,
                      {
                        backgroundColor:
                          approvalConfirm.decision === "approved"
                            ? "#10B981"
                            : "#DC2626",
                      },
                    ]}
                    disabled={
                      approvalUpdatingUserId === approvalConfirm.request.user_id
                    }
                    onPress={() =>
                      handleApprovalDecision(
                        approvalConfirm.request.user_id,
                        approvalConfirm.decision,
                      )
                    }
                  >
                    <ThemedText style={styles.approvalBtnText}>
                      {approvalConfirm.decision === "approved"
                        ? "Confirm approve"
                        : "Confirm reject"}
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Patient Details Modal */}
      <Modal
        animationType="fade"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setModalVisible(false)}
        >
          <Pressable
            style={[
              styles.modalContent,
              { backgroundColor: isDark ? "#1E2028" : "#FFFFFF" },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Modal header */}
              <View style={styles.modalHeader}>
                <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                  Patient Details
                </ThemedText>
                <Pressable
                  onPress={() => setModalVisible(false)}
                  style={styles.closeBtn}
                >
                  <MaterialIcons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              {selectedEmergency && (
                <>
                  {/* Status badge bar */}
                  <View
                    style={[
                      styles.modalStatusBar,
                      {
                        backgroundColor:
                          (STATUS_COLORS[selectedEmergency.status] ||
                            "#6B7280") + "18",
                      },
                    ]}
                  >
                    {!["completed", "cancelled"].includes(
                      selectedEmergency.status,
                    ) && (
                      <Animated.View
                        style={[
                          styles.liveDot,
                          {
                            backgroundColor:
                              STATUS_COLORS[selectedEmergency.status] ||
                              "#6B7280",
                            opacity: livePulse,
                          },
                        ]}
                      />
                    )}
                    <ThemedText
                      style={[
                        styles.modalStatusText,
                        {
                          color:
                            STATUS_COLORS[selectedEmergency.status] ||
                            "#6B7280",
                        },
                      ]}
                    >
                      {(
                        STATUS_LABELS[selectedEmergency.status] ||
                        selectedEmergency.status.replace(/_/g, " ")
                      ).toUpperCase()}
                    </ThemedText>
                    {!["completed", "cancelled"].includes(
                      selectedEmergency.status,
                    ) && (
                      <ThemedText
                        style={[
                          styles.liveLabel,
                          {
                            color:
                              STATUS_COLORS[selectedEmergency.status] ||
                              "#6B7280",
                          },
                        ]}
                      >
                        LIVE
                      </ThemedText>
                    )}
                  </View>

                  {/* Live tracking map — prominent at top */}
                  {selectedEmergency.latitude !== 0 && (
                    <View style={{ marginBottom: 16 }}>
                      <View style={styles.sectionHeader}>
                        <MaterialIcons name="map" size={18} color="#06B6D4" />
                        <ThemedText
                          style={[styles.sectionTitle, { color: colors.text }]}
                        >
                          {["completed", "cancelled"].includes(
                            selectedEmergency.status,
                          )
                            ? "Location"
                            : "Live Tracking"}
                        </ThemedText>
                      </View>
                      <HtmlMapView
                        html={
                          selectedEmergency.ambulance_latitude &&
                          selectedEmergency.ambulance_longitude
                            ? buildDriverPatientMapHtml(
                                selectedEmergency.ambulance_latitude,
                                selectedEmergency.ambulance_longitude,
                                selectedEmergency.latitude,
                                selectedEmergency.longitude,
                              )
                            : buildMapHtml(
                                selectedEmergency.latitude,
                                selectedEmergency.longitude,
                                15,
                              )
                        }
                        style={styles.modalMap}
                        title="Emergency Location"
                      />
                    </View>
                  )}

                  {/* Patient Info Section */}
                  <View style={[styles.section, { borderColor: cardBorder }]}>
                    <View style={styles.sectionHeader}>
                      <MaterialIcons name="person" size={18} color="#DC2626" />
                      <ThemedText
                        style={[styles.sectionTitle, { color: colors.text }]}
                      >
                        Patient Information
                      </ThemedText>
                    </View>
                    <InfoRow
                      label="Name"
                      value={selectedEmergency.patient_profile?.full_name}
                      c={colors.text}
                      s={subText}
                    />
                    <InfoRow
                      label="Phone"
                      value={selectedEmergency.patient_profile?.phone}
                      c={colors.text}
                      s={subText}
                    />
                    <InfoRow
                      label="National ID"
                      value={selectedEmergency.national_id}
                      c={colors.text}
                      s={subText}
                    />
                  </View>

                  {/* Medical Info Section */}
                  {selectedEmergency.patient_medical && (
                    <View style={[styles.section, { borderColor: cardBorder }]}>
                      <View style={styles.sectionHeader}>
                        <MaterialIcons
                          name="medical-services"
                          size={18}
                          color="#DC2626"
                        />
                        <ThemedText
                          style={[styles.sectionTitle, { color: colors.text }]}
                        >
                          Medical Information
                        </ThemedText>
                      </View>
                      <InfoRow
                        label="Blood Type"
                        value={selectedEmergency.patient_medical.blood_type}
                        c={colors.text}
                        s={subText}
                        highlight
                      />
                      <InfoRow
                        label="Allergies"
                        value={
                          selectedEmergency.patient_medical.allergies || "None"
                        }
                        c={colors.text}
                        s={subText}
                      />
                      <InfoRow
                        label="Medical Conditions"
                        value={
                          selectedEmergency.patient_medical
                            .medical_conditions || "None"
                        }
                        c={colors.text}
                        s={subText}
                      />
                      <InfoRow
                        label="Emergency Contact"
                        value={
                          selectedEmergency.patient_medical
                            .emergency_contact_name
                        }
                        c={colors.text}
                        s={subText}
                      />
                      <InfoRow
                        label="Emergency Phone"
                        value={
                          selectedEmergency.patient_medical
                            .emergency_contact_phone
                        }
                        c={colors.text}
                        s={subText}
                      />
                    </View>
                  )}

                  {/* Emergency Details Section */}
                  <View style={[styles.section, { borderColor: cardBorder }]}>
                    <View style={styles.sectionHeader}>
                      <MaterialIcons name="warning" size={18} color="#F59E0B" />
                      <ThemedText
                        style={[styles.sectionTitle, { color: colors.text }]}
                      >
                        Emergency Details
                      </ThemedText>
                    </View>
                    <InfoRow
                      label="Type"
                      value={selectedEmergency.emergency_type}
                      c={colors.text}
                      s={subText}
                    />
                    <InfoRow
                      label="Description"
                      value={selectedEmergency.description}
                      c={colors.text}
                      s={subText}
                    />
                    <InfoRow
                      label="Location"
                      value={
                        selectedEmergency.latitude !== 0
                          ? formatCoords(
                              selectedEmergency.latitude,
                              selectedEmergency.longitude,
                              6,
                            )
                          : "Unknown"
                      }
                      c={colors.text}
                      s={subText}
                    />
                    <InfoRow
                      label="Created"
                      value={formatDateTime(selectedEmergency.created_at)}
                      c={colors.text}
                      s={subText}
                    />
                    <InfoRow
                      label="Ambulance"
                      value={selectedEmergency.ambulance_vehicle}
                      c={colors.text}
                      s={subText}
                    />
                  </View>

                  {/* ── Medical Notes Section ──────────────────────────── */}
                  {[
                    "assigned",
                    "en_route",
                    "at_scene",
                    "arrived",
                    "transporting",
                    "at_hospital",
                    "completed",
                  ].includes(selectedEmergency.status) ? (
                    <View style={[styles.section, { borderColor: cardBorder }]}>
                      <View style={styles.sectionHeader}>
                        <MaterialIcons
                          name="medical-services"
                          size={18}
                          color="#8B5CF6"
                        />
                        <ThemedText
                          style={[styles.sectionTitle, { color: colors.text }]}
                        >
                          Clinical Notes ({medicalNotes.length})
                        </ThemedText>
                      </View>

                      {loadingNotes ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.tint}
                          style={{ marginVertical: 12 }}
                        />
                      ) : medicalNotes.length === 0 ? (
                        <View
                          style={{ alignItems: "center", paddingVertical: 16 }}
                        >
                          <MaterialIcons
                            name="note-add"
                            size={36}
                            color={isDark ? "#475569" : "#CBD5E1"}
                          />
                          <ThemedText
                            style={{
                              fontSize: 13,
                              color: subText,
                              marginTop: 6,
                              fontFamily: Fonts.sans,
                            }}
                          >
                            No clinical notes recorded yet
                          </ThemedText>
                        </View>
                      ) : (
                        medicalNotes.map((n) => {
                          const meta =
                            NOTE_TYPE_LABELS[n.note_type as NoteType] ||
                            NOTE_TYPE_LABELS.general;
                          return (
                            <View
                              key={n.id}
                              style={[
                                styles.hospNoteItem,
                                { borderColor: cardBorder },
                              ]}
                            >
                              <View style={styles.hospNoteHeader}>
                                <View
                                  style={[
                                    styles.hospNoteTypeBadge,
                                    { backgroundColor: meta.color + "18" },
                                  ]}
                                >
                                  <MaterialIcons
                                    name={meta.icon as any}
                                    size={13}
                                    color={meta.color}
                                  />
                                  <ThemedText
                                    style={{
                                      fontSize: 11,
                                      color: meta.color,
                                      fontFamily: Fonts.sansSemiBold,
                                    }}
                                  >
                                    {meta.label}
                                  </ThemedText>
                                </View>
                                <ThemedText
                                  style={{
                                    fontSize: 11,
                                    color: subText,
                                    fontFamily: Fonts.sans,
                                  }}
                                >
                                  {formatNoteTime(n.created_at)}
                                </ThemedText>
                              </View>
                              <ThemedText
                                style={{
                                  fontSize: 13,
                                  color: colors.text,
                                  fontFamily: Fonts.sans,
                                  lineHeight: 19,
                                  marginBottom: 4,
                                }}
                              >
                                {n.content}
                              </ThemedText>
                              {n.vitals && Object.keys(n.vitals).length > 0 && (
                                <View style={styles.hospVitalsRow}>
                                  {n.vitals.blood_pressure ? (
                                    <View
                                      style={[
                                        styles.hospVitalChip,
                                        {
                                          backgroundColor: isDark
                                            ? "#1E293B"
                                            : "#F1F5F9",
                                        },
                                      ]}
                                    >
                                      <ThemedText
                                        style={{
                                          fontSize: 10,
                                          color: subText,
                                          fontFamily: Fonts.sansSemiBold,
                                        }}
                                      >
                                        BP
                                      </ThemedText>
                                      <ThemedText
                                        style={{
                                          fontSize: 11,
                                          color: colors.text,
                                          fontFamily: Fonts.sans,
                                        }}
                                      >
                                        {n.vitals.blood_pressure}
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                  {n.vitals.heart_rate ? (
                                    <View
                                      style={[
                                        styles.hospVitalChip,
                                        {
                                          backgroundColor: isDark
                                            ? "#1E293B"
                                            : "#F1F5F9",
                                        },
                                      ]}
                                    >
                                      <ThemedText
                                        style={{
                                          fontSize: 10,
                                          color: subText,
                                          fontFamily: Fonts.sansSemiBold,
                                        }}
                                      >
                                        HR
                                      </ThemedText>
                                      <ThemedText
                                        style={{
                                          fontSize: 11,
                                          color: colors.text,
                                          fontFamily: Fonts.sans,
                                        }}
                                      >
                                        {n.vitals.heart_rate} bpm
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                  {n.vitals.spo2 ? (
                                    <View
                                      style={[
                                        styles.hospVitalChip,
                                        {
                                          backgroundColor: isDark
                                            ? "#1E293B"
                                            : "#F1F5F9",
                                        },
                                      ]}
                                    >
                                      <ThemedText
                                        style={{
                                          fontSize: 10,
                                          color: subText,
                                          fontFamily: Fonts.sansSemiBold,
                                        }}
                                      >
                                        SpO₂
                                      </ThemedText>
                                      <ThemedText
                                        style={{
                                          fontSize: 11,
                                          color: colors.text,
                                          fontFamily: Fonts.sans,
                                        }}
                                      >
                                        {n.vitals.spo2}%
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                  {n.vitals.temperature ? (
                                    <View
                                      style={[
                                        styles.hospVitalChip,
                                        {
                                          backgroundColor: isDark
                                            ? "#1E293B"
                                            : "#F1F5F9",
                                        },
                                      ]}
                                    >
                                      <ThemedText
                                        style={{
                                          fontSize: 10,
                                          color: subText,
                                          fontFamily: Fonts.sansSemiBold,
                                        }}
                                      >
                                        Temp
                                      </ThemedText>
                                      <ThemedText
                                        style={{
                                          fontSize: 11,
                                          color: colors.text,
                                          fontFamily: Fonts.sans,
                                        }}
                                      >
                                        {n.vitals.temperature}°C
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                  {n.vitals.respiratory_rate ? (
                                    <View
                                      style={[
                                        styles.hospVitalChip,
                                        {
                                          backgroundColor: isDark
                                            ? "#1E293B"
                                            : "#F1F5F9",
                                        },
                                      ]}
                                    >
                                      <ThemedText
                                        style={{
                                          fontSize: 10,
                                          color: subText,
                                          fontFamily: Fonts.sansSemiBold,
                                        }}
                                      >
                                        RR
                                      </ThemedText>
                                      <ThemedText
                                        style={{
                                          fontSize: 11,
                                          color: colors.text,
                                          fontFamily: Fonts.sans,
                                        }}
                                      >
                                        {n.vitals.respiratory_rate}/min
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                  {n.vitals.consciousness_level ? (
                                    <View
                                      style={[
                                        styles.hospVitalChip,
                                        {
                                          backgroundColor: isDark
                                            ? "#1E293B"
                                            : "#F1F5F9",
                                        },
                                      ]}
                                    >
                                      <ThemedText
                                        style={{
                                          fontSize: 10,
                                          color: subText,
                                          fontFamily: Fonts.sansSemiBold,
                                        }}
                                      >
                                        AVPU
                                      </ThemedText>
                                      <ThemedText
                                        style={{
                                          fontSize: 11,
                                          color: colors.text,
                                          fontFamily: Fonts.sans,
                                        }}
                                      >
                                        {n.vitals.consciousness_level}
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                </View>
                              )}
                              {n.author_name && (
                                <ThemedText
                                  style={{
                                    fontSize: 11,
                                    fontStyle: "italic",
                                    color: subText,
                                    fontFamily: Fonts.sans,
                                    marginTop: 4,
                                  }}
                                >
                                  — {n.author_name} ({n.author_role})
                                </ThemedText>
                              )}
                            </View>
                          );
                        })
                      )}

                      {/* ── Read-only hint for active emergencies ─── */}
                      {!["completed", "cancelled"].includes(
                        selectedEmergency.status,
                      ) && (
                        <View
                          style={[
                            styles.actionHintCard,
                            {
                              backgroundColor: isDark
                                ? "rgba(59,130,246,0.12)"
                                : "rgba(59,130,246,0.08)",
                              marginTop: 8,
                            },
                          ]}
                        >
                          <MaterialIcons
                            name="info-outline"
                            size={16}
                            color="#3B82F6"
                          />
                          <ThemedText
                            style={[styles.actionHintText, { color: subText }]}
                          >
                            Ambulance crew can add notes during the active
                            emergency. You can add your own notes after the
                            emergency is completed.
                          </ThemedText>
                        </View>
                      )}

                      {/* ── Add Hospital Note Form (only after completed) ─── */}
                      {["completed"].includes(selectedEmergency.status) && (
                        <View
                          style={[
                            styles.hospNoteForm,
                            { borderColor: cardBorder },
                          ]}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              marginBottom: 10,
                            }}
                          >
                            <MaterialIcons
                              name="edit-note"
                              size={18}
                              color="#10B981"
                            />
                            <ThemedText
                              style={{
                                fontSize: 14,
                                color: colors.text,
                                fontFamily: Fonts.sansBold,
                              }}
                            >
                              Add Treatment Note
                            </ThemedText>
                          </View>

                          {/* Note Type Selector */}
                          <View
                            style={{
                              flexDirection: "row",
                              flexWrap: "wrap",
                              gap: 6,
                              marginBottom: 10,
                            }}
                          >
                            {(
                              [
                                "treatment",
                                "discharge",
                                "general",
                              ] as NoteType[]
                            ).map((t) => {
                              const meta = NOTE_TYPE_LABELS[t];
                              const sel = hospitalNoteType === t;
                              return (
                                <Pressable
                                  key={t}
                                  onPress={() => setHospitalNoteType(t)}
                                  style={[
                                    styles.hospNoteTypeChip,
                                    {
                                      borderColor: sel
                                        ? meta.color
                                        : cardBorder,
                                      backgroundColor: sel
                                        ? meta.color + "15"
                                        : "transparent",
                                    },
                                  ]}
                                >
                                  <MaterialIcons
                                    name={meta.icon as any}
                                    size={13}
                                    color={sel ? meta.color : subText}
                                  />
                                  <ThemedText
                                    style={{
                                      fontSize: 11,
                                      color: sel ? meta.color : subText,
                                      fontFamily: Fonts.sansSemiBold,
                                    }}
                                  >
                                    {meta.label}
                                  </ThemedText>
                                </Pressable>
                              );
                            })}
                          </View>

                          {/* Content Input */}
                          <TextInput
                            style={[
                              styles.hospNoteInput,
                              {
                                backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                                borderColor: cardBorder,
                                color: colors.text,
                              },
                            ]}
                            value={hospitalNoteContent}
                            onChangeText={setHospitalNoteContent}
                            placeholder="Treatment given, observations, medication administered..."
                            placeholderTextColor={subText}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            maxLength={2000}
                          />

                          <TextInput
                            style={[
                              styles.hospNoteInput,
                              {
                                backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                                borderColor: cardBorder,
                                color: colors.text,
                                minHeight: 72,
                                marginTop: 10,
                              },
                            ]}
                            value={hospitalMedicalConditions}
                            onChangeText={setHospitalMedicalConditions}
                            placeholder="Updated patient medical conditions for the profile, e.g. Diabetes, Hypertension"
                            placeholderTextColor={subText}
                            multiline
                            numberOfLines={2}
                            textAlignVertical="top"
                            maxLength={500}
                          />

                          {/* Vitals Toggle */}
                          <Pressable
                            onPress={() =>
                              setShowHospitalVitals(!showHospitalVitals)
                            }
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingVertical: 8,
                              marginTop: 4,
                            }}
                          >
                            <MaterialIcons
                              name="monitor-heart"
                              size={16}
                              color="#0EA5E9"
                            />
                            <ThemedText
                              style={{
                                flex: 1,
                                fontSize: 13,
                                color: colors.text,
                                fontFamily: Fonts.sansSemiBold,
                              }}
                            >
                              {showHospitalVitals
                                ? "Hide Vitals"
                                : "Add Vitals"}
                            </ThemedText>
                            <MaterialIcons
                              name={
                                showHospitalVitals
                                  ? "expand-less"
                                  : "expand-more"
                              }
                              size={18}
                              color={subText}
                            />
                          </Pressable>

                          {showHospitalVitals && (
                            <View style={{ gap: 8, marginTop: 4 }}>
                              <View style={{ flexDirection: "row", gap: 8 }}>
                                <View style={{ flex: 1 }}>
                                  <ThemedText
                                    style={{
                                      fontSize: 10,
                                      color: subText,
                                      fontFamily: Fonts.sansSemiBold,
                                      marginBottom: 3,
                                    }}
                                  >
                                    BP
                                  </ThemedText>
                                  <TextInput
                                    style={[
                                      styles.hospVitalInput,
                                      {
                                        backgroundColor: isDark
                                          ? "#1E293B"
                                          : "#F8FAFC",
                                        borderColor: cardBorder,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={hospitalVitals.blood_pressure || ""}
                                    onChangeText={(v) =>
                                      setHospitalVitals((p) => ({
                                        ...p,
                                        blood_pressure: v,
                                      }))
                                    }
                                    placeholder="120/80"
                                    placeholderTextColor={subText}
                                    maxLength={10}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <ThemedText
                                    style={{
                                      fontSize: 10,
                                      color: subText,
                                      fontFamily: Fonts.sansSemiBold,
                                      marginBottom: 3,
                                    }}
                                  >
                                    HR (bpm)
                                  </ThemedText>
                                  <TextInput
                                    style={[
                                      styles.hospVitalInput,
                                      {
                                        backgroundColor: isDark
                                          ? "#1E293B"
                                          : "#F8FAFC",
                                        borderColor: cardBorder,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={
                                      hospitalVitals.heart_rate?.toString() ||
                                      ""
                                    }
                                    onChangeText={(v) =>
                                      setHospitalVitals((p) => ({
                                        ...p,
                                        heart_rate: v ? Number(v) : undefined,
                                      }))
                                    }
                                    placeholder="72"
                                    placeholderTextColor={subText}
                                    keyboardType="numeric"
                                    maxLength={4}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <ThemedText
                                    style={{
                                      fontSize: 10,
                                      color: subText,
                                      fontFamily: Fonts.sansSemiBold,
                                      marginBottom: 3,
                                    }}
                                  >
                                    SpO₂ %
                                  </ThemedText>
                                  <TextInput
                                    style={[
                                      styles.hospVitalInput,
                                      {
                                        backgroundColor: isDark
                                          ? "#1E293B"
                                          : "#F8FAFC",
                                        borderColor: cardBorder,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={
                                      hospitalVitals.spo2?.toString() || ""
                                    }
                                    onChangeText={(v) =>
                                      setHospitalVitals((p) => ({
                                        ...p,
                                        spo2: v ? Number(v) : undefined,
                                      }))
                                    }
                                    placeholder="98"
                                    placeholderTextColor={subText}
                                    keyboardType="numeric"
                                    maxLength={4}
                                  />
                                </View>
                              </View>
                              <View style={{ flexDirection: "row", gap: 8 }}>
                                <View style={{ flex: 1 }}>
                                  <ThemedText
                                    style={{
                                      fontSize: 10,
                                      color: subText,
                                      fontFamily: Fonts.sansSemiBold,
                                      marginBottom: 3,
                                    }}
                                  >
                                    Temp °C
                                  </ThemedText>
                                  <TextInput
                                    style={[
                                      styles.hospVitalInput,
                                      {
                                        backgroundColor: isDark
                                          ? "#1E293B"
                                          : "#F8FAFC",
                                        borderColor: cardBorder,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={
                                      hospitalVitals.temperature?.toString() ||
                                      ""
                                    }
                                    onChangeText={(v) =>
                                      setHospitalVitals((p) => ({
                                        ...p,
                                        temperature: v ? Number(v) : undefined,
                                      }))
                                    }
                                    placeholder="36.6"
                                    placeholderTextColor={subText}
                                    keyboardType="decimal-pad"
                                    maxLength={5}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <ThemedText
                                    style={{
                                      fontSize: 10,
                                      color: subText,
                                      fontFamily: Fonts.sansSemiBold,
                                      marginBottom: 3,
                                    }}
                                  >
                                    RR (/min)
                                  </ThemedText>
                                  <TextInput
                                    style={[
                                      styles.hospVitalInput,
                                      {
                                        backgroundColor: isDark
                                          ? "#1E293B"
                                          : "#F8FAFC",
                                        borderColor: cardBorder,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={
                                      hospitalVitals.respiratory_rate?.toString() ||
                                      ""
                                    }
                                    onChangeText={(v) =>
                                      setHospitalVitals((p) => ({
                                        ...p,
                                        respiratory_rate: v
                                          ? Number(v)
                                          : undefined,
                                      }))
                                    }
                                    placeholder="16"
                                    placeholderTextColor={subText}
                                    keyboardType="numeric"
                                    maxLength={3}
                                  />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <ThemedText
                                    style={{
                                      fontSize: 10,
                                      color: subText,
                                      fontFamily: Fonts.sansSemiBold,
                                      marginBottom: 3,
                                    }}
                                  >
                                    AVPU
                                  </ThemedText>
                                  <TextInput
                                    style={[
                                      styles.hospVitalInput,
                                      {
                                        backgroundColor: isDark
                                          ? "#1E293B"
                                          : "#F8FAFC",
                                        borderColor: cardBorder,
                                        color: colors.text,
                                      },
                                    ]}
                                    value={
                                      hospitalVitals.consciousness_level || ""
                                    }
                                    onChangeText={(v) =>
                                      setHospitalVitals((p) => ({
                                        ...p,
                                        consciousness_level: v,
                                      }))
                                    }
                                    placeholder="Alert"
                                    placeholderTextColor={subText}
                                    maxLength={20}
                                  />
                                </View>
                              </View>
                            </View>
                          )}

                          {/* Submit */}
                          <Pressable
                            style={[
                              styles.hospNoteSaveBtn,
                              {
                                opacity:
                                  submittingHospitalNote ||
                                  (!hospitalNoteContent.trim() &&
                                    hospitalMedicalConditions.trim() ===
                                      String(
                                        selectedEmergency.patient_medical
                                          ?.medical_conditions || "",
                                      ).trim())
                                    ? 0.5
                                    : 1,
                              },
                            ]}
                            disabled={
                              submittingHospitalNote ||
                              (!hospitalNoteContent.trim() &&
                                hospitalMedicalConditions.trim() ===
                                  String(
                                    selectedEmergency.patient_medical
                                      ?.medical_conditions || "",
                                  ).trim())
                            }
                            onPress={handleSubmitHospitalNote}
                          >
                            <MaterialIcons name="save" size={16} color="#FFF" />
                            <ThemedText style={styles.hospNoteSaveBtnText}>
                              {submittingHospitalNote
                                ? "Saving..."
                                : "Save Note"}
                            </ThemedText>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={[styles.section, { borderColor: cardBorder }]}>
                      <View style={styles.sectionHeader}>
                        <MaterialIcons
                          name="pending-actions"
                          size={18}
                          color="#F59E0B"
                        />
                        <ThemedText
                          style={[styles.sectionTitle, { color: colors.text }]}
                        >
                          Clinical Notes
                        </ThemedText>
                      </View>
                      <View
                        style={[
                          styles.actionHintCard,
                          {
                            backgroundColor: isDark
                              ? "rgba(245,158,11,0.12)"
                              : "rgba(245,158,11,0.08)",
                          },
                        ]}
                      >
                        <MaterialIcons
                          name="hourglass-empty"
                          size={16}
                          color="#F59E0B"
                        />
                        <ThemedText
                          style={[styles.actionHintText, { color: subText }]}
                        >
                          Clinical notes will be available once an ambulance
                          accepts this emergency request.
                        </ThemedText>
                      </View>
                    </View>
                  )}

                  {/* Action buttons — hospital-owned stages only */}
                  {(() => {
                    const actions = getHospitalStatusActions(
                      selectedEmergency.status,
                    );
                    if (
                      ["completed", "cancelled"].includes(
                        selectedEmergency.status,
                      )
                    )
                      return null;
                    if (actions.length === 0)
                      return (
                        <View
                          style={[
                            styles.actionHintCard,
                            {
                              backgroundColor: isDark
                                ? "rgba(59,130,246,0.1)"
                                : "rgba(59,130,246,0.06)",
                            },
                          ]}
                        >
                          <MaterialIcons
                            name="info-outline"
                            size={16}
                            color="#3B82F6"
                          />
                          <ThemedText
                            style={[styles.actionHintText, { color: subText }]}
                          >
                            Ambulance is handling this stage. Actions will
                            appear once the patient is en route to the hospital.
                          </ThemedText>
                        </View>
                      );
                    return (
                      <View style={styles.actionRow}>
                        {actions.map((a) => (
                          <Pressable
                            key={a.next}
                            style={[
                              styles.actionBtn,
                              {
                                backgroundColor: a.color,
                                opacity: statusUpdating ? 0.6 : 1,
                              },
                            ]}
                            disabled={!!statusUpdating}
                            onPress={() =>
                              updateStatus(selectedEmergency.id, a.next)
                            }
                          >
                            <MaterialIcons
                              name={a.icon as any}
                              size={18}
                              color="#FFF"
                            />
                            <ThemedText style={styles.actionBtnText}>
                              {statusUpdating === a.next
                                ? "Updating…"
                                : a.label}
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    );
                  })()}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Profile Dropdown */}
      <Modal
        visible={profileVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setProfileVisible(false)}
      >
        <Pressable
          style={styles.dropdownOverlay}
          onPress={() => setProfileVisible(false)}
        >
          <View
            style={[
              styles.dropdownCard,
              {
                backgroundColor: isDark ? "#1E2028" : "#FFFFFF",
                borderColor: cardBorder,
              },
            ]}
          >
            <View style={styles.dropdownHeader}>
              <View
                style={[
                  styles.dropdownAvatar,
                  {
                    backgroundColor: isDark
                      ? "rgba(6,182,212,0.15)"
                      : "rgba(6,182,212,0.08)",
                  },
                ]}
              >
                <MaterialIcons
                  name="local-hospital"
                  size={28}
                  color="#06B6D4"
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText
                  style={[styles.dropdownName, { color: colors.text }]}
                >
                  {hospitalName || user?.fullName || "Hospital"}
                </ThemedText>
                <ThemedText style={[styles.dropdownPhone, { color: subText }]}>
                  {user?.phone || ""}
                </ThemedText>
                <View
                  style={[
                    styles.dropdownRoleBadge,
                    { backgroundColor: isDark ? "#D1FAE533" : "#D1FAE5" },
                  ]}
                >
                  <ThemedText
                    style={[styles.dropdownRoleLabel, { color: "#059669" }]}
                  >
                    HOSPITAL
                  </ThemedText>
                </View>
              </View>
            </View>
            <View
              style={[styles.dropdownDivider, { backgroundColor: cardBorder }]}
            />
            <Pressable
              onPress={() => {
                setProfileVisible(false);
                setEditProfileVisible(true);
              }}
              style={({ pressed }) => [
                styles.dropdownAction,
                pressed && { opacity: 0.7 },
              ]}
            >
              <MaterialIcons name="edit" size={20} color="#0F766E" />
              <ThemedText style={styles.dropdownActionText}>
                Edit Profile
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.dropdownSignOut,
                pressed && { opacity: 0.7 },
              ]}
            >
              <MaterialIcons name="logout" size={20} color="#DC2626" />
              <ThemedText style={styles.dropdownSignOutText}>
                Sign Out
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={editProfileVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setEditProfileVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={[
              styles.modalContent,
              { backgroundColor: isDark ? "#1E2028" : "#FFFFFF" },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                  Edit Hospital Profile
                </ThemedText>
                <Pressable
                  onPress={() => setEditProfileVisible(false)}
                  style={styles.closeBtn}
                >
                  <MaterialIcons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <ThemedText
                style={[styles.profileSectionTitle, { color: colors.text }]}
              >
                Basic Information
              </ThemedText>
              <ThemedText style={[styles.profileHint, { color: subText }]}>
                Update your hospital identity details exactly as they should
                appear across the system.
              </ThemedText>

              <ThemedText
                style={[styles.profileFieldLabel, { color: colors.text }]}
              >
                Hospital Name
              </ThemedText>

              <TextInput
                style={[
                  styles.profileInput,
                  {
                    color: colors.text,
                    borderColor: cardBorder,
                    backgroundColor: inputBg,
                  },
                ]}
                placeholder="Enter hospital name"
                placeholderTextColor={subText}
                value={profileForm.name}
                onChangeText={(t) => setProfileForm((p) => ({ ...p, name: t }))}
              />
              <ThemedText
                style={[styles.profileFieldLabel, { color: colors.text }]}
              >
                Hospital Address
              </ThemedText>
              <TextInput
                style={[
                  styles.profileInput,
                  {
                    color: colors.text,
                    borderColor: cardBorder,
                    backgroundColor: inputBg,
                  },
                ]}
                placeholder="Enter full hospital address"
                placeholderTextColor={subText}
                value={profileForm.address}
                onChangeText={(t) =>
                  setProfileForm((p) => ({ ...p, address: t }))
                }
              />
              <ThemedText
                style={[styles.profileFieldLabel, { color: colors.text }]}
              >
                Hospital Phone Number
              </ThemedText>
              <TextInput
                style={[
                  styles.profileInput,
                  {
                    color: colors.text,
                    borderColor: cardBorder,
                    backgroundColor: inputBg,
                  },
                ]}
                placeholder="Enter contact phone number"
                placeholderTextColor={subText}
                value={profileForm.phone}
                onChangeText={(t) =>
                  setProfileForm((p) => ({ ...p, phone: t }))
                }
              />

              <ThemedText
                style={[styles.profileSectionTitle, { color: colors.text }]}
              >
                Operational Status
              </ThemedText>
              <ThemedText style={[styles.profileHint, { color: subText }]}>
                Set whether you are receiving emergency cases and whether trauma
                support is currently available.
              </ThemedText>

              <View style={styles.profileToggleRow}>
                <Pressable
                  onPress={() =>
                    setProfileForm((p) => ({
                      ...p,
                      isAcceptingEmergencies: !p.isAcceptingEmergencies,
                    }))
                  }
                  style={[
                    styles.profileToggleBtn,
                    {
                      backgroundColor: profileForm.isAcceptingEmergencies
                        ? "#DCFCE7"
                        : "#FEE2E2",
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.profileToggleText,
                      {
                        color: profileForm.isAcceptingEmergencies
                          ? "#166534"
                          : "#991B1B",
                      },
                    ]}
                  >
                    {profileForm.isAcceptingEmergencies
                      ? "Emergency Intake: OPEN"
                      : "Emergency Intake: CLOSED"}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() =>
                    setProfileForm((p) => ({
                      ...p,
                      traumaCapable: !p.traumaCapable,
                    }))
                  }
                  style={[
                    styles.profileToggleBtn,
                    {
                      backgroundColor: profileForm.traumaCapable
                        ? "#DBEAFE"
                        : "#F3F4F6",
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.profileToggleText,
                      {
                        color: profileForm.traumaCapable
                          ? "#1D4ED8"
                          : "#374151",
                      },
                    ]}
                  >
                    {profileForm.traumaCapable
                      ? "Trauma Service: AVAILABLE"
                      : "Trauma Service: UNAVAILABLE"}
                  </ThemedText>
                </Pressable>
              </View>

              <ThemedText
                style={[styles.profileSectionTitle, { color: colors.text }]}
              >
                Capacity and Dispatch
              </ThemedText>
              <ThemedText style={[styles.profileHint, { color: subText }]}>
                These values control routing, load balancing, and handover
                planning.
              </ThemedText>

              <View style={styles.profileInputRow}>
                <View style={styles.profileInputFieldHalf}>
                  <ThemedText
                    style={[styles.profileFieldLabel, { color: colors.text }]}
                  >
                    Max Concurrent Emergencies
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.profileInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Example: 20"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={profileForm.maxConcurrent}
                    onChangeText={(t) =>
                      setProfileForm((p) => ({ ...p, maxConcurrent: t }))
                    }
                  />
                </View>
                <View style={styles.profileInputFieldHalf}>
                  <ThemedText
                    style={[styles.profileFieldLabel, { color: colors.text }]}
                  >
                    Dispatch Priority Weight
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.profileInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Example: 1.0"
                    placeholderTextColor={subText}
                    keyboardType="decimal-pad"
                    value={profileForm.dispatchWeight}
                    onChangeText={(t) =>
                      setProfileForm((p) => ({ ...p, dispatchWeight: t }))
                    }
                  />
                </View>
              </View>
              <View style={styles.profileInputRow}>
                <View style={styles.profileInputFieldHalf}>
                  <ThemedText
                    style={[styles.profileFieldLabel, { color: colors.text }]}
                  >
                    ICU Beds Available
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.profileInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Example: 5"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={profileForm.icuBeds}
                    onChangeText={(t) =>
                      setProfileForm((p) => ({ ...p, icuBeds: t }))
                    }
                  />
                </View>
                <View style={styles.profileInputFieldHalf}>
                  <ThemedText
                    style={[styles.profileFieldLabel, { color: colors.text }]}
                  >
                    Average Handover Time (minutes)
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.profileInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Example: 25"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={profileForm.averageHandover}
                    onChangeText={(t) =>
                      setProfileForm((p) => ({ ...p, averageHandover: t }))
                    }
                  />
                </View>
              </View>

              <Pressable
                onPress={saveHospitalProfile}
                disabled={savingProfile}
                style={({ pressed }) => [
                  styles.profileSaveBtn,
                  { opacity: pressed || savingProfile ? 0.85 : 1 },
                ]}
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <MaterialIcons name="save" size={16} color="#FFFFFF" />
                )}
                <ThemedText style={styles.profileSaveBtnText}>
                  {savingProfile ? "Saving..." : "Save Profile"}
                </ThemedText>
              </Pressable>
            </ScrollView>
          </Pressable>
        </View>
      </Modal>

      {/* Notification History Panel */}
      <Modal
        animationType="fade"
        transparent
        visible={notifPanelVisible}
        onRequestClose={() => setNotifPanelVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setNotifPanelVisible(false)}
        >
          <Pressable
            style={[
              styles.notifPanelContent,
              { backgroundColor: isDark ? "#1E2028" : "#FFFFFF" },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                Notifications
              </ThemedText>
              <View
                style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
              >
                {notifHistory.length > 0 && (
                  <Pressable onPress={() => setNotifHistory([])}>
                    <ThemedText
                      style={{
                        fontSize: 13,
                        color: "#DC2626",
                        fontFamily: Fonts.sansSemiBold,
                      }}
                    >
                      Clear All
                    </ThemedText>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setNotifPanelVisible(false)}
                  style={styles.closeBtn}
                >
                  <MaterialIcons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>
            </View>

            {notifHistory.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 40 }}>
                <MaterialIcons
                  name="notifications-none"
                  size={48}
                  color={isDark ? "#475569" : "#CBD5E1"}
                />
                <ThemedText
                  style={{
                    fontSize: 14,
                    color: subText,
                    marginTop: 10,
                    fontFamily: Fonts.sans,
                  }}
                >
                  No notifications yet
                </ThemedText>
              </View>
            ) : (
              <FlatList
                data={notifHistory}
                keyExtractor={(_item, index) => String(index)}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => {
                  const ago = Math.round((Date.now() - item.time) / 1000);
                  const timeStr =
                    ago < 60
                      ? `${ago}s ago`
                      : ago < 3600
                        ? `${Math.round(ago / 60)}m ago`
                        : `${Math.round(ago / 3600)}h ago`;
                  return (
                    <View
                      style={[
                        styles.notifHistoryItem,
                        { borderColor: cardBorder },
                      ]}
                    >
                      <View
                        style={[
                          styles.notifHistoryDot,
                          { backgroundColor: item.color },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <ThemedText
                          style={{
                            fontSize: 13,
                            color: colors.text,
                            fontFamily: Fonts.sansSemiBold,
                          }}
                        >
                          {item.message}
                        </ThemedText>
                        <ThemedText
                          style={{
                            fontSize: 11,
                            color: subText,
                            fontFamily: Fonts.sans,
                            marginTop: 2,
                          }}
                        >
                          {timeStr}
                        </ThemedText>
                      </View>
                    </View>
                  );
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ─── InfoRow helper ────────────────────────────────────────────── */

function InfoRow({
  label,
  value,
  c,
  s,
  highlight,
}: {
  label: string;
  value?: string | null;
  c: string;
  s: string;
  highlight?: boolean;
}) {
  return (
    <View style={infoStyles.row}>
      <ThemedText style={[infoStyles.label, { color: s }]}>{label}</ThemedText>
      <ThemedText
        style={[
          infoStyles.value,
          { color: c },
          highlight && infoStyles.highlight,
        ]}
      >
        {value || "N/A"}
      </ThemedText>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: { marginBottom: 10 },
  label: {
    fontSize: 12,
    marginBottom: 2,
    fontFamily: Fonts.sansSemiBold,
  },
  value: { fontSize: 15, fontFamily: Fonts.sans },
  highlight: { fontSize: 18, fontFamily: Fonts.sansBold, color: "#DC2626" },
});

/* ─── Styles ────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  bg: { flex: 1 },
  notifBanner: {
    position: "absolute",
    top: Platform.OS === "web" ? 60 : 100,
    left: 16,
    right: 16,
    zIndex: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  notifIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  notifText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
  notifSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: Fonts.sans,
    marginTop: 1,
  },
  notifBellWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  notifBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.sansExtraBold,
  },
  notifPanelContent: {
    width: "90%",
    maxWidth: 420,
    maxHeight: "70%",
    borderRadius: 18,
    padding: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  notifHistoryItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  notifHistoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  scrollOuter: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingBottom: 60 },
  container: {
    paddingHorizontal: 16,
    maxWidth: 1100,
    width: "100%" as any,
    alignSelf: "center" as any,
  },
  heroCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 22,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: -0.3,
  },
  heroSub: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: Fonts.sansBold,
    lineHeight: 18,
  },
  webOnlyTitle: {
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    textAlign: "center",
  },
  webOnlySub: { fontSize: 14, fontFamily: Fonts.sans, textAlign: "center" },

  pageHeader: { marginTop: 20, marginBottom: 16 },
  pageTitle: {
    fontSize: 26,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: -0.5,
  },
  pageSub: { fontSize: 14, fontFamily: Fonts.sans, marginTop: 2 },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flexBasis: "28%" as any,
    minWidth: 100,
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  statCount: { fontSize: 24, fontFamily: Fonts.sansExtraBold },
  statLabel: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    textAlign: "center",
  },

  capacityInline: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  capacityInlineText: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
  fleetActionsRow: {
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  fleetMetaText: { fontSize: 12, fontFamily: Fonts.sans },
  repairBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#0F766E",
  },
  repairBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.sansBold,
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.sans,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },

  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontFamily: Fonts.sansBold },

  itemCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
    flexDirection: "row",
  },
  cardAccentStripe: {
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  cardInner: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  cardBadgesRow: {
    flexDirection: "row",
    gap: 6,
    flex: 1,
    flexWrap: "wrap",
  },
  cardTimeAgo: {
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
    marginLeft: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: {
    fontSize: 12,
    fontFamily: Fonts.sansExtraBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardBody: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontFamily: Fonts.sansBold },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans },
  cardChevronWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  cardDescWrap: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  cardFooter: {
    flexDirection: "row",
    gap: 14,
    flexWrap: "wrap",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  footerText: { fontSize: 12, fontFamily: Fonts.sans },
  descText: { fontSize: 12, fontStyle: "italic", fontFamily: Fonts.sans },

  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: { fontSize: 14, fontFamily: Fonts.sans },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: { fontSize: 14, fontFamily: Fonts.sans },
  emptySub: { fontSize: 12, fontFamily: Fonts.sans },
  listContent: { paddingBottom: 20 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "92%",
    maxWidth: 500,
    maxHeight: "85%",
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Fonts.sansExtraBold,
    flex: 1,
  },
  closeBtn: { padding: 10, marginLeft: 8 },
  modalStatusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  modalStatusText: {
    fontSize: 12,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: 0.8,
    flex: 1,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveLabel: {
    fontSize: 10,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: 1,
  },
  section: { marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontFamily: Fonts.sansBold },
  modalMap: {
    width: "100%",
    height: 320,
    borderRadius: 12,
    overflow: "hidden",
  },
  fleetCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  fleetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  fleetItem: { alignItems: "center", flex: 1 },
  fleetDivider: { width: 1, height: 36 },
  fleetNum: { fontSize: 22, fontFamily: Fonts.sansExtraBold },
  fleetLabel: { fontSize: 11, fontFamily: Fonts.sans, marginTop: 2 },
  approvalItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    gap: 4,
  },
  approvalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  approvalName: {
    fontSize: 14,
    fontFamily: Fonts.sansBold,
  },
  approvalMeta: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  approvalActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  approvalBtn: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  approvalBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.sansBold,
  },
  approvalDetailRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  approvalDetailLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  approvalDetailValue: {
    fontSize: 15,
    fontFamily: Fonts.sans,
  },
  actionRow: { flexDirection: "row", gap: 12, marginTop: 4, marginBottom: 16 },
  actionHintCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  actionHintText: { fontSize: 12, fontFamily: Fonts.sans, flex: 1 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: Fonts.sansBold,
  },

  dropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 90,
    paddingRight: 16,
  },
  dropdownCard: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  dropdownHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  dropdownAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownName: { fontSize: 16, fontFamily: Fonts.sansBold },
  dropdownPhone: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
  dropdownRoleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  dropdownRoleLabel: {
    fontSize: 10,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: 0.5,
  },
  dropdownDivider: { height: 1, marginVertical: 12 },
  dropdownAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  dropdownActionText: {
    fontSize: 14,
    fontFamily: Fonts.sansBold,
    color: "#0F766E",
  },
  dropdownSignOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  dropdownSignOutText: {
    fontSize: 15,
    fontFamily: Fonts.sansBold,
    color: "#DC2626",
  },
  profileInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: Fonts.sansExtraBold,
    marginBottom: 8,
  },
  profileSectionTitle: {
    fontSize: 14,
    fontFamily: Fonts.sansExtraBold,
    marginTop: 4,
    marginBottom: 4,
  },
  profileHint: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
    marginBottom: 8,
  },
  profileFieldLabel: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
    marginBottom: 4,
  },
  profileInputRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  profileInputFieldHalf: {
    flex: 1,
  },
  profileInputHalf: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  profileToggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  profileToggleBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  profileToggleText: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
  },
  profileSaveBtn: {
    height: 40,
    borderRadius: 10,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  profileSaveBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },

  // Medical notes styles
  hospNoteItem: { borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  hospNoteHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 4,
  },
  hospNoteTypeBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  hospVitalsRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 5,
    marginTop: 5,
  },
  hospVitalChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  hospNoteForm: { borderTopWidth: 1, paddingTop: 14, marginTop: 14 },
  hospNoteTypeChip: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    borderWidth: 1.5,
  },
  hospNoteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    fontFamily: Fonts.sans,
    minHeight: 80,
    lineHeight: 18,
  },
  hospVitalInput: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  hospNoteSaveBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    backgroundColor: "#10B981",
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  hospNoteSaveBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontFamily: Fonts.sansBold,
  },
});
