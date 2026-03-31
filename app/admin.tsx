import { AppHeader } from "@/components/app-header";
import { useAppState } from "@/components/app-state";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { backendGet, backendPost, backendPut } from "@/utils/api";
import { signOut } from "@/utils/auth";
import {
    Ambulance,
    EmergencyRequest,
    Hospital,
    normalizeEmergency,
} from "@/utils/emergency";
import { supabase } from "@/utils/supabase";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    KeyboardAvoidingView,
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

interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: "patient" | "ambulance" | "driver" | "admin" | "hospital";
  hospital_id: string | null;
  created_at: string;
  updated_at: string;
}

type Tab = "users" | "emergencies" | "ambulances" | "hospitals" | "settings";
type FilterRole = "all" | "patient" | "ambulance" | "admin" | "hospital";
type EmergencyFilter = "all" | "active" | "completed" | "cancelled";

interface AdminDashboardResponse {
  users: Profile[];
  emergencies: EmergencyRequest[];
  ambulances: Ambulance[];
  hospitals: Hospital[];
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  patient: { bg: "#DBEAFE", text: "#1D4ED8" },
  ambulance: { bg: "#FEF3C7", text: "#B45309" },
  driver: { bg: "#FEF3C7", text: "#B45309" },
  admin: { bg: "#FCE7F3", text: "#BE185D" },
  hospital: { bg: "#D1FAE5", text: "#059669" },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  assigned: "#3B82F6",
  en_route: "#8B5CF6",
  arrived: "#10B981",
  at_hospital: "#06B6D4",
  completed: "#6B7280",
  cancelled: "#EF4444",
};

/* ─── Component ───────────────────────────────────────────────── */

export default function AdminScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? "light";
  const isDark = theme === "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const { user, setUser } = useAppState();
  const { showError, showSuccess } = useModal();

  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [profileVisible, setProfileVisible] = useState(false);
  const [createHospitalVisible, setCreateHospitalVisible] = useState(false);
  const [creatingHospital, setCreatingHospital] = useState(false);
  const [hospitalForm, setHospitalForm] = useState({
    hospitalName: "",
    phone: "",
    address: "",
    locationInput: "",
    password: "",
    latitude: "",
    longitude: "",
    maxConcurrentEmergencies: "",
    dispatchWeight: "1",
    traumaCapable: false,
    icuBedsAvailable: "",
    averageHandoverMinutes: "",
    isAcceptingEmergencies: true,
  });

  const [users, setUsers] = useState<Profile[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [opsInsights, setOpsInsights] = useState<{
    emergenciesTotal: number;
    avgCompletionMinutes: number | null;
  } | null>(null);

  // Settings state
  const [apiKeyPreview, setApiKeyPreview] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [activeProvider, setActiveProvider] = useState("deepseek");
  const [availableProviders, setAvailableProviders] = useState<string[]>([
    "deepseek",
    "openai",
    "groq",
  ]);
  const [totalChatRequests, setTotalChatRequests] = useState(0);
  const [uniqueChatUsers, setUniqueChatUsers] = useState(0);
  const [todayChatRequests, setTodayChatRequests] = useState(0);

  const [filterRole, setFilterRole] = useState<FilterRole>("all");
  const [emergencyFilter, setEmergencyFilter] =
    useState<EmergencyFilter>("all");

  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const inputBg = colors.surfaceMuted;
  const inputBorder = colors.border;
  const subText = colors.textMuted;

  /* ─── data fetching ───────────────────────────────────────── */

  const fetchAll = useCallback(async () => {
    try {
      const data = await backendGet<AdminDashboardResponse>(
        "/ops/admin/dashboard",
      );
      if (data?.users) setUsers(data.users as Profile[]);
      if (data?.emergencies)
        setEmergencies(data.emergencies.map(normalizeEmergency));
      if (data?.ambulances) setAmbulances(data.ambulances as Ambulance[]);
      if (data?.hospitals) setHospitals(data.hospitals as Hospital[]);
      try {
        const insights = await backendGet<any>(
          "/ops/insights/operations?days=7",
        );
        setOpsInsights({
          emergenciesTotal: Number(insights?.emergencies_total || 0),
          avgCompletionMinutes:
            typeof insights?.avg_completion_minutes === "number"
              ? insights.avg_completion_minutes
              : null,
        });
      } catch {
        setOpsInsights(null);
      }
    } catch (err) {
      console.error("Admin fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await backendGet<{
        deepseek_api_key_set: boolean;
        deepseek_api_key_preview: string;
        active_provider: string;
        available_providers: string[];
        total_chat_requests: number;
        unique_chat_users: number;
        today_chat_requests: number;
      }>("/ops/admin/settings");
      if (data) {
        setApiKeySet(data.deepseek_api_key_set);
        setApiKeyPreview(data.deepseek_api_key_preview);
        setActiveProvider(data.active_provider || "deepseek");
        if (data.available_providers?.length)
          setAvailableProviders(data.available_providers);
        setTotalChatRequests(data.total_chat_requests || 0);
        setUniqueChatUsers(data.unique_chat_users || 0);
        setTodayChatRequests(data.today_chat_requests || 0);
      }
    } catch (err) {
      console.error("Settings fetch error:", err);
    }
  }, []);

  const handleSaveApiKey = async () => {
    if (!newApiKey.trim()) {
      showError("Missing Key", "Please enter a valid API key.");
      return;
    }
    setSavingApiKey(true);
    try {
      await backendPut("/ops/admin/settings/api-key", {
        api_key: newApiKey.trim(),
        provider: activeProvider,
      });
      showSuccess(
        "API Key Updated",
        `Chatbot now using ${activeProvider.toUpperCase()} provider.`,
      );
      setNewApiKey("");
      fetchSettings();
    } catch (err: any) {
      showError(
        "Update Failed",
        String(err?.message || "Failed to update API key"),
      );
    } finally {
      setSavingApiKey(false);
    }
  };

  useEffect(() => {
    fetchAll();
    fetchSettings();
    const channel = supabase
      .channel("admin_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "emergency_requests" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ambulances" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hospitals" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hospital_ambulance_links" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_profiles" },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [fetchAll]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, [fetchAll]);

  const handleLogout = async () => {
    setProfileVisible(false);
    const { error: logoutErr } = await signOut();
    if (!logoutErr) {
      setUser(null);
      router.replace("/");
    } else {
      showError("Logout Failed", "Failed to sign out");
    }
  };

  const handleCreateHospitalUser = async () => {
    if (
      !hospitalForm.hospitalName.trim() ||
      !hospitalForm.phone.trim() ||
      !hospitalForm.password.trim()
    ) {
      showError(
        "Missing Fields",
        "Hospital name, phone, and password are required.",
      );
      return;
    }

    const cleanedPhone = hospitalForm.phone.trim();
    const phoneDigits = cleanedPhone.replace(/[^0-9]/g, "");
    const isEthMobile =
      (phoneDigits.length === 12 && phoneDigits.startsWith("2519")) ||
      (phoneDigits.length === 10 && phoneDigits.startsWith("09")) ||
      (phoneDigits.length === 9 && phoneDigits.startsWith("9"));
    if (!isEthMobile) {
      showError(
        "Invalid Phone",
        "Use Ethiopian mobile format like +2519XXXXXXXX or 09XXXXXXXX.",
      );
      return;
    }

    const parseOptionalNumber = (value: string): number | undefined => {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const parseCoordinatesFromText = (
      text: string,
    ): { latitude: number; longitude: number } | null => {
      const raw = text.trim();
      if (!raw) return null;

      // Accept direct "lat, lng" input first.
      const direct = raw.match(
        /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/,
      );
      if (direct) {
        return {
          latitude: Number(direct[1]),
          longitude: Number(direct[2]),
        };
      }

      // Accept pasted Google Maps URLs containing @lat,lng or q=lat,lng.
      const mapPattern = raw.match(
        /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
      );
      if (mapPattern) {
        return {
          latitude: Number(mapPattern[1]),
          longitude: Number(mapPattern[2]),
        };
      }

      const qPattern = raw.match(
        /[?&]q=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
      );
      if (qPattern) {
        return {
          latitude: Number(qPattern[1]),
          longitude: Number(qPattern[2]),
        };
      }

      return null;
    };

    let latitude = parseOptionalNumber(hospitalForm.latitude);
    let longitude = parseOptionalNumber(hospitalForm.longitude);
    if (
      latitude == null &&
      longitude == null &&
      hospitalForm.locationInput.trim()
    ) {
      const parsed = parseCoordinatesFromText(hospitalForm.locationInput);
      if (!parsed) {
        showError(
          "Invalid Location",
          "Paste coordinates like 9.03, 38.74 or a Google Maps URL.",
        );
        return;
      }
      latitude = parsed.latitude;
      longitude = parsed.longitude;
    }

    if ((latitude == null) !== (longitude == null)) {
      showError(
        "Invalid Location",
        "Provide both latitude and longitude, or leave both empty.",
      );
      return;
    }
    if (latitude != null && (latitude < -90 || latitude > 90)) {
      showError("Invalid Latitude", "Latitude must be between -90 and 90.");
      return;
    }
    if (longitude != null && (longitude < -180 || longitude > 180)) {
      showError("Invalid Longitude", "Longitude must be between -180 and 180.");
      return;
    }

    const maxConcurrent = parseOptionalNumber(
      hospitalForm.maxConcurrentEmergencies,
    );
    if (maxConcurrent != null && (maxConcurrent < 1 || maxConcurrent > 500)) {
      showError(
        "Invalid Capacity",
        "Max concurrent emergencies must be between 1 and 500.",
      );
      return;
    }

    const dispatchWeight = parseOptionalNumber(hospitalForm.dispatchWeight);
    if (
      dispatchWeight != null &&
      (dispatchWeight < 0.1 || dispatchWeight > 5.0)
    ) {
      showError(
        "Invalid Dispatch Weight",
        "Dispatch weight must be between 0.1 and 5.0.",
      );
      return;
    }

    const icuBeds = parseOptionalNumber(hospitalForm.icuBedsAvailable);
    if (icuBeds != null && (icuBeds < 0 || icuBeds > 1000)) {
      showError("Invalid ICU Beds", "ICU beds must be between 0 and 1000.");
      return;
    }

    const handover = parseOptionalNumber(hospitalForm.averageHandoverMinutes);
    if (handover != null && (handover < 1 || handover > 240)) {
      showError(
        "Invalid Handover",
        "Average handover minutes must be between 1 and 240.",
      );
      return;
    }

    setCreatingHospital(true);
    try {
      const payload: Record<string, any> = {
        hospital_name: hospitalForm.hospitalName.trim(),
        phone: cleanedPhone,
        address: hospitalForm.address.trim() || "Not set",
        password: hospitalForm.password,
        trauma_capable: hospitalForm.traumaCapable,
        is_accepting_emergencies: hospitalForm.isAcceptingEmergencies,
      };

      if (latitude != null && longitude != null) {
        payload.latitude = latitude;
        payload.longitude = longitude;
      }
      if (maxConcurrent != null)
        payload.max_concurrent_emergencies = Math.trunc(maxConcurrent);
      if (dispatchWeight != null) payload.dispatch_weight = dispatchWeight;
      if (icuBeds != null) payload.icu_beds_available = Math.trunc(icuBeds);
      if (handover != null)
        payload.average_handover_minutes = Math.trunc(handover);

      await backendPost("/auth/provision-hospital", payload);
      showSuccess(
        "Hospital Created",
        "Hospital dashboard account created successfully.",
      );
      setCreateHospitalVisible(false);
      setHospitalForm({
        hospitalName: "",
        phone: "",
        address: "",
        locationInput: "",
        password: "",
        latitude: "",
        longitude: "",
        maxConcurrentEmergencies: "",
        dispatchWeight: "1",
        traumaCapable: false,
        icuBedsAvailable: "",
        averageHandoverMinutes: "",
        isAcceptingEmergencies: true,
      });
      fetchAll();
    } catch (err: any) {
      const message = String(
        err?.message || "Failed to create hospital account.",
      );
      showError("Creation Failed", message);
    } finally {
      setCreatingHospital(false);
    }
  };

  const useCurrentLocation = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        showError(
          "Location Permission",
          "Location permission is required to auto-fill hospital coordinates.",
        );
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = current.coords.latitude;
      const lng = current.coords.longitude;
      setHospitalForm((p) => ({
        ...p,
        latitude: lat.toFixed(6),
        longitude: lng.toFixed(6),
        locationInput: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      }));
      showSuccess(
        "Location Added",
        "Coordinates were filled from your current location.",
      );
    } catch {
      showError(
        "Location Failed",
        "Could not read your current location. You can still paste coordinates manually.",
      );
    }
  };

  const useAddisAbabaCenter = () => {
    setHospitalForm((p) => ({
      ...p,
      latitude: "9.030000",
      longitude: "38.740000",
      locationInput: "9.030000, 38.740000",
    }));
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return d;
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

  /* ─── computed ────────────────────────────────────────────── */

  const usersViewData = React.useMemo<Profile[]>(() => {
    const hospitalPhonesInProfiles = new Set(
      users
        .filter((u) => u.role === "hospital")
        .map((u) => (u.phone ?? "").trim())
        .filter(Boolean),
    );

    const hospitalsAsUsers: Profile[] = hospitals
      .filter((h) => !hospitalPhonesInProfiles.has((h.phone ?? "").trim()))
      .map((h) => ({
        id: h.id,
        full_name: h.name,
        phone: h.phone,
        role: "hospital",
        hospital_id: h.id,
        created_at: h.created_at,
        updated_at: h.created_at,
      }));

    return [...users, ...hospitalsAsUsers];
  }, [users, hospitals]);

  const roleCounts = {
    all: usersViewData.length,
    patient: usersViewData.filter((u) => u.role === "patient").length,
    ambulance: usersViewData.filter(
      (u) => u.role === "ambulance" || u.role === "driver",
    ).length,
    admin: usersViewData.filter((u) => u.role === "admin").length,
    hospital: usersViewData.filter((u) => u.role === "hospital").length,
  };

  const activeEmergencies = emergencies.filter(
    (e) => !["completed", "cancelled"].includes(e.status),
  );
  const availableAmbulances = ambulances.filter((a) => a.is_available);

  const filteredUsers = usersViewData.filter((u) => {
    if (filterRole === "ambulance") {
      if (u.role !== "ambulance") {
        if (u.role !== "driver") return false;
      }
    } else if (filterRole !== "all") {
      if (u.role !== filterRole) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (u.full_name ?? "").toLowerCase().includes(q) ||
      (u.phone ?? "").toLowerCase().includes(q)
    );
  });

  const filteredEmergencies = emergencies
    .filter((e) => {
      if (emergencyFilter === "active")
        return !["completed", "cancelled"].includes(e.status);
      if (emergencyFilter === "completed") return e.status === "completed";
      if (emergencyFilter === "cancelled") return e.status === "cancelled";
      return true;
    })
    .filter((e) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        e.emergency_type.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q)
      );
    });

  const filteredAmbulances = ambulances.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.vehicle_number.toLowerCase().includes(q) ||
      a.type?.toLowerCase().includes(q)
    );
  });

  const filteredHospitals = hospitals.filter((h) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      h.name.toLowerCase().includes(q) || h.address?.toLowerCase().includes(q)
    );
  });

  /* ─── stat cards ──────────────────────────────────────────── */

  const statCards = [
    {
      label: "Total Users",
      count: roleCounts.all,
      icon: "people" as const,
      color: "#6366F1",
    },
    {
      label: "Patients",
      count: roleCounts.patient,
      icon: "person" as const,
      color: "#3B82F6",
    },
    {
      label: "Ambulances",
      count: roleCounts.ambulance,
      icon: "local-shipping" as const,
      color: "#F59E0B",
    },
    {
      label: "Active Emergencies",
      count: activeEmergencies.length,
      icon: "warning" as const,
      color: "#DC2626",
    },
    {
      label: "Ambulances",
      count: ambulances.length,
      icon: "directions-car" as const,
      color: "#8B5CF6",
    },
    {
      label: "Available",
      count: availableAmbulances.length,
      icon: "check-circle" as const,
      color: "#10B981",
    },
    {
      label: "Hospitals",
      count: hospitals.length,
      icon: "local-hospital" as const,
      color: "#06B6D4",
    },
    {
      label: "Admins",
      count: roleCounts.admin,
      icon: "admin-panel-settings" as const,
      color: "#EC4899",
    },
  ];

  /* ─── renderers ───────────────────────────────────────────── */

  const renderUserCard = ({ item }: { item: Profile }) => {
    const roleStyle = ROLE_COLORS[item.role] ?? ROLE_COLORS.patient;
    return (
      <View
        style={[
          styles.itemCard,
          { backgroundColor: cardBg, borderColor: cardBorder },
        ]}
      >
        <View style={styles.cardRow}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: isDark
                  ? "rgba(220,38,38,0.15)"
                  : "rgba(220,38,38,0.08)",
              },
            ]}
          >
            <MaterialIcons
              name={
                item.role === "ambulance" || item.role === "driver"
                  ? "local-shipping"
                  : item.role === "admin"
                    ? "admin-panel-settings"
                    : item.role === "hospital"
                      ? "local-hospital"
                      : "person"
              }
              size={22}
              color="#DC2626"
            />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              {item.full_name || "No Name"}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {item.phone || "No phone"}
            </ThemedText>
          </View>
          <View
            style={[
              styles.badge,
              { backgroundColor: isDark ? roleStyle.bg + "33" : roleStyle.bg },
            ]}
          >
            <ThemedText style={[styles.badgeText, { color: roleStyle.text }]}>
              {item.role === "driver" ? "ambulance" : item.role}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          <View style={styles.footerItem}>
            <MaterialIcons name="phone" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              {item.phone || "N/A"}
            </ThemedText>
          </View>
          <View style={styles.footerItem}>
            <MaterialIcons name="calendar-today" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              {formatDate(item.created_at)}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderEmergencyCard = ({ item }: { item: EmergencyRequest }) => {
    const statusColor = STATUS_COLORS[item.status] ?? "#6B7280";
    const patientProfile = users.find((u) => u.id === item.patient_id);
    return (
      <View
        style={[
          styles.itemCard,
          { backgroundColor: cardBg, borderColor: cardBorder },
        ]}
      >
        <View style={styles.cardRow}>
          <View
            style={[styles.avatar, { backgroundColor: statusColor + "18" }]}
          >
            <MaterialIcons name="warning" size={22} color={statusColor} />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              {patientProfile?.full_name || item.patient_id.slice(0, 8) + "..."}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {item.emergency_type.charAt(0).toUpperCase() +
                item.emergency_type.slice(1)}{" "}
              — {item.description || "No description"}
            </ThemedText>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColor + "18" },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: statusColor }]}
            />
            <ThemedText style={[styles.badgeText, { color: statusColor }]}>
              {item.status.replace("_", " ")}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          {item.latitude !== 0 && (
            <View style={styles.footerItem}>
              <MaterialIcons name="location-on" size={14} color={subText} />
              <ThemedText style={[styles.footerText, { color: subText }]}>
                {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
              </ThemedText>
            </View>
          )}
          <View style={styles.footerItem}>
            <MaterialIcons name="access-time" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              {formatDateTime(item.created_at)}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderAmbulanceCard = ({ item }: { item: Ambulance }) => {
    const driverProfile = users.find((u) => u.id === item.current_driver_id);
    const isAvail = item.is_available;
    return (
      <View
        style={[
          styles.itemCard,
          { backgroundColor: cardBg, borderColor: cardBorder },
        ]}
      >
        <View style={styles.cardRow}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: isAvail ? "#D1FAE520" : "#FEE2E220" },
            ]}
          >
            <MaterialIcons
              name="directions-car"
              size={22}
              color={isAvail ? "#10B981" : "#EF4444"}
            />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              {item.vehicle_number}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {driverProfile
                ? "Ambulance Officer: " + driverProfile.full_name
                : "No ambulance officer assigned"}
              {item.type ? " · " + item.type : ""}
            </ThemedText>
          </View>
          <View
            style={[
              styles.badge,
              { backgroundColor: isAvail ? "#D1FAE5" : "#FEE2E2" },
            ]}
          >
            <ThemedText
              style={[
                styles.badgeText,
                { color: isAvail ? "#059669" : "#DC2626" },
              ]}
            >
              {isAvail ? "Available" : "Busy"}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          <View style={styles.footerItem}>
            <MaterialIcons name="calendar-today" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              {formatDate(item.created_at)}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderHospitalCard = ({ item }: { item: Hospital }) => (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/hospitals/[id]",
          params: { id: item.id },
        } as any)
      }
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
    >
      <View
        style={[
          styles.itemCard,
          { backgroundColor: cardBg, borderColor: cardBorder },
        ]}
      >
        <View style={styles.cardRow}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: isDark
                  ? "rgba(6,182,212,0.15)"
                  : "rgba(6,182,212,0.08)",
              },
            ]}
          >
            <MaterialIcons name="local-hospital" size={22} color="#06B6D4" />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              {item.name}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {item.address || "No address"}
            </ThemedText>
          </View>
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  item.is_accepting_emergencies === false
                    ? "#FEE2E2"
                    : "#D1FAE5",
              },
            ]}
          >
            <ThemedText
              style={[
                styles.badgeText,
                {
                  color:
                    item.is_accepting_emergencies === false
                      ? "#DC2626"
                      : "#059669",
                },
              ]}
            >
              {item.is_accepting_emergencies === false ? "Closed" : "Accepting"}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          <View style={styles.footerItem}>
            <MaterialIcons name="phone" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              {item.phone || "N/A"}
            </ThemedText>
          </View>
          <View style={styles.footerItem}>
            <MaterialIcons name="local-hospital" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              ICU {item.icu_beds_available ?? 0}
            </ThemedText>
          </View>
          <View style={styles.footerItem}>
            <MaterialIcons name="calendar-today" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              {formatDate(item.created_at)}
            </ThemedText>
          </View>
          <View style={styles.footerItem}>
            <MaterialIcons name="open-in-new" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>
              View details
            </ThemedText>
          </View>
        </View>
      </View>
    </Pressable>
  );

  /* ─── filter chips ────────────────────────────────────────── */

  const renderRoleChip = (role: FilterRole, label: string) => {
    const isActive = filterRole === role;
    return (
      <Pressable
        key={role}
        onPress={() => setFilterRole(role)}
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
          {label} ({roleCounts[role]})
        </ThemedText>
      </Pressable>
    );
  };

  const renderEmergencyChip = (
    filter: EmergencyFilter,
    label: string,
    count: number,
  ) => {
    const isActive = emergencyFilter === filter;
    return (
      <Pressable
        key={filter}
        onPress={() => setEmergencyFilter(filter)}
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

  const getListData = (): any[] => {
    switch (activeTab) {
      case "users":
        return filteredUsers;
      case "emergencies":
        return filteredEmergencies;
      case "ambulances":
        return filteredAmbulances;
      case "hospitals":
        return filteredHospitals;
      case "settings":
        return [];
    }
  };

  const getRenderItem = (): any => {
    switch (activeTab) {
      case "users":
        return renderUserCard;
      case "emergencies":
        return renderEmergencyCard;
      case "ambulances":
        return renderAmbulanceCard;
      case "hospitals":
        return renderHospitalCard;
      case "settings":
        return () => null;
    }
  };

  /* ─── main render ─────────────────────────────────────────── */

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Erdataya Admin"
        onProfilePress={() => setProfileVisible(true)}
      />

      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          {/* Stat cards */}
          <View style={styles.statsGrid}>
            {statCards.map((stat, idx) => (
              <View
                key={`${stat.label}-${idx}`}
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

          {/* Tabs */}
          <View style={[styles.tabBar, { borderColor: cardBorder }]}>
            {(
              [
                { key: "users", label: "Users", icon: "people" },
                { key: "emergencies", label: "Emergencies", icon: "warning" },
                {
                  key: "ambulances",
                  label: "Ambulances",
                  icon: "directions-car",
                },
                {
                  key: "hospitals",
                  label: "Hospitals",
                  icon: "local-hospital",
                },
                {
                  key: "settings",
                  label: "Settings",
                  icon: "settings",
                },
              ] as { key: Tab; label: string; icon: any }[]
            ).map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => {
                    setActiveTab(tab.key);
                    setSearch("");
                  }}
                  style={[styles.tab, isActive && styles.tabActive]}
                >
                  <MaterialIcons
                    name={tab.icon}
                    size={18}
                    color={isActive ? "#DC2626" : subText}
                  />
                  <ThemedText
                    style={[
                      styles.tabLabel,
                      { color: isActive ? "#DC2626" : subText },
                      isActive && styles.tabLabelActive,
                    ]}
                  >
                    {tab.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Search */}
          <View
            style={[
              styles.searchWrap,
              { backgroundColor: inputBg, borderColor: inputBorder },
            ]}
          >
            <MaterialIcons name="search" size={20} color={subText} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder={"Search " + activeTab + "..."}
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

          {/* Filters */}
          {activeTab === "users" && (
            <View style={styles.filterRow}>
              {renderRoleChip("all", "All")}
              {renderRoleChip("patient", "Patients")}
              {renderRoleChip("ambulance", "Ambulances")}
              {renderRoleChip("hospital", "Hospital")}
              {renderRoleChip("admin", "Admins")}
            </View>
          )}
          {activeTab === "emergencies" && (
            <View style={styles.filterRow}>
              {renderEmergencyChip("all", "All", emergencies.length)}
              {renderEmergencyChip(
                "active",
                "Active",
                activeEmergencies.length,
              )}
              {renderEmergencyChip(
                "completed",
                "Completed",
                emergencies.filter((e) => e.status === "completed").length,
              )}
              {renderEmergencyChip(
                "cancelled",
                "Cancelled",
                emergencies.filter((e) => e.status === "cancelled").length,
              )}
            </View>
          )}

          {activeTab === "hospitals" && (
            <View style={styles.actionRow}>
              <Pressable
                style={styles.createBtn}
                onPress={() => setCreateHospitalVisible(true)}
              >
                <MaterialIcons name="add" size={18} color="#FFF" />
                <ThemedText style={styles.createBtnText}>
                  Create Hospital Login
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Data list */}
          {activeTab === "settings" ? (
            <View style={{ gap: 16 }}>
              {/* ── Chatbot Stats Card ── */}
              <View
                style={[
                  styles.settingsPanel,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <View style={styles.settingsHeader}>
                  <MaterialIcons name="analytics" size={24} color="#8B5CF6" />
                  <ThemedText
                    style={[styles.settingsTitle, { color: colors.text }]}
                  >
                    Chatbot Usage
                  </ThemedText>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 12,
                    marginTop: 8,
                  }}
                >
                  <View
                    style={[
                      styles.settingsStatCard,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <ThemedText
                      style={[styles.settingsStatNumber, { color: "#8B5CF6" }]}
                    >
                      {totalChatRequests}
                    </ThemedText>
                    <ThemedText
                      style={[styles.settingsStatLabel, { color: subText }]}
                    >
                      Total Messages
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.settingsStatCard,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <ThemedText
                      style={[styles.settingsStatNumber, { color: "#3B82F6" }]}
                    >
                      {uniqueChatUsers}
                    </ThemedText>
                    <ThemedText
                      style={[styles.settingsStatLabel, { color: subText }]}
                    >
                      Unique Users
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.settingsStatCard,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <ThemedText
                      style={[styles.settingsStatNumber, { color: "#F59E0B" }]}
                    >
                      {todayChatRequests}
                    </ThemedText>
                    <ThemedText
                      style={[styles.settingsStatLabel, { color: subText }]}
                    >
                      Today
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.settingsStatCard,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <ThemedText
                      style={[styles.settingsStatNumber, { color: "#10B981" }]}
                    >
                      {activeProvider.toUpperCase()}
                    </ThemedText>
                    <ThemedText
                      style={[styles.settingsStatLabel, { color: subText }]}
                    >
                      Active Provider
                    </ThemedText>
                  </View>
                </View>
              </View>

              {/* ── Provider & API Key Card ── */}
              <View
                style={[
                  styles.settingsPanel,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <View style={styles.settingsHeader}>
                  <MaterialIcons name="vpn-key" size={24} color="#DC2626" />
                  <ThemedText
                    style={[styles.settingsTitle, { color: colors.text }]}
                  >
                    AI Provider & API Key
                  </ThemedText>
                </View>
                <ThemedText style={[styles.settingsDesc, { color: subText }]}>
                  Switch between AI providers for the first aid chatbot. Each
                  provider requires its own API key.
                </ThemedText>

                {/* Provider selector */}
                <ThemedText
                  style={[styles.settingsLabel, { color: colors.text }]}
                >
                  Provider
                </ThemedText>
                <View style={styles.settingsProviderRow}>
                  {availableProviders.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setActiveProvider(p)}
                      style={[
                        styles.settingsProviderBtn,
                        {
                          backgroundColor:
                            activeProvider === p ? "#DC2626" : inputBg,
                          borderColor:
                            activeProvider === p ? "#DC2626" : inputBorder,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          color: activeProvider === p ? "#FFF" : colors.text,
                          fontSize: 13,
                          fontWeight: "700",
                          fontFamily: Fonts.sans,
                          textTransform: "uppercase",
                        }}
                      >
                        {p}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>

                {/* Current key status */}
                <View
                  style={[
                    styles.settingsKeyStatus,
                    { backgroundColor: inputBg, borderColor: inputBorder },
                  ]}
                >
                  <MaterialIcons
                    name={apiKeySet ? "check-circle" : "error-outline"}
                    size={18}
                    color={apiKeySet ? "#10B981" : "#F59E0B"}
                  />
                  <ThemedText
                    style={{
                      color: colors.text,
                      fontSize: 13,
                      fontFamily: Fonts.sans,
                      flex: 1,
                    }}
                  >
                    Current key: {apiKeyPreview || "(loading...)"}
                  </ThemedText>
                  <Pressable onPress={fetchSettings} hitSlop={8}>
                    <MaterialIcons name="refresh" size={18} color={subText} />
                  </Pressable>
                </View>

                {/* New key input */}
                <ThemedText
                  style={[styles.settingsLabel, { color: colors.text }]}
                >
                  New API Key
                </ThemedText>
                <TextInput
                  style={[
                    styles.settingsInput,
                    {
                      color: colors.text,
                      borderColor: inputBorder,
                      backgroundColor: inputBg,
                    },
                  ]}
                  placeholder="sk-..."
                  placeholderTextColor={subText}
                  value={newApiKey}
                  onChangeText={setNewApiKey}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />

                <Pressable
                  style={[
                    styles.settingsSaveBtn,
                    savingApiKey && { opacity: 0.7 },
                  ]}
                  onPress={handleSaveApiKey}
                  disabled={savingApiKey}
                >
                  {savingApiKey ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <MaterialIcons name="save" size={18} color="#FFF" />
                  )}
                  <ThemedText style={styles.settingsSaveBtnText}>
                    {savingApiKey
                      ? "Saving..."
                      : `Update ${activeProvider.toUpperCase()} Key`}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#DC2626" />
              <ThemedText style={[styles.loadingText, { color: subText }]}>
                Loading data...
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={getListData()}
              keyExtractor={(item: any) => item.id}
              renderItem={getRenderItem()}
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
                  <MaterialIcons name="inbox" size={48} color={subText} />
                  <ThemedText style={[styles.emptyText, { color: subText }]}>
                    {search
                      ? "No " + activeTab + " match your search"
                      : "No " + activeTab + " found"}
                  </ThemedText>
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      {/* Profile Dropdown */}
      <Modal
        transparent
        visible={createHospitalVisible}
        animationType="fade"
        onRequestClose={() => setCreateHospitalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setCreateHospitalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalKeyboardWrap}
          >
            <Pressable
              style={[
                styles.createModalCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <ScrollView
                style={styles.createScroll}
                contentContainerStyle={styles.createScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <ThemedText
                  style={[styles.createModalTitle, { color: colors.text }]}
                >
                  Create Hospital Account
                </ThemedText>

                <TextInput
                  style={[
                    styles.createInput,
                    {
                      color: colors.text,
                      borderColor: cardBorder,
                      backgroundColor: inputBg,
                    },
                  ]}
                  placeholder="Hospital name"
                  placeholderTextColor={subText}
                  value={hospitalForm.hospitalName}
                  onChangeText={(t) =>
                    setHospitalForm((p) => ({ ...p, hospitalName: t }))
                  }
                />
                <TextInput
                  style={[
                    styles.createInput,
                    {
                      color: colors.text,
                      borderColor: cardBorder,
                      backgroundColor: inputBg,
                    },
                  ]}
                  placeholder="Phone (e.g. +2519...)"
                  placeholderTextColor={subText}
                  value={hospitalForm.phone}
                  onChangeText={(t) =>
                    setHospitalForm((p) => ({ ...p, phone: t }))
                  }
                />
                <TextInput
                  style={[
                    styles.createInput,
                    {
                      color: colors.text,
                      borderColor: cardBorder,
                      backgroundColor: inputBg,
                    },
                  ]}
                  placeholder="Address"
                  placeholderTextColor={subText}
                  value={hospitalForm.address}
                  onChangeText={(t) =>
                    setHospitalForm((p) => ({ ...p, address: t }))
                  }
                />
                <TextInput
                  style={[
                    styles.createInput,
                    {
                      color: colors.text,
                      borderColor: cardBorder,
                      backgroundColor: inputBg,
                    },
                  ]}
                  placeholder="Paste location: 9.03, 38.74 or Google Maps link"
                  placeholderTextColor={subText}
                  value={hospitalForm.locationInput}
                  onChangeText={(t) =>
                    setHospitalForm((p) => ({ ...p, locationInput: t }))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.createRow}>
                  <Pressable
                    onPress={useCurrentLocation}
                    style={[
                      styles.quickLocationBtn,
                      { backgroundColor: "#DBEAFE" },
                    ]}
                  >
                    <MaterialIcons
                      name="my-location"
                      size={14}
                      color="#1D4ED8"
                    />
                    <ThemedText style={styles.quickLocationText}>
                      Use current location
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={useAddisAbabaCenter}
                    style={[
                      styles.quickLocationBtn,
                      { backgroundColor: "#FEF3C7" },
                    ]}
                  >
                    <MaterialIcons
                      name="location-city"
                      size={14}
                      color="#B45309"
                    />
                    <ThemedText style={styles.quickLocationText}>
                      Use Addis Ababa center
                    </ThemedText>
                  </Pressable>
                </View>
                <View style={styles.createRow}>
                  <TextInput
                    style={[
                      styles.createInput,
                      styles.createInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Latitude"
                    placeholderTextColor={subText}
                    keyboardType="decimal-pad"
                    value={hospitalForm.latitude}
                    onChangeText={(t) =>
                      setHospitalForm((p) => ({ ...p, latitude: t }))
                    }
                  />
                  <TextInput
                    style={[
                      styles.createInput,
                      styles.createInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Longitude"
                    placeholderTextColor={subText}
                    keyboardType="decimal-pad"
                    value={hospitalForm.longitude}
                    onChangeText={(t) =>
                      setHospitalForm((p) => ({ ...p, longitude: t }))
                    }
                  />
                </View>
                <View style={styles.createRow}>
                  <TextInput
                    style={[
                      styles.createInput,
                      styles.createInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Max concurrent emergencies"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={hospitalForm.maxConcurrentEmergencies}
                    onChangeText={(t) =>
                      setHospitalForm((p) => ({
                        ...p,
                        maxConcurrentEmergencies: t,
                      }))
                    }
                  />
                  <TextInput
                    style={[
                      styles.createInput,
                      styles.createInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Dispatch weight"
                    placeholderTextColor={subText}
                    keyboardType="decimal-pad"
                    value={hospitalForm.dispatchWeight}
                    onChangeText={(t) =>
                      setHospitalForm((p) => ({ ...p, dispatchWeight: t }))
                    }
                  />
                </View>
                <View style={styles.createRow}>
                  <TextInput
                    style={[
                      styles.createInput,
                      styles.createInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="ICU beds available"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={hospitalForm.icuBedsAvailable}
                    onChangeText={(t) =>
                      setHospitalForm((p) => ({ ...p, icuBedsAvailable: t }))
                    }
                  />
                  <TextInput
                    style={[
                      styles.createInput,
                      styles.createInputHalf,
                      {
                        color: colors.text,
                        borderColor: cardBorder,
                        backgroundColor: inputBg,
                      },
                    ]}
                    placeholder="Avg handover minutes"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={hospitalForm.averageHandoverMinutes}
                    onChangeText={(t) =>
                      setHospitalForm((p) => ({
                        ...p,
                        averageHandoverMinutes: t,
                      }))
                    }
                  />
                </View>
                <View style={styles.createRow}>
                  <Pressable
                    onPress={() =>
                      setHospitalForm((p) => ({
                        ...p,
                        traumaCapable: !p.traumaCapable,
                      }))
                    }
                    style={[
                      styles.toggleChip,
                      {
                        backgroundColor: hospitalForm.traumaCapable
                          ? "#DCFCE7"
                          : "#F3F4F6",
                      },
                    ]}
                  >
                    <ThemedText
                      style={{
                        color: hospitalForm.traumaCapable
                          ? "#166534"
                          : "#374151",
                        fontWeight: "700",
                        fontFamily: Fonts.sans,
                        fontSize: 12,
                      }}
                    >
                      Trauma Capable:{" "}
                      {hospitalForm.traumaCapable ? "Yes" : "No"}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setHospitalForm((p) => ({
                        ...p,
                        isAcceptingEmergencies: !p.isAcceptingEmergencies,
                      }))
                    }
                    style={[
                      styles.toggleChip,
                      {
                        backgroundColor: hospitalForm.isAcceptingEmergencies
                          ? "#DBEAFE"
                          : "#F3F4F6",
                      },
                    ]}
                  >
                    <ThemedText
                      style={{
                        color: hospitalForm.isAcceptingEmergencies
                          ? "#1D4ED8"
                          : "#374151",
                        fontWeight: "700",
                        fontFamily: Fonts.sans,
                        fontSize: 12,
                      }}
                    >
                      Accepting:{" "}
                      {hospitalForm.isAcceptingEmergencies ? "Open" : "Closed"}
                    </ThemedText>
                  </Pressable>
                </View>
                <TextInput
                  style={[
                    styles.createInput,
                    {
                      color: colors.text,
                      borderColor: cardBorder,
                      backgroundColor: inputBg,
                    },
                  ]}
                  placeholder="Temporary password"
                  placeholderTextColor={subText}
                  value={hospitalForm.password}
                  onChangeText={(t) =>
                    setHospitalForm((p) => ({ ...p, password: t }))
                  }
                  secureTextEntry
                />

                <View style={styles.createActions}>
                  <Pressable
                    style={[styles.createActionBtn, styles.cancelBtn]}
                    onPress={() => setCreateHospitalVisible(false)}
                  >
                    <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.createActionBtn,
                      styles.saveBtn,
                      creatingHospital && { opacity: 0.7 },
                    ]}
                    onPress={handleCreateHospitalUser}
                    disabled={creatingHospital}
                  >
                    <ThemedText style={styles.saveBtnText}>
                      {creatingHospital ? "Creating..." : "Create"}
                    </ThemedText>
                  </Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

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
                      ? "rgba(220,38,38,0.15)"
                      : "rgba(220,38,38,0.08)",
                  },
                ]}
              >
                <MaterialIcons
                  name="admin-panel-settings"
                  size={28}
                  color="#DC2626"
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText
                  style={[styles.dropdownName, { color: colors.text }]}
                >
                  Erdataya Admin
                </ThemedText>
                <ThemedText style={[styles.dropdownPhone, { color: subText }]}>
                  {user?.phone || ""}
                </ThemedText>
                <View
                  style={[
                    styles.dropdownRoleBadge,
                    { backgroundColor: isDark ? "#FCE7F333" : "#FCE7F3" },
                  ]}
                >
                  <ThemedText
                    style={[styles.dropdownRoleLabel, { color: "#BE185D" }]}
                  >
                    ADMIN
                  </ThemedText>
                </View>
              </View>
            </View>
            <View
              style={[styles.dropdownDivider, { backgroundColor: cardBorder }]}
            />
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
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  bg: { flex: 1 },
  scrollOuter: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingBottom: 60 },
  container: {
    paddingHorizontal: 16,
    maxWidth: 1100,
    alignSelf: "center" as any,
    width: "100%" as any,
  },

  heroCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  heroSub: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },

  webOnlyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  webOnlyTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  webOnlySub: { fontSize: 14, fontFamily: Fonts.sans, textAlign: "center" },

  pageHeader: { marginTop: 20, marginBottom: 16 },
  pageTitle: {
    fontSize: 26,
    fontWeight: "800",
    fontFamily: Fonts.sans,
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
    flexBasis: "22%" as any,
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
  statCount: { fontSize: 24, fontWeight: "800", fontFamily: Fonts.sans },
  statLabel: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    textAlign: "center",
  },

  tabBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderBottomWidth: 1,
    marginBottom: 14,
    gap: 2,
  },
  tabBarContent: { flexDirection: "row", gap: 2 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: "#DC2626" },
  tabLabel: { fontSize: 13, fontWeight: "600", fontFamily: Fonts.sans },
  tabLabelActive: { fontWeight: "800" },

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
  chipText: { fontSize: 12, fontWeight: "700", fontFamily: Fonts.sans },

  itemCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  cardRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: "700", fontFamily: Fonts.sans },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  cardFooter: {
    flexDirection: "row",
    gap: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  footerText: { fontSize: 12, fontFamily: Fonts.sans },

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
  listContent: { paddingBottom: 20 },

  actionRow: {
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  createBtn: {
    backgroundColor: "#DC2626",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  createBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalKeyboardWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  createModalCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "88%",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  createScroll: {
    width: "100%",
  },
  createScrollContent: {
    gap: 10,
    paddingBottom: 6,
  },
  createModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    marginBottom: 4,
  },
  createInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  createRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  createInputHalf: { flex: 1 },
  quickLocationBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  quickLocationText: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  toggleChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  createActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  createActionBtn: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelBtn: { backgroundColor: "#E5E7EB" },
  cancelBtnText: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  saveBtn: { backgroundColor: "#DC2626" },
  saveBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
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
  dropdownName: { fontSize: 16, fontWeight: "700", fontFamily: Fonts.sans },
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
    fontWeight: "800",
    fontFamily: Fonts.sans,
    letterSpacing: 0.5,
  },
  dropdownDivider: { height: 1, marginVertical: 12 },
  dropdownSignOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  dropdownSignOutText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#DC2626",
  },

  /* Settings tab */
  settingsPanel: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    gap: 8,
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  settingsTitle: {
    fontSize: 17,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  settingsDesc: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    lineHeight: 19,
  },
  settingsKeyStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
  },
  settingsInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  settingsSaveBtn: {
    backgroundColor: "#DC2626",
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
  },
  settingsSaveBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  settingsLabel: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    marginTop: 14,
    marginBottom: 6,
  },
  settingsProviderRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  settingsProviderBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  settingsStatCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  settingsStatNumber: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  settingsStatLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
