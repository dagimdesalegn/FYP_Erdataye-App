import { FirstAidFab } from "@/components/first-aid-fab";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Animated,
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    useWindowDimensions,
    Vibration,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppState } from "@/components/app-state";
import { HtmlMapView } from "@/components/html-map-view";
import { LoadingModal } from "@/components/loading-modal";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    buildDriverPatientMapHtml,
    buildMapHtml,
    calculateDistance,
    parsePostGISPoint,
} from "@/utils/emergency";
import {
    cancelEmergencyWithinWindow,
    createFamilyShareLink,
    getEmergencyCancelWindowState,
    getEmergencyDetails,
    getEmergencyHospitalStatus,
    subscribeToAmbulanceLocation,
    subscribeToEmergency,
} from "@/utils/patient";

/* ─── Status notification messages (patient-facing) ───── */
const STATUS_NOTIFICATIONS: Record<
  string,
  { title: string; message: string; icon: string }
> = {
  pending: {
    title: "Request Sent",
    message: "Looking for the nearest available ambulance...",
    icon: "hourglass-top",
  },
  assigned: {
    title: "Ambulance Assigned",
    message: "An ambulance has been assigned to your emergency.",
    icon: "local-shipping",
  },
  en_route: {
    title: "Ambulance is Coming!",
    message: "The ambulance is on its way to your location.",
    icon: "directions-car",
  },
  at_scene: {
    title: "Ambulance Arrived",
    message: "The ambulance has arrived at your location.",
    icon: "place",
  },
  arrived: {
    title: "Ambulance Arrived",
    message: "The ambulance has arrived at your location.",
    icon: "place",
  },
  transporting: {
    title: "On the Way to Hospital",
    message: "You are being transported to the hospital.",
    icon: "local-hospital",
  },
  at_hospital: {
    title: "Arrived at Hospital",
    message: "You have arrived at the hospital.",
    icon: "local-hospital",
  },
  completed: {
    title: "Emergency Completed",
    message: "Your emergency request has been completed. Stay safe!",
    icon: "check-circle",
  },
  cancelled: {
    title: "Emergency Cancelled",
    message: "This emergency request has been cancelled.",
    icon: "cancel",
  },
};

export default function PatientEmergencyTrackingScreen() {
  const distanceMeters = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  };

  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme];
  const { emergencyId } = useLocalSearchParams();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth > 600;
  const insets = useSafeAreaInsets();
  const { user } = useAppState();
  const { showAlert, showConfirm, showError, showSuccess } = useModal();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [emergency, setEmergency] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [ambulance, setAmbulance] = useState<any>(null);
  const [hospitalStatus, setHospitalStatus] = useState<any>(null);
  const [ambulanceCoords, setAmbulanceCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [patientLiveCoords, setPatientLiveCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [sharingLink, setSharingLink] = useState(false);
  const [cachedShareLink, setCachedShareLink] = useState<{
    shareUrl: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusNotification, setStatusNotification] = useState<string | null>(
    null,
  );
  const prevStatusRef = useRef<string | null>(null);
  const notifAnim = useRef(new Animated.Value(0)).current;
  const [animatedAmbulanceCoords, setAnimatedAmbulanceCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const ambulanceFixesRef = useRef<
    Array<{ latitude: number; longitude: number; at: number }>
  >([]);
  const lastAmbulanceFixRef = useRef<
    { latitude: number; longitude: number; at: number } | null
  >(null);
  const animatedCoordsRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [cancelRemainingSeconds, setCancelRemainingSeconds] = useState(0);

  const applyAmbulanceFix = useCallback((latitude: number, longitude: number) => {
    const now = Date.now();
    const prev = lastAmbulanceFixRef.current;

    if (prev) {
      const jumpMeters = distanceMeters(
        prev.latitude,
        prev.longitude,
        latitude,
        longitude,
      );
      const elapsedMs = now - prev.at;

      // Drop implausible sudden GPS jumps that cause fake 300m+ distance spikes.
      if (elapsedMs < 12000 && jumpMeters > 150) {
        return;
      }
      if (jumpMeters < 3) {
        return;
      }
    }

    const fix = { latitude, longitude, at: now };
    lastAmbulanceFixRef.current = fix;
    ambulanceFixesRef.current = [...ambulanceFixesRef.current, fix].slice(-3);
    const count = ambulanceFixesRef.current.length;
    const smoothed = ambulanceFixesRef.current.reduce(
      (acc, item) => ({
        latitude: acc.latitude + item.latitude / count,
        longitude: acc.longitude + item.longitude / count,
      }),
      { latitude: 0, longitude: 0 },
    );

    setAmbulanceCoords(smoothed);
  }, []);

  const loadData = useCallback(async () => {
    if (!emergencyId || typeof emergencyId !== "string") {
      setError("Invalid emergency ID");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const {
        emergency: emerg,
        assignment: assign,
        ambulance: amb,
        error: err,
      } = await getEmergencyDetails(emergencyId);
      if (err) {
        setError(err.message);
      } else {
        setEmergency(emerg);
        setAssignment(assign);
        setAmbulance(amb);
        if (emerg?.id) {
          const { data: hospitalData } = await getEmergencyHospitalStatus(
            emerg.id,
          );
          if (hospitalData) setHospitalStatus(hospitalData);
        }
        if (amb?.last_known_location) {
          const parsed = parsePostGISPoint(amb.last_known_location);
          if (parsed) applyAmbulanceFix(parsed.latitude, parsed.longitude);
        }
      }
    } catch (e) {
      setError("Failed to load emergency details");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [emergencyId]);

  useEffect(() => {
    void loadData();
  }, [loadData, applyAmbulanceFix]);

  // Realtime: emergency status changes
  useEffect(() => {
    if (!emergencyId || typeof emergencyId !== "string") return;
    const unsub = subscribeToEmergency(emergencyId, (updated) => {
      setEmergency(updated);
      // Also refresh assignment/ambulance details (phone, vehicle, ETA) on live status updates.
      void getEmergencyDetails(emergencyId).then(
        ({ assignment, ambulance }) => {
          setAssignment(assignment);
          setAmbulance(ambulance);
          void getEmergencyHospitalStatus(emergencyId).then(({ data }) => {
            if (data) setHospitalStatus(data);
          });
          if (ambulance?.last_known_location) {
            const parsed = parsePostGISPoint(ambulance.last_known_location);
            if (parsed) applyAmbulanceFix(parsed.latitude, parsed.longitude);
          }
        },
      );
    });
    return unsub;
  }, [emergencyId, applyAmbulanceFix]);

  // Polling fallback: check status every 8s in case realtime misses updates
  useEffect(() => {
    if (!emergencyId || typeof emergencyId !== "string") return;
    const interval = setInterval(async () => {
      try {
        const {
          emergency: emerg,
          assignment: assign,
          ambulance: amb,
        } = await getEmergencyDetails(emergencyId);
        if (emerg && emerg.status !== emergency?.status) setEmergency(emerg);
        void getEmergencyHospitalStatus(emergencyId).then(({ data }) => {
          if (data) setHospitalStatus(data);
        });
        if (assign) setAssignment(assign);
        if (amb) {
          setAmbulance(amb);
          if (amb.last_known_location) {
            const parsed = parsePostGISPoint(amb.last_known_location);
            if (parsed) applyAmbulanceFix(parsed.latitude, parsed.longitude);
          }
        }
      } catch {}
    }, 8000);
    return () => clearInterval(interval);
  }, [emergencyId, emergency?.status, applyAmbulanceFix]);

  // Show notification toast when status changes
  useEffect(() => {
    if (!emergency?.status) return;
    const cur = emergency.status;
    if (prevStatusRef.current && prevStatusRef.current !== cur) {
      const notif = STATUS_NOTIFICATIONS[cur];
      if (notif) {
        setStatusNotification(cur);
        // Vibrate on mobile for attention
        try {
          Vibration.vibrate([0, 300, 100, 300]);
        } catch {}
        Animated.sequence([
          Animated.timing(notifAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.delay(6000),
          Animated.timing(notifAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start(() => setStatusNotification(null));
      }
    }
    prevStatusRef.current = cur;
  }, [emergency?.status, notifAnim]);

  // Realtime: ambulance location
  useEffect(() => {
    if (!ambulance?.id) return;
    const unsub = subscribeToAmbulanceLocation(ambulance.id, (lat, lng) => {
      applyAmbulanceFix(lat, lng);
    });
    return unsub;
  }, [ambulance?.id, applyAmbulanceFix]);

  // Use patient's live location for more accurate distance during tracking.
  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;
    let mounted = true;

    const startPatientTracking = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (
          mounted &&
          Number.isFinite(current.coords.latitude) &&
          Number.isFinite(current.coords.longitude) &&
          (current.coords.accuracy ?? 999) <= 120
        ) {
          setPatientLiveCoords({
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
          });
        }

        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (loc) => {
            if (!mounted) return;
            if ((loc.coords.accuracy ?? 999) > 120) return;
            setPatientLiveCoords({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
          },
        );
      } catch {
        // Keep fallback to emergency request location when live tracking is unavailable.
      }
    };

    void startPatientTracking();
    return () => {
      mounted = false;
      if (watcher) watcher.remove();
    };
  }, []);

  // Keep displayed ambulance coordinates in sync with realtime updates.
  useEffect(() => {
    if (!ambulanceCoords) return;
    animatedCoordsRef.current = ambulanceCoords;
    setAnimatedAmbulanceCoords(ambulanceCoords);
  }, [ambulanceCoords]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const onCallDriver = async () => {
    let driverPhoneRaw =
      assignment?.driver_phone ??
      assignment?.driver_contact ??
      ambulance?.driver_phone ??
      ambulance?.phone_number ??
      ambulance?.phone;

    let driverPhone =
      typeof driverPhoneRaw === "string" ? driverPhoneRaw.trim() : "";

    // Fallback: force refresh details once before showing unavailable.
    if (!driverPhone && typeof emergencyId === "string") {
      try {
        const { assignment: latestAssignment, ambulance: latestAmbulance } =
          await getEmergencyDetails(emergencyId);
        if (latestAssignment) setAssignment(latestAssignment);
        if (latestAmbulance) setAmbulance(latestAmbulance);

        driverPhoneRaw =
          latestAssignment?.driver_phone ??
          latestAssignment?.driver_contact ??
          latestAmbulance?.driver_phone ??
          latestAmbulance?.phone_number ??
          latestAmbulance?.phone;
        driverPhone =
          typeof driverPhoneRaw === "string" ? driverPhoneRaw.trim() : "";
      } catch {
        // no-op, fallback modal will be shown below
      }
    }

    if (!driverPhone) {
      showAlert(
        "Unavailable",
        "Ambulance phone number is not available yet.",
      );
      return;
    }
    try {
      const telUrl = `tel:${driverPhone}`;
      const canOpen = await Linking.canOpenURL(telUrl);
      if (!canOpen) {
        showError("Call Failed", "This device cannot place a phone call.");
        return;
      }
      await Linking.openURL(telUrl);
    } catch {
      showError("Call Failed", "Unable to start the phone call.");
    }
  };

  const onShareLiveTracking = async () => {
    if (!emergencyId || typeof emergencyId !== "string") return;
    try {
      setSharingLink(true);
      const getShareLink = async () => {
        if (cachedShareLink) {
          const expiresMs = new Date(cachedShareLink.expiresAt).getTime();
          if (Number.isFinite(expiresMs) && expiresMs - Date.now() > 60 * 1000) {
            return {
              shareUrl: cachedShareLink.shareUrl,
              expiresAt: cachedShareLink.expiresAt,
              error: null as Error | null,
            };
          }
        }

        const created = await createFamilyShareLink(emergencyId, 180);
        if (!created.error && created.shareUrl) {
          setCachedShareLink({
            shareUrl: created.shareUrl,
            expiresAt: created.expiresAt,
          });
        }
        return {
          shareUrl: created.shareUrl,
          expiresAt: created.expiresAt,
          error: created.error,
        };
      };

      const { shareUrl, expiresAt, error: shareError } = await getShareLink();
      if (shareError || !shareUrl) {
        showError("Share Failed", shareError?.message || "Unable to create share link.");
        return;
      }

      const message = `Live emergency tracking link: ${shareUrl}`;

      if (Platform.OS === "web") {
        if (
          typeof window !== "undefined" &&
          (window as any).navigator?.clipboard
        ) {
          await (window as any).navigator.clipboard.writeText(shareUrl);
          showSuccess(
            "Link Copied",
            `Share link copied to clipboard. Expires: ${new Date(expiresAt).toLocaleString()}`,
          );
        } else {
          showAlert(
            "Share Link",
            `${message}\n\nExpires: ${new Date(expiresAt).toLocaleString()}`,
          );
        }
      } else {
        await Share.share({
          title: "Live Emergency Tracking",
          message: `${message}\nExpires: ${new Date(expiresAt).toLocaleString()}`,
          url: shareUrl,
        });
      }
    } catch (error: any) {
      showError(
        "Share Failed",
        error?.message || "Unable to share tracking link.",
      );
    } finally {
      setSharingLink(false);
    }
  };

  useEffect(() => {
    if (!emergency?.created_at) {
      setCancelRemainingSeconds(0);
      return;
    }
    const updateCountdown = () => {
      const { remainingSeconds } = getEmergencyCancelWindowState(
        emergency.created_at,
        3,
      );
      setCancelRemainingSeconds(remainingSeconds);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [emergency?.created_at]);

  const onCancelEmergency = () => {
    if (!emergencyId || typeof emergencyId !== "string" || !user?.id) return;

    showConfirm(
      "Cancel Emergency",
      "You can cancel only within 3 minutes from request creation. Continue?",
      async () => {
        const { success, error } = await cancelEmergencyWithinWindow(
          emergencyId,
          user.id,
          3,
        );
        if (!success) {
          showError(
            "Cancellation Failed",
            error?.message || "Unable to cancel emergency request.",
          );
          return;
        }

        showSuccess(
          "Emergency Cancelled",
          "Your request has been cancelled successfully.",
          () => router.replace("/help" as any),
        );
      },
    );
  };

  // ─── Status styling ───────────────────────────────────
  const statusMeta = (s: string) => {
    switch (s) {
      case "pending":
        return {
          color: "#F59E0B",
          bg: "#FEF3C7",
          icon: "hourglass-top" as const,
          label: "Finding Ambulance...",
        };
      case "assigned":
        return {
          color: "#0EA5E9",
          bg: "#E0F2FE",
          icon: "local-shipping" as const,
          label: "Ambulance Dispatched",
        };
      case "en_route":
        return {
          color: "#8B5CF6",
          bg: "#EDE9FE",
          icon: "local-hospital" as const,
          label: "Transporting to Hospital",
        };
      case "at_hospital":
        return {
          color: "#7C3AED",
          bg: "#EDE9FE",
          icon: "local-hospital" as const,
          label: "At Hospital",
        };
      case "completed":
        return {
          color: "#059669",
          bg: "#ECFDF5",
          icon: "check-circle" as const,
          label: "Completed",
        };
      case "cancelled":
        return {
          color: "#EF4444",
          bg: "#FEE2E2",
          icon: "cancel" as const,
          label: "Cancelled",
        };
      default:
        return {
          color: "#6B7280",
          bg: "#F3F4F6",
          icon: "info" as const,
          label: s,
        };
    }
  };

  const sevMeta = (t: string) => {
    switch (t?.toLowerCase()) {
      case "critical":
        return { color: "#DC2626", label: "Critical" };
      case "high":
        return { color: "#EA580C", label: "High" };
      case "medium":
        return { color: "#0284C7", label: "Medium" };
      case "low":
        return { color: "#059669", label: "Low" };
      default:
        return { color: "#6B7280", label: t || "Unknown" };
    }
  };

  // ─── Loading / Error ──────────────────────────────────
  if (loading)
    return (
      <LoadingModal
        visible
        colorScheme={colorScheme}
        message="Loading emergency..."
      />
    );

  if (error || !emergency) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.errWrap}>
          <MaterialIcons name="error-outline" size={48} color="#EF4444" />
          <ThemedText style={styles.errText}>
            {error || "Emergency not found"}
          </ThemedText>
          <Pressable onPress={() => router.back()} style={styles.errBtn}>
            <ThemedText style={styles.errBtnText}>Go Back</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Computed values ──────────────────────────────────
  const st = statusMeta(emergency.status);
  const sev = sevMeta(emergency.emergency_type);
  const fallbackPatientCoords = {
    latitude: Number(emergency.latitude || 0),
    longitude: Number(emergency.longitude || 0),
  };
  const patientCoords = patientLiveCoords ?? fallbackPatientCoords;
  const mapPatientCoords = patientCoords.latitude
    ? {
        latitude: Number(patientCoords.latitude.toFixed(4)),
        longitude: Number(patientCoords.longitude.toFixed(4)),
      }
    : null;
  const mapAmbulanceCoords = animatedAmbulanceCoords
    ? {
        latitude: Number(animatedAmbulanceCoords.latitude.toFixed(4)),
        longitude: Number(animatedAmbulanceCoords.longitude.toFixed(4)),
      }
    : null;

  let distanceText = "";
  if (animatedAmbulanceCoords && patientCoords.latitude && patientCoords.longitude) {
    const km = calculateDistance(
      patientCoords.latitude,
      patientCoords.longitude,
      animatedAmbulanceCoords.latitude,
      animatedAmbulanceCoords.longitude,
    );
    distanceText =
      km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }

  const hospitalCoords =
    hospitalStatus?.hospital_latitude != null &&
    hospitalStatus?.hospital_longitude != null
      ? {
          latitude: Number(hospitalStatus.hospital_latitude),
          longitude: Number(hospitalStatus.hospital_longitude),
        }
      : null;
  const isTransportPhase = ["transporting", "at_hospital"].includes(
    String(emergency.status || ""),
  );

  // Map route: ambulance -> patient by default, then ambulance -> hospital during transport.
  const mapHtml =
    mapAmbulanceCoords && mapPatientCoords
      ? isTransportPhase && hospitalCoords
        ? buildDriverPatientMapHtml(
            mapAmbulanceCoords.latitude,
            mapAmbulanceCoords.longitude,
            hospitalCoords.latitude,
            hospitalCoords.longitude,
            {
              blueLabel: "Ambulance",
              redLabel: "Hospital",
            },
          )
        : buildDriverPatientMapHtml(
            mapAmbulanceCoords.latitude,
            mapAmbulanceCoords.longitude,
            mapPatientCoords.latitude,
            mapPatientCoords.longitude,
            {
              blueLabel: "Ambulance",
              redLabel: "You",
              bluePopup: "🚑 Ambulance",
              redPopup: "📍 Your Location",
            },
          )
      : mapPatientCoords
        ? buildMapHtml(mapPatientCoords.latitude, mapPatientCoords.longitude, 17)
        : null;

  const openDetailedRoute = async () => {
    try {
      if (!animatedAmbulanceCoords) return;
      const origin = `${animatedAmbulanceCoords.latitude},${animatedAmbulanceCoords.longitude}`;
      const destination =
        isTransportPhase && hospitalCoords
          ? `${hospitalCoords.latitude},${hospitalCoords.longitude}`
          : `${patientCoords.latitude},${patientCoords.longitude}`;
      const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch {
      // silent fallback
    }
  };

  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const subtleText = colors.textMuted;
  const isCompleted =
    emergency.status === "completed" || emergency.status === "cancelled";
  const canCancelByWindow =
    cancelRemainingSeconds > 0 &&
    ["pending", "assigned"].includes(emergency.status);
  const statusGradientColors: [string, string] = isDark
    ? [st.color + "40", colors.background]
    : [st.color + "30", colors.surfaceMuted];
  const driverPhoneRaw =
    assignment?.driver_phone ??
    assignment?.driver_contact ??
    ambulance?.driver_phone ??
    ambulance?.phone_number ??
    ambulance?.phone;
  const driverPhone =
    typeof driverPhoneRaw === "string" ? driverPhoneRaw.trim() : "";
  const canCallDriver = !isCompleted && driverPhone.length > 0;

  // Status flow steps
  const statusSteps = [
    { key: "pending", label: "Requested", icon: "hourglass-top" as const },
    { key: "assigned", label: "Assigned", icon: "local-shipping" as const },
    { key: "en_route", label: "En Route", icon: "directions-car" as const },
    { key: "at_scene", label: "Arrived", icon: "place" as const },
    {
      key: "transporting",
      label: "Transport",
      icon: "local-hospital" as const,
    },
    { key: "completed", label: "Done", icon: "check-circle" as const },
  ];
  const currentStepIndex = statusSteps.findIndex(
    (s) => s.key === emergency.status,
  );
  const resolvedIndex =
    emergency.status === "at_hospital" ? 4 : currentStepIndex;

  // ─── Render ───────────────────────────────────────────
  return (
    <View
      style={[styles.root, { backgroundColor: isDark ? "#0F172A" : "#F1F5F9" }]}
    >
      <LinearGradient
        colors={
          isDark
            ? ["rgba(14,165,233,0.15)", "#020617", "transparent"]
            : ["rgba(14,165,233,0.2)", "#F8FAFC", "transparent"]
        }
        style={[styles.heroGlow, { pointerEvents: "none" }]}
      />
      {/* Floating notification toast */}
      {statusNotification && (
        <Animated.View
          style={[
            styles.notifToast,
            {
              backgroundColor: statusMeta(statusNotification).color,
              opacity: notifAnim,
              transform: [
                {
                  translateY: notifAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-40, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <MaterialIcons
            name={
              (STATUS_NOTIFICATIONS[statusNotification]?.icon as any) || "info"
            }
            size={22}
            color="#FFF"
          />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <ThemedText style={styles.notifTitle}>
              {STATUS_NOTIFICATIONS[statusNotification]?.title}
            </ThemedText>
            <ThemedText style={styles.notifMsg}>
              {STATUS_NOTIFICATIONS[statusNotification]?.message}
            </ThemedText>
          </View>
        </Animated.View>
      )}

      <View
        style={[
          styles.fixedTopNav,
          {
            top: Math.max(insets.top, 10),
            backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
            borderColor: isDark ? "#334155" : "#E2E8F0",
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.fixedNavBtn,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.10)"
                : "rgba(2,6,23,0.06)",
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons
            name="arrow-back"
            size={22}
            color={isDark ? "#E2E8F0" : "#334155"}
          />
        </Pressable>

        <ThemedText
          style={[
            styles.fixedNavTitle,
            { color: isDark ? "#F1F5F9" : "#0F172A" },
          ]}
          numberOfLines={1}
        >
          Emergency Status
        </ThemedText>

        <Pressable
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.fixedNavBtn,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.10)"
                : "rgba(2,6,23,0.06)",
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons
            name="refresh"
            size={22}
            color={isDark ? "#E2E8F0" : "#334155"}
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 16) + 88 },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Removed tag text for cleaner UI */}

        {/* ── Status Banner ─────────────────────────────── */}
        <LinearGradient
          colors={statusGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.statusBanner,
            styles.statusBannerElevated,
            { borderColor: st.color + "60" },
          ]}
        >
          <MaterialIcons name={st.icon} size={32} color={st.color} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <ThemedText style={[styles.statusLabel, { color: st.color }]}>
              {st.label}
            </ThemedText>
            <ThemedText style={[styles.statusSub, { color: st.color + "BB" }]}>
              {new Date(emergency.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {distanceText ? `  •  ${distanceText} away` : ""}
            </ThemedText>
          </View>
          <View style={[styles.sevChip, { borderColor: sev.color + "60" }]}>
            <ThemedText style={[styles.sevChipText, { color: sev.color }]}>
              {sev.label}
            </ThemedText>
          </View>
        </LinearGradient>

        {/* ── Progress Steps ────────────────────────────── */}
        <View
          style={[
            styles.stepsCard,
            styles.cardElevated,
            { backgroundColor: cardBg, borderColor: cardBorder },
          ]}
        >
          <View style={styles.stepsRow}>
            {statusSteps.map((step, i) => {
              const done = resolvedIndex >= i;
              const active = resolvedIndex === i;
              const col = done
                ? "#10B981"
                : active
                  ? st.color
                  : isDark
                    ? "#475569"
                    : "#CBD5E1";
              return (
                <View key={step.key} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepDot,
                      {
                        backgroundColor: done ? "#10B981" : "transparent",
                        borderColor: col,
                      },
                    ]}
                  >
                    {done ? (
                      <MaterialIcons name="check" size={12} color="#FFF" />
                    ) : (
                      <MaterialIcons name={step.icon} size={12} color={col} />
                    )}
                  </View>
                  <ThemedText
                    style={[
                      styles.stepLabel,
                      {
                        color: done
                          ? "#10B981"
                          : isDark
                            ? "#64748B"
                            : "#94A3B8",
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {step.label}
                  </ThemedText>
                  {i < statusSteps.length - 1 && (
                    <View
                      style={[
                        styles.stepLine,
                        {
                          backgroundColor:
                            resolvedIndex > i
                              ? "#10B981"
                              : isDark
                                ? "#334155"
                                : "#E2E8F0",
                        },
                      ]}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── MAP ───────────────────────────────────────── */}
        {mapHtml && (
          <View
            style={[
              styles.mapCard,
              styles.cardElevated,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.mapHeader}>
              <MaterialIcons name="map" size={18} color="#0EA5E9" />
              <ThemedText
                style={[
                  styles.mapTitle,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                {animatedAmbulanceCoords ? "Live Tracking" : "Your Location"}
              </ThemedText>
              {distanceText ? (
                <View style={styles.distBadge}>
                  <MaterialIcons
                    name="near-me"
                    size={12}
                    color="#FFF"
                    style={{ marginRight: 4 }}
                  />
                  <ThemedText style={styles.distText}>
                    {distanceText}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <HtmlMapView
              html={mapHtml}
              style={[styles.mapFrame, { height: isWide ? 450 : 300 }]}
              title="Emergency Map"
            />
            {/* Legend */}
            <View style={styles.mapLegend}>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: "#DC2626" }]}
                />
                <ThemedText style={[styles.legendText, { color: subtleText }]}>
                  {isTransportPhase && hospitalCoords ? "Hospital" : "You"}
                </ThemedText>
              </View>
              {animatedAmbulanceCoords && (
                <View style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: "#0EA5E9" }]}
                  />
                  <ThemedText
                    style={[styles.legendText, { color: subtleText }]}
                  >
                    Ambulance
                  </ThemedText>
                </View>
              )}
            </View>
            {animatedAmbulanceCoords && (
              <Pressable
                onPress={openDetailedRoute}
                style={({ pressed }) => [
                  {
                    marginHorizontal: 12,
                    marginBottom: 12,
                    marginTop: 4,
                    backgroundColor: "#0EA5E9",
                    borderRadius: 10,
                    paddingVertical: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                  },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <MaterialIcons name="alt-route" size={16} color="#FFF" />
                <ThemedText
                  style={{ color: "#FFF", fontWeight: "700", marginLeft: 8 }}
                >
                  Open Clear Route View
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Ambulance Info ────────────────────────────── */}
        {ambulance && (
          <View
            style={[
              styles.infoCard,
              styles.cardElevated,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: "#E0F2FE" }]}>
                <MaterialIcons
                  name="local-shipping"
                  size={20}
                  color="#0EA5E9"
                />
              </View>
              <ThemedText
                style={[
                  styles.cardHeading,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Assigned Ambulance
              </ThemedText>
              {!isCompleted && <View style={styles.activeDot} />}
            </View>

            <View style={styles.detailRow}>
              <View
                style={[
                  styles.detailIcon,
                  { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" },
                ]}
              >
                <MaterialIcons
                  name="directions-car"
                  size={16}
                  color="#0EA5E9"
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.detailLabel, { color: subtleText }]}>
                  Vehicle
                </ThemedText>
                <ThemedText
                  style={[
                    styles.detailValue,
                    { color: isDark ? "#F1F5F9" : "#0F172A" },
                  ]}
                >
                  {ambulance.vehicle_number}
                </ThemedText>
              </View>
            </View>

            {ambulance.type && (
              <View style={styles.detailRow}>
                <View
                  style={[
                    styles.detailIcon,
                    { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" },
                  ]}
                >
                  <MaterialIcons name="category" size={16} color="#0EA5E9" />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText
                    style={[styles.detailLabel, { color: subtleText }]}
                  >
                    Type
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.detailValue,
                      { color: isDark ? "#F1F5F9" : "#0F172A" },
                    ]}
                  >
                    {ambulance.type.charAt(0).toUpperCase() +
                      ambulance.type.slice(1)}
                  </ThemedText>
                </View>
              </View>
            )}

            {assignment?.pickup_eta_minutes && (
              <View style={[styles.etaBadge, { backgroundColor: "#E0F2FE" }]}>
                <MaterialIcons name="schedule" size={16} color="#0EA5E9" />
                <ThemedText style={styles.etaText}>
                  ETA: {assignment.pickup_eta_minutes} min
                </ThemedText>
              </View>
            )}
            {/* Call Ambulance button */}
            <View style={{ alignItems: "center", marginTop: 24 }}>
              <Pressable
                disabled={!canCallDriver}
                onPress={onCallDriver}
                style={{
                  marginBottom: 12,
                  backgroundColor: canCallDriver ? "#0EA5E9" : "#94A3B8",
                  borderRadius: 24,
                  paddingHorizontal: 32,
                  paddingVertical: 14,
                  elevation: 4,
                  flexDirection: "row",
                  alignItems: "center",
                  opacity: canCallDriver ? 1 : 0.85,
                }}
              >
                <MaterialIcons name="phone" size={22} color="#FFF" />
                <ThemedText
                  style={{
                    color: "#FFF",
                    fontWeight: "bold",
                    fontSize: 16,
                    marginLeft: 8,
                  }}
                >
                  {canCallDriver
                    ? "Call Ambulance"
                    : "Ambulance Phone Unavailable"}
                </ThemedText>
              </Pressable>

              <Pressable
                disabled={!canCancelByWindow}
                onPress={onCancelEmergency}
                style={{
                  marginBottom: 6,
                  backgroundColor: canCancelByWindow ? "#EF4444" : "#94A3B8",
                  borderRadius: 22,
                  paddingHorizontal: 22,
                  paddingVertical: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  opacity: canCancelByWindow ? 1 : 0.82,
                }}
              >
                <MaterialIcons name="cancel" size={18} color="#FFF" />
                <ThemedText
                  style={{
                    color: "#FFF",
                    fontWeight: "800",
                    fontSize: 14,
                    marginLeft: 7,
                  }}
                >
                  {canCancelByWindow
                    ? `Cancel Request (${Math.floor(cancelRemainingSeconds / 60)}:${String(cancelRemainingSeconds % 60).padStart(2, "0")})`
                    : [
                          "en_route",
                          "at_scene",
                          "arrived",
                          "transporting",
                          "at_hospital",
                        ].includes(emergency.status)
                      ? "Cancellation Closed (Ambulance Accepted)"
                      : "Cancellation Window Closed"}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Hospital Acceptance + ETA ─────────────────── */}
        {hospitalStatus && (
          <View
            style={[
              styles.infoCard,
              styles.cardElevated,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: "#EDE9FE" }]}>
                <MaterialIcons
                  name="local-hospital"
                  size={20}
                  color="#7C3AED"
                />
              </View>
              <ThemedText
                style={[
                  styles.cardHeading,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Destination Hospital
              </ThemedText>
            </View>

            <View style={styles.detailRow}>
              <View
                style={[
                  styles.detailIcon,
                  { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" },
                ]}
              >
                <MaterialIcons name="apartment" size={16} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.detailLabel, { color: subtleText }]}>
                  Hospital
                </ThemedText>
                <ThemedText
                  style={[
                    styles.detailValue,
                    { color: isDark ? "#F1F5F9" : "#0F172A" },
                  ]}
                >
                  {hospitalStatus.hospital_name || "Not assigned yet"}
                </ThemedText>
              </View>
            </View>

            <View style={styles.detailRow}>
              <View
                style={[
                  styles.detailIcon,
                  { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" },
                ]}
              >
                <MaterialIcons
                  name={
                    hospitalStatus.is_accepting_emergencies
                      ? "check-circle"
                      : "pause-circle-filled"
                  }
                  size={16}
                  color={
                    hospitalStatus.is_accepting_emergencies
                      ? "#10B981"
                      : "#F59E0B"
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.detailLabel, { color: subtleText }]}>
                  Acceptance
                </ThemedText>
                <ThemedText
                  style={[
                    styles.detailValue,
                    {
                      color: hospitalStatus.is_accepting_emergencies
                        ? "#10B981"
                        : "#F59E0B",
                    },
                  ]}
                >
                  {hospitalStatus.is_accepting_emergencies
                    ? "Accepting emergencies"
                    : "Temporarily not accepting"}
                </ThemedText>
              </View>
            </View>

            {(hospitalStatus.eta_to_hospital_minutes != null ||
              hospitalStatus.distance_to_hospital_km != null) && (
              <View style={[styles.etaBadge, { backgroundColor: "#EDE9FE" }]}>
                <MaterialIcons name="schedule" size={16} color="#7C3AED" />
                <ThemedText style={[styles.etaText, { color: "#7C3AED" }]}>
                  {hospitalStatus.eta_to_hospital_minutes != null
                    ? `ETA to hospital: ${hospitalStatus.eta_to_hospital_minutes} min`
                    : "ETA to hospital pending"}
                  {hospitalStatus.distance_to_hospital_km != null
                    ? ` • ${hospitalStatus.distance_to_hospital_km.toFixed(1)} km`
                    : ""}
                </ThemedText>
              </View>
            )}
          </View>
        )}

        {!isCompleted && (
          <View
            style={[
              styles.infoCard,
              styles.cardElevated,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={[styles.cardHeader, { marginBottom: 8 }]}>
              <View style={[styles.iconCircle, { backgroundColor: "#ECFEFF" }]}>
                <MaterialIcons name="share" size={20} color="#0891B2" />
              </View>
              <ThemedText
                style={[
                  styles.cardHeading,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Family Live Tracking
              </ThemedText>
            </View>
            <ThemedText
              style={[
                styles.legendText,
                { color: subtleText, marginBottom: 10 },
              ]}
            >
              Share a secure live tracking link with family or guardians.
            </ThemedText>
            <Pressable
              onPress={onShareLiveTracking}
              disabled={sharingLink}
              style={{
                backgroundColor: sharingLink ? "#94A3B8" : "#0891B2",
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
              }}
            >
              <MaterialIcons name="share" size={18} color="#FFF" />
              <ThemedText
                style={{ color: "#FFF", fontWeight: "700", marginLeft: 8 }}
              >
                {sharingLink
                  ? "Preparing Share Link..."
                  : Platform.OS === "web"
                    ? "Copy Share Link"
                    : "Share to Any App"}
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* ...existing code... */}

        {/* Go Home if completed */}
        {isCompleted && (
          <Pressable
            onPress={() => router.replace("/help" as any)}
            style={({ pressed }) => [
              styles.homeBtn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <MaterialIcons name="home" size={20} color="#FFF" />
            <ThemedText style={styles.homeBtnText}>Return Home</ThemedText>
          </Pressable>
        )}
      </ScrollView>

      <View
        style={[styles.fabDock, { bottom: Math.max(insets.bottom, 12) + 8 }]}
      >
        <FirstAidFab />
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  fixedTopNav: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 30,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...(Platform.select({
      web: { boxShadow: "0px 2px 8px rgba(0,0,0,0.16)" as any },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 8,
      },
    }) as object),
    elevation: 7,
  },
  fixedNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  fixedNavTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  root: { flex: 1, overflow: "hidden" },
  heroGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 260,
    zIndex: 0,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    alignSelf: "center" as any,
    width: "100%" as any,
  },

  // Notification toast
  notifToast: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    ...(Platform.select({
      web: { boxShadow: "0px 6px 12px rgba(0,0,0,0.35)" as any },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
    }) as object),
    elevation: 12,
    maxWidth: 600,
    alignSelf: "center" as any,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
  },
  notifTitle: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  notifMsg: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  tagText: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Fonts.sans,
  },

  // Error
  errWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: 32,
  },
  errText: {
    fontSize: 16,
    fontFamily: Fonts.sans,
    color: "#EF4444",
    textAlign: "center",
  },
  errBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
  },
  errBtnText: { color: "#FFF", fontWeight: "700", fontFamily: Fonts.sans },

  // Status banner
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  statusBannerElevated: {
    ...(Platform.select({
      web: { boxShadow: "0px 8px 17px rgba(0,0,0,0.25)" as any },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 17,
      },
    }) as object),
    elevation: 10,
  },
  statusLabel: { fontSize: 17, fontWeight: "800", fontFamily: Fonts.sans },
  statusSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
  sevChip: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sevChipText: { fontSize: 11, fontWeight: "700", fontFamily: Fonts.sans },

  // Steps
  stepsCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  stepsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  stepItem: {
    alignItems: "center",
    flex: 1,
    position: "relative" as any,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  stepLine: {
    position: "absolute",
    top: 11,
    left: "62%" as any,
    right: "-38%" as any,
    height: 2,
    zIndex: -1,
  },
  cardElevated: {
    ...(Platform.select({
      web: { boxShadow: "0px 10px 18px rgba(0,0,0,0.2)" as any },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 18,
      },
    }) as object),
    elevation: 10,
  },

  // Map card
  mapCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
  },
  mapHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    paddingBottom: 0,
  },
  mapTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    marginLeft: 8,
    flex: 1,
  },
  distBadge: {
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  distText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  mapFrame: {
    width: "100%" as any,
    height: 300,
    marginTop: 10,
    paddingHorizontal: 12,
  },
  mapLegend: {
    flexDirection: "row",
    gap: 16,
    padding: 10,
    paddingTop: 6,
    justifyContent: "center",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontFamily: Fonts.sans },

  // Info card
  infoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    marginLeft: 10,
    flex: 1,
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#10B981",
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailValue: { fontSize: 14, fontWeight: "600", fontFamily: Fonts.sans },

  etaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  etaText: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#0EA5E9",
  },

  descBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  descText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    marginLeft: 8,
    flex: 1,
    lineHeight: 20,
  },

  // Actions
  actionsContainer: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    marginTop: 8,
    marginBottom: 20,
    ...(Platform.select({
      web: { boxShadow: "0px 12px 16px rgba(0,0,0,0.18)" as any },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
      },
    }) as object),
    elevation: 10,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  actionLabel: { fontSize: 12, fontWeight: "600", fontFamily: Fonts.sans },

  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#10B981",
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  homeBtnText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  fabDock: {
    position: "absolute",
    right: 14,
    zIndex: 40,
  },
});
