import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
    Animated,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "@/components/app-button";
import { useAppState } from "@/components/app-state";
import { FirstAidFab } from "@/components/first-aid-fab";
import { HtmlMapView } from "@/components/html-map-view";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    buildMapHtml,
    buildPatientRequestMapHtml,
    calculateDistance,
    getExplainableTriage,
    getLiveAvailableAmbulances,
    getTrafficAwareDispatch,
    parsePostGISPoint
} from "@/utils/emergency";
import {
    cancelEmergencyWithinWindow,
    createEmergency,
    getActiveEmergency,
    getEmergencyCancelWindowState,
    retryEmergencyDispatch,
    subscribeToEmergency,
} from "@/utils/patient";
import { supabase } from "@/utils/supabase";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function PatientEmergencyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    forOther?: string;
    lat?: string;
    lng?: string;
  }>();
  const isForOther = params.forOther === "true";
  const initialLat = Number(params.lat);
  const initialLng = Number(params.lng);
  const hasInitialLocation =
    Number.isFinite(initialLat) && Number.isFinite(initialLng);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const { user } = useAppState();
  const { showAlert, showError, showSuccess, showConfirm } = useModal();
  const insets = useSafeAreaInsets();

  const [hasActiveEmergency, setHasActiveEmergency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(
    hasInitialLocation ? { latitude: initialLat, longitude: initialLng } : null,
  );
  const [mapLocation, setMapLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(
    hasInitialLocation ? { latitude: initialLat, longitude: initialLng } : null,
  );
  const [severity, setSeverity] = useState<
    "low" | "medium" | "high" | "critical"
  >("medium");
  const [description, setDescription] = useState("");
  const [patientCondition, setPatientCondition] = useState("");
  const [otherPersonName, setOtherPersonName] = useState("");
  const [otherPersonContact, setOtherPersonContact] = useState("");
  const [activeEmergencyId, setActiveEmergencyId] = useState<string | null>(
    null,
  );
  const [activeEmergencyStatus, setActiveEmergencyStatus] = useState<
    string | null
  >(null);
  const [activeEmergencyCreatedAt, setActiveEmergencyCreatedAt] = useState<
    string | null
  >(null);
  const [cancelRemainingSeconds, setCancelRemainingSeconds] = useState(0);
  const [nearbyAmbulances, setNearbyAmbulances] = useState<
    {
      lat: number;
      lng: number;
      label: string;
      distance: string;
      distanceKm: number;
    }[]
  >([]);
  const [smartPreview, setSmartPreview] = useState<string>(
    "Tap to preview smart dispatch guidance.",
  );
  const [triagePreview, setTriagePreview] = useState<{
    priority: string;
    score: number;
    recommendation: string;
  } | null>(null);
  const [dispatchPreview, setDispatchPreview] = useState<{
    etaMinutes: number | null;
    distanceKm: number | null;
  } | null>(null);
  const [firstAidTips, setFirstAidTips] = useState<string[]>([]);
  const [fallbackAssigning, setFallbackAssigning] = useState(false);
  const [tipsLoading, setTipsLoading] = useState(false);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const recentLocationFixesRef = useRef<
    Array<{ latitude: number; longitude: number }>
  >([]);

  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const canCancelByWindow =
    cancelRemainingSeconds > 0 &&
    ["pending", "assigned"].includes(activeEmergencyStatus || "pending");

  const hasNearbyAmbulance = nearbyAmbulances.length > 0;
  const lastDispatchRetry = React.useRef<number>(0);
  const lastFallbackAssign = React.useRef<number>(0);
  const fetchingNearbyRef = React.useRef(false);
  const lastNearbyFetchRef = useRef<{
    latitude: number;
    longitude: number;
    at: number;
  } | null>(null);
  const lastMapUpdateRef = useRef<{
    latitude: number;
    longitude: number;
    at: number;
  } | null>(null);

  useEffect(() => {
    checkActiveEmergency();
    requestLocationPermission();
    loadNearbyAmbulances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reload ambulances when location changes
  useEffect(() => {
    if (!location) return;
    const prev = lastNearbyFetchRef.current;
    const now = Date.now();
    if (prev) {
      const movedMeters =
        calculateDistance(
          prev.latitude,
          prev.longitude,
          location.latitude,
          location.longitude,
        ) * 1000;
      const elapsed = now - prev.at;
      // Ignore tiny location drift so map and list don't keep reloading.
      if (movedMeters < 20 && elapsed < 20000) return;
    }
    lastNearbyFetchRef.current = {
      latitude: location.latitude,
      longitude: location.longitude,
      at: now,
    };
    loadNearbyAmbulances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.latitude, location?.longitude]);

  // Keep map stable: update map center only on meaningful movement or elapsed time.
  useEffect(() => {
    if (!location) return;
    const now = Date.now();
    const prev = lastMapUpdateRef.current;
    if (prev) {
      const movedMeters =
        calculateDistance(
          prev.latitude,
          prev.longitude,
          location.latitude,
          location.longitude,
        ) * 1000;
      const elapsed = now - prev.at;
      if (movedMeters < 25 && elapsed < 30000) return;
    }

    const stable = {
      latitude: Number(location.latitude.toFixed(5)),
      longitude: Number(location.longitude.toFixed(5)),
    };
    lastMapUpdateRef.current = { ...stable, at: now };
    setMapLocation(stable);
  }, [location?.latitude, location?.longitude]);

  // Auto-refresh ambulance count every 30s.
  useEffect(() => {
    const interval = setInterval(() => {
      loadNearbyAmbulances();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.latitude, location?.longitude]);

  // Realtime: refresh only when availability status actually changes.
  useEffect(() => {
    const channel = supabase
      .channel("ambulance-availability")
      .on(
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "ambulances" },
        (payload: any) => {
          const prevAvail = Boolean(payload?.old?.is_available);
          const nextAvail = Boolean(payload?.new?.is_available);
          if (prevAvail === nextAvail) return;
          loadNearbyAmbulances();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.latitude, location?.longitude]);

  const MAX_AMBULANCE_DISTANCE_KM = 50; // Only show ambulances within 50km
  const handleSmartPreview = async () => {
    if (!location) {
      showError("Location Required", "Enable location to run smart preview.");
      return;
    }
    try {
      const [triage, dispatch] = await Promise.all([
        getExplainableTriage({ severity }),
        getTrafficAwareDispatch({
          latitude: location.latitude,
          longitude: location.longitude,
          maxRadiusKm: 60,
          trafficLevel: "moderate",
        }),
      ]);

      const priority = String((triage as any)?.priority || "P3");
      const eta = (dispatch as any)?.eta_minutes;
      const distance = (dispatch as any)?.distance_km;
      setSmartPreview(
        `Priority ${priority}` +
          (typeof eta === "number" ? ` • ETA ${eta} min` : "") +
          (typeof distance === "number" ? ` • ${distance.toFixed(1)} km` : ""),
      );
    } catch (err) {
      console.warn("Smart preview error:", err);
      setSmartPreview("Smart preview currently unavailable.");
    }
  };

  const loadNearbyAmbulances = async () => {
    if (fetchingNearbyRef.current) return;
    fetchingNearbyRef.current = true;
    try {
      const { ambulances: data } = await getLiveAvailableAmbulances(10);
      if (!data) {
        // Keep previous list on transient fetch failures.
        return;
      }
      const parsedAll = data
        .map((a: any) => {
          const loc = parsePostGISPoint(a.last_known_location);
          if (!loc) return null;
          const dist = location
            ? calculateDistance(
                location.latitude,
                location.longitude,
                loc.latitude,
                loc.longitude,
              )
            : null;
          return {
            lat: loc.latitude,
            lng: loc.longitude,
            label: a.registration_number || "Ambulance",
            distance:
              dist !== null
                ? dist < 1
                  ? `${Math.round(dist * 1000)}m`
                  : `${dist.toFixed(1)}km`
                : "",
            distanceRaw: dist ?? 999,
            distanceKm: dist ?? 999,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.distanceRaw - b.distanceRaw);

      const inRange = (parsedAll as any[]).filter(
        (a: any) => a.distanceKm <= MAX_AMBULANCE_DISTANCE_KM,
      );

      const finalList = inRange.length > 0 ? inRange : (parsedAll as any[]);
      // Show up to 3 nearest ambulances and avoid unnecessary state churn.
      const nextList = finalList.slice(0, 3) as Array<{
        lat: number;
        lng: number;
        label: string;
        distance: string;
        distanceKm: number;
      }>;

      setNearbyAmbulances((prev) => {
        if (prev.length !== nextList.length) return nextList;
        for (let i = 0; i < prev.length; i += 1) {
          const a = prev[i];
          const b = nextList[i];
          if (!b) return nextList;
          const movedMeters =
            calculateDistance(a.lat, a.lng, b.lat, b.lng) * 1000;
          if (movedMeters > 12 || a.label !== b.label) {
            return nextList;
          }
        }
        return prev;
      });
    } catch (err) {
      console.error("Error loading ambulances:", err);
    } finally {
      fetchingNearbyRef.current = false;
    }
  };

  // Subscribe to emergency status changes -> notify patient & auto-navigate
  useEffect(() => {
    if (!activeEmergencyId) return;
    const unsub = subscribeToEmergency(activeEmergencyId, (updated) => {
      const status = updated?.status;
      setActiveEmergencyStatus(status ?? null);
      if (status === "en_route" || status === "assigned") {
        // Ambulance accepted -> auto-navigate to tracking (no popup)
        router.push(
          `/patient-emergency-tracking?emergencyId=${activeEmergencyId}`,
        );
      } else if (status === "cancelled") {
        // Ambulance declined / emergency cancelled
        const msg = "Your emergency request was declined. Please try again.";
        showAlert("Emergency Update", msg);
        setHasActiveEmergency(false);
        setActiveEmergencyId(null);
        setActiveEmergencyCreatedAt(null);
        setActiveEmergencyStatus(null);
      } else if (status === "completed") {
        setHasActiveEmergency(false);
        setActiveEmergencyId(null);
        setActiveEmergencyCreatedAt(null);
        setActiveEmergencyStatus(null);
      } else {
        const prettyStatus = String(status || "pending")
          .replaceAll("_", " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        showAlert("Live Status Update", `Emergency status: ${prettyStatus}`);
      }
    });
    return unsub;
  }, [activeEmergencyId, router, showAlert]);

  const checkActiveEmergency = async () => {
    if (!user?.id) return;
    const { emergency } = await getActiveEmergency(user.id);
    if (emergency) {
      setHasActiveEmergency(true);
      setActiveEmergencyId(emergency.id);
      setActiveEmergencyCreatedAt(emergency.created_at || null);
      setActiveEmergencyStatus(emergency.status || "pending");
    } else {
      setHasActiveEmergency(false);
      setActiveEmergencyId(null);
      setActiveEmergencyCreatedAt(null);
      setActiveEmergencyStatus(null);
    }
  };

  useEffect(() => {
    if (!activeEmergencyCreatedAt) {
      setCancelRemainingSeconds(0);
      return;
    }

    const refreshWindow = () => {
      const { remainingSeconds } = getEmergencyCancelWindowState(
        activeEmergencyCreatedAt,
        3,
      );
      setCancelRemainingSeconds(remainingSeconds);
    };

    refreshWindow();
    const timer = setInterval(refreshWindow, 1000);
    return () => clearInterval(timer);
  }, [activeEmergencyCreatedAt]);

  const requestLocationPermission = async () => {
    try {
      const currentPermission = await Location.getForegroundPermissionsAsync();
      if (currentPermission.status !== "granted") {
        if (location) return;
        const msg =
          "Location permission is required to request emergency services";
        showError("Permission Denied", msg);
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const accuracy = currentLocation.coords.accuracy ?? 999;
      if (accuracy > 120) {
        return;
      }

      const nextFix = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      };

      recentLocationFixesRef.current = [
        ...recentLocationFixesRef.current,
        nextFix,
      ].slice(-3);

      const count = recentLocationFixesRef.current.length;
      const smoothed = recentLocationFixesRef.current.reduce(
        (acc, item) => ({
          latitude: acc.latitude + item.latitude / count,
          longitude: acc.longitude + item.longitude / count,
        }),
        { latitude: 0, longitude: 0 },
      );

      setLocation(smoothed);
    } catch (error) {
      console.error("Error getting location:", error);
      const msg =
        "Could not get your location. Please enable location services.";
      showError("Location Error", msg);
    }
  };

  useEffect(() => {
    const startLivePatientTracking = async () => {
      try {
        const currentPermission =
          await Location.getForegroundPermissionsAsync();
        if (currentPermission.status !== "granted") return;

        const watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (loc) => {
            const accuracy = loc.coords.accuracy ?? 999;
            if (accuracy > 120) return;

            const nextFix = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };

            recentLocationFixesRef.current = [
              ...recentLocationFixesRef.current,
              nextFix,
            ].slice(-3);
            const count = recentLocationFixesRef.current.length;
            const smoothed = recentLocationFixesRef.current.reduce(
              (acc, item) => ({
                latitude: acc.latitude + item.latitude / count,
                longitude: acc.longitude + item.longitude / count,
              }),
              { latitude: 0, longitude: 0 },
            );

            setLocation((prev) => {
              if (!prev) return smoothed;
              const movedMeters =
                calculateDistance(
                  prev.latitude,
                  prev.longitude,
                  smoothed.latitude,
                  smoothed.longitude,
                ) * 1000;
              if (movedMeters < 4) return prev;
              return smoothed;
            });
          },
        );

        locationWatchRef.current = watcher;
      } catch {
        // Keep fallback behavior if live tracking is unavailable.
      }
    };

    void startLivePatientTracking();
    return () => {
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
        locationWatchRef.current = null;
      }
    };
  }, []);

  const handleSOS = async () => {
    if (!user?.id) {
      showError(
        "Authentication Required",
        "You must be logged in to call an ambulance",
      );
      return;
    }

    if (!location) {
      showError(
        "Location Required",
        "Location not available. Please enable location services.",
      );
      return;
    }

    const confirmMsg = `Severity: ${severity}${isForOther && otherPersonName ? `\nFor: ${otherPersonName}` : ""}\n\nAre you sure you want to request emergency ambulance service?`;

    showConfirm("Confirm Emergency Call", confirmMsg, () =>
      createEmergencyRequest(),
    );
  };

  const attemptDispatchRetry = async () => {
    if (!activeEmergencyId) return;
    if (activeEmergencyStatus !== "pending") return;
    if (!hasNearbyAmbulance) return;

    const now = Date.now();
    if (now - lastDispatchRetry.current < 10000) return; // throttle retries to 10s
    lastDispatchRetry.current = now;

    try {
      const { success, emergency } = await retryEmergencyDispatch(
        activeEmergencyId,
        80,
      );
      if (success && emergency) {
        setActiveEmergencyStatus(emergency.status);
        setActiveEmergencyCreatedAt(emergency.created_at || null);
        setActiveEmergencyId(emergency.id);
        if (emergency.status === "assigned") {
          showAlert(
            "Ambulance Assigned",
            "A nearby ambulance has been auto-assigned. Tracking will open now.",
          );
          router.push(
            `/patient-emergency-tracking?emergencyId=${emergency.id}`,
          );
        }
      }
    } catch (err) {
      console.warn("Dispatch retry failed", err);
      await attemptFallbackAssign();
    }
  };

  const attemptFallbackAssign = async () => {
    if (!activeEmergencyId || !location) return;
    if (activeEmergencyStatus !== "pending") return;
    const now = Date.now();
    if (now - lastFallbackAssign.current < 12000) return; // throttle 12s
    lastFallbackAssign.current = now;

    setFallbackAssigning(true);
    try {
      const { success, emergency } = await retryEmergencyDispatch(
        activeEmergencyId,
        80,
      );
      if (success && emergency?.assigned_ambulance_id) {
        setActiveEmergencyStatus("assigned");
        showAlert(
          "Ambulance Assigned",
          "Fallback assignment succeeded. A nearby ambulance is on the way.",
        );
        router.push(
          `/patient-emergency-tracking?emergencyId=${activeEmergencyId}`,
        );
      }
    } catch (err) {
      console.warn("Fallback assign failed", err);
    } finally {
      setFallbackAssigning(false);
    }
  };

  const createEmergencyRequest = async () => {
    if (!user?.id || !location) return;

    setLoading(true);
    try {
      // Combine description + condition into a single description field
      const parts = [
        isForOther && otherPersonName
          ? `Reported for: ${otherPersonName}`
          : null,
        isForOther && otherPersonContact
          ? `Contact: ${otherPersonContact}`
          : null,
        description || null,
        patientCondition ? `Condition: ${patientCondition}` : null,
      ].filter(Boolean);
      const fullDescription = parts.length > 0 ? parts.join(" - ") : undefined;

      const { emergency, error } = await createEmergency(
        user.id,
        location.latitude,
        location.longitude,
        severity, // stored as emergency_type in DB
        fullDescription,
      );

      if (error || !emergency) {
        const msg = `Failed to create emergency: ${error?.message}`;
        showError("Emergency Request Failed", msg);
        return;
      }

      setHasActiveEmergency(true);
      setActiveEmergencyId(emergency.id);
      setActiveEmergencyCreatedAt(
        emergency.created_at || new Date().toISOString(),
      );
      setActiveEmergencyStatus(emergency.status || "pending");

      // Clear form
      setDescription("");
      setPatientCondition("");
      setOtherPersonName("");
      setOtherPersonContact("");

      // Navigate immediately to tracking without bulky popup.
      router.push(`/patient-emergency-tracking?emergencyId=${emergency.id}`);
    } catch (error) {
      console.error("Error creating emergency:", error);
      const errMsg = `Failed to request emergency services: ${error}`;
      showError("Request Failed", errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handlePulseAnimation = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleCancelEmergency = () => {
    if (!user?.id || !activeEmergencyId) return;

    showConfirm(
      "Cancel Emergency",
      "You can cancel only within 3 minutes from request creation. Do you want to cancel now?",
      async () => {
        setLoading(true);
        try {
          const { success, error } = await cancelEmergencyWithinWindow(
            activeEmergencyId,
            user.id,
            3,
          );

          if (!success) {
            showError(
              "Cancellation Failed",
              error?.message || "Unable to cancel this emergency request.",
            );
            return;
          }

          setHasActiveEmergency(false);
          setActiveEmergencyId(null);
          setActiveEmergencyCreatedAt(null);
          setActiveEmergencyStatus(null);
          showSuccess(
            "Emergency Cancelled",
            "Your emergency request has been cancelled successfully.",
          );
        } finally {
          setLoading(false);
        }
      },
    );
  };

  const SeverityButton = ({
    level,
    label,
    color,
  }: {
    level: "low" | "medium" | "high" | "critical";
    label: string;
    color: string;
  }) => {
    const isSelected = severity === level;
    return (
      <Pressable
        onPress={() => !hasActiveEmergency && setSeverity(level)}
        disabled={hasActiveEmergency}
        style={({ pressed }) => [
          styles.severityButton,
          isSelected
            ? {
                backgroundColor: color,
                borderColor: color,
              }
            : {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
          pressed && { opacity: 0.8 },
          hasActiveEmergency && { opacity: 0.5 },
        ]}
      >
        <ThemedText
          style={[
            styles.severityLabel,
            isSelected && { color: "#FFFFFF", fontWeight: "700" },
          ]}
        >
          {label}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Math.max(insets.top, 16) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ThemedView
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {/* Status Badge with Refresh + X buttons */}
          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusBadge,
                hasActiveEmergency ? styles.activeBadge : styles.inactiveBadge,
              ]}
            >
              <MaterialIcons
                name={
                  hasActiveEmergency ? "check-circle" : "radio-button-unchecked"
                }
                size={16}
                color={hasActiveEmergency ? "#10B981" : "#94A3B8"}
              />
              <ThemedText
                style={[
                  styles.statusText,
                  hasActiveEmergency && { color: "#10B981", fontWeight: "700" },
                  { flex: 1 },
                ]}
              >
                {hasActiveEmergency
                  ? "Emergency Active"
                  : "No Active Emergency"}
              </ThemedText>
              {/* Refresh button */}
              <Pressable
                onPress={() => {
                  loadNearbyAmbulances();
                  checkActiveEmergency();
                }}
                style={({ pressed }) => [
                  styles.statusActionBtn,
                  {
                    backgroundColor: isDark
                      ? "rgba(14,165,233,0.18)"
                      : "rgba(14,165,233,0.10)",
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <MaterialIcons name="refresh" size={16} color="#0EA5E9" />
              </Pressable>
              {/* X close button */}
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.statusActionBtn,
                  { backgroundColor: colors.surfaceAlt },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <MaterialIcons name="close" size={16} color={colors.text} />
              </Pressable>
            </View>
          </View>

          {hasActiveEmergency ? (
            // Active Emergency View
            <>
              <ThemedText style={styles.title}>Active Emergency</ThemedText>
              <ThemedText style={styles.subtitle}>
                Your emergency request is in progress
              </ThemedText>

              <View style={styles.liveStatusRow}>
                <MaterialIcons name="sync" size={14} color="#0EA5E9" />
                <ThemedText style={styles.liveStatusLabel}>
                  Live Status:
                </ThemedText>
                <ThemedText style={styles.liveStatusValue}>
                  {String(activeEmergencyStatus || "pending")
                    .replaceAll("_", " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
                </ThemedText>
              </View>

              <View style={styles.infoCard}>
                <MaterialIcons name="info" size={20} color="#0EA5E9" />
                <ThemedText style={styles.infoText}>
                  A dispatcher has received your call and is locating the
                  nearest ambulance.
                </ThemedText>
              </View>

              <AppButton
                label="View Status"
                onPress={() =>
                  router.push(
                    `/patient-emergency-tracking?emergencyId=${activeEmergencyId}`,
                  )
                }
                variant="primary"
                fullWidth
              />

              <AppButton
                label="Call Dispatcher"
                onPress={() =>
                  showAlert("Dispatcher", "Calling dispatch center...")
                }
                variant="secondary"
                fullWidth
                style={styles.secondaryBtn}
              />

              <AppButton
                label={
                  canCancelByWindow
                    ? `Cancel Request (${Math.floor(cancelRemainingSeconds / 60)}:${String(cancelRemainingSeconds % 60).padStart(2, "0")})`
                    : [
                          "en_route",
                          "at_scene",
                          "arrived",
                          "transporting",
                          "at_hospital",
                        ].includes(String(activeEmergencyStatus || ""))
                      ? "Cancellation Closed (Ambulance Accepted)"
                      : "Cancellation Window Closed"
                }
                onPress={handleCancelEmergency}
                variant="ghost"
                disabled={!canCancelByWindow || loading}
                fullWidth
                style={[
                  styles.secondaryBtn,
                  {
                    borderColor: "#EF4444",
                    backgroundColor: canCancelByWindow
                      ? "rgba(239,68,68,0.08)"
                      : "rgba(148,163,184,0.08)",
                  },
                ]}
              />
            </>
          ) : (
            // No Emergency View
            <>
              {/* Map: Your location + nearby ambulances */}
              {mapLocation && (
                <View
                  style={[styles.mapSection, { borderColor: colors.border }]}
                >
                  {(() => {
                    const mapHtml =
                      nearbyAmbulances.length > 0
                        ? buildPatientRequestMapHtml(
                            mapLocation.latitude,
                            mapLocation.longitude,
                            nearbyAmbulances,
                          )
                        : buildMapHtml(
                            mapLocation.latitude,
                            mapLocation.longitude,
                            17,
                          );
                    return (
                      <HtmlMapView
                        html={mapHtml}
                        style={styles.mapBox}
                        title="Your Location"
                      />
                    );
                  })()}

                  {/* Nearby ambulances list */}
                  <View style={styles.nearbyList}>
                    <View style={styles.nearbyHeader}>
                      <MaterialIcons
                        name="local-shipping"
                        size={16}
                        color="#0EA5E9"
                      />
                      <ThemedText
                        style={[styles.nearbyTitle, { color: colors.text }]}
                      >
                        {nearbyAmbulances.length > 0
                          ? "Nearest live ambulance"
                          : "Searching for nearby live ambulances..."}
                      </ThemedText>
                    </View>

                    {!hasNearbyAmbulance ? (
                      <View style={[styles.section, { alignItems: "center" }]}>
                        <ThemedText style={styles.sectionTitle}>
                          No ambulances are nearby right now
                        </ThemedText>
                        <ThemedText
                          style={[styles.nearbyEmpty, { color: colors.text }]}
                        >
                          We cannot take a request until a unit comes online
                          within range. Try again shortly or chat with first
                          aid.
                        </ThemedText>
                        <View style={{ marginTop: 18 }}>
                          <FirstAidFab
                            triggerMode="tag"
                            triggerLabel="Ask Chatbot"
                          />
                        </View>
                      </View>
                    ) : (
                      <>
                        {/* Other person details */}
                        {isForOther && (
                          <View style={styles.section}>
                            <ThemedText style={styles.sectionTitle}>
                              Person in Need
                            </ThemedText>

                            <ThemedText style={styles.label}>Name</ThemedText>
                            <TextInput
                              style={[
                                styles.input,
                                isDark ? styles.inputDark : null,
                              ]}
                              placeholder="Name of the person who needs help"
                              placeholderTextColor={
                                isDark ? "#6B7280" : "#94A3B8"
                              }
                              value={otherPersonName}
                              onChangeText={setOtherPersonName}
                            />

                            <ThemedText style={styles.label}>
                              Contact Number (optional)
                            </ThemedText>
                            <TextInput
                              style={[
                                styles.input,
                                isDark ? styles.inputDark : null,
                              ]}
                              placeholder="Their phone number"
                              placeholderTextColor={
                                isDark ? "#6B7280" : "#94A3B8"
                              }
                              value={otherPersonContact}
                              onChangeText={setOtherPersonContact}
                              keyboardType="phone-pad"
                            />
                          </View>
                        )}

                        {/* Severity Selection */}
                        <View style={styles.section}>
                          <ThemedText style={styles.sectionTitle}>
                            Emergency Severity
                          </ThemedText>
                          <View style={styles.severityGrid}>
                            <SeverityButton
                              level="low"
                              label="Low"
                              color="#3B82F6"
                            />
                            <SeverityButton
                              level="medium"
                              label="Medium"
                              color="#F59E0B"
                            />
                            <SeverityButton
                              level="high"
                              label="High"
                              color="#EF4444"
                            />
                            <SeverityButton
                              level="critical"
                              label="Critical"
                              color="#DC2626"
                            />
                          </View>
                        </View>

                        {/* Description */}
                        <View style={styles.section}>
                          <ThemedText style={styles.sectionTitle}>
                            Emergency Details
                          </ThemedText>

                          <ThemedText style={styles.label}>
                            Description (optional)
                          </ThemedText>
                          <TextInput
                            style={[
                              styles.input,
                              isDark ? styles.inputDark : null,
                            ]}
                            placeholder={
                              isForOther
                                ? "Describe what happened..."
                                : "Describe your emergency..."
                            }
                            placeholderTextColor={
                              isDark ? "#6B7280" : "#94A3B8"
                            }
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            numberOfLines={3}
                          />

                          <ThemedText style={styles.label}>
                            {isForOther
                              ? "Their Condition (optional)"
                              : "Your Condition (optional)"}
                          </ThemedText>
                          <TextInput
                            style={[
                              styles.input,
                              isDark ? styles.inputDark : null,
                            ]}
                            placeholder={
                              isForOther
                                ? "Describe their current condition..."
                                : "Describe your current condition..."
                            }
                            placeholderTextColor={
                              isDark ? "#6B7280" : "#94A3B8"
                            }
                            value={patientCondition}
                            onChangeText={setPatientCondition}
                            multiline
                            numberOfLines={3}
                          />
                        </View>

                        {/* SOS Button */}
                        <Animated.View
                          style={[
                            styles.sosButtonContainer,
                            { transform: [{ scale: scaleAnim }] },
                          ]}
                        >
                          <Pressable
                            onPress={() => {
                              handlePulseAnimation();
                              handleSOS();
                            }}
                            disabled={loading}
                            style={({ pressed }) => [
                              styles.sosButton,
                              pressed && { opacity: 0.9 },
                              loading && { opacity: 0.6 },
                            ]}
                          >
                            <MaterialIcons
                              name="phone"
                              size={32}
                              color="white"
                            />
                            <ThemedText style={styles.sosButtonText}>
                              {isForOther
                                ? "SOS - Call Ambulance for Them"
                                : "SOS - Call Ambulance"}
                            </ThemedText>
                          </Pressable>
                        </Animated.View>
                      </>
                    )}
                  </View>
                </View>
              )}
            </>
          )}
        </ThemedView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
  },
  statusActionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  scroll: {
    flexGrow: 1,
    padding: 18,
    paddingBottom: 40,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#EEF2F6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  statusContainer: {
    marginBottom: 20,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 10,
  },
  activeBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderColor: "#10B981",
  },
  inactiveBadge: {
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    borderColor: "#94A3B8",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    color: "#94A3B8",
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748B",
    fontFamily: Fonts.sans,
    fontWeight: "500",
    marginBottom: 20,
    lineHeight: 20,
  },
  infoCard: {
    flexDirection: "row",
    backgroundColor: "rgba(14, 165, 233, 0.1)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 12,
    alignItems: "flex-start",
  },
  infoText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    color: "#0284C7",
    flex: 1,
    lineHeight: 18,
  },
  liveStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(14,165,233,0.10)",
    borderWidth: 1,
    borderColor: "rgba(14,165,233,0.24)",
  },
  liveStatusLabel: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#0369A1",
  },
  liveStatusValue: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#0F172A",
  },
  section: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F6",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  severityGrid: {
    flexDirection: "row",
    gap: 10,
  },
  severityButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  severityLabel: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    color: "#64748B",
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E6ECF2",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    fontSize: 15,
    color: "#11181C",
    fontFamily: Fonts.sans,
    fontWeight: "500",
  },
  inputDark: {
    backgroundColor: "#0B1220",
    borderColor: "#2E3236",
    color: "#ECEDEE",
  },
  sosButtonContainer: {
    marginVertical: 24,
  },
  sosButton: {
    backgroundColor: "#DC2626",
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 24,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  sosButtonText: {
    fontSize: 18,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    color: "white",
    letterSpacing: 0.3,
  },
  disclaimerText: {
    fontSize: 12,
    color: "#EF4444",
    fontFamily: Fonts.sans,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 12,
    lineHeight: 16,
  },
  secondaryBtn: {
    marginTop: 10,
  },

  // Map section
  mapSection: {
    borderWidth: 1.5,
    borderRadius: 20,
    overflow: "hidden" as any,
    marginBottom: 24,
  },
  mapBox: {
    width: "100%" as any,
    height: 240,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden" as any,
  },
  nearbyList: {
    padding: 12,
  },
  nearbyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  nearbyTitle: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  nearbyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 4,
    gap: 8,
  },
  nearbyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0EA5E9",
  },
  nearbyLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Fonts.sans,
  },
  distBadge: {
    backgroundColor: "#0EA5E910",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  distText: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#0EA5E9",
  },
  nearbyEmpty: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontStyle: "italic",
  },
  routeHint: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginBottom: 8,
    lineHeight: 16,
  },
  routeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  etaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(14,165,233,0.14)",
    borderWidth: 1,
    borderColor: "rgba(14,165,233,0.35)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  etaText: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    fontWeight: "700",
    color: "#0369A1",
  },
});
