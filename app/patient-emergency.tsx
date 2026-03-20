import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useState } from "react";
import {
    Animated,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "@/components/app-button";
import { useAppState } from "@/components/app-state";
import { HtmlMapView } from "@/components/html-map-view";
import { LoadingModal } from "@/components/loading-modal";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    buildMapHtml,
    buildPatientRequestMapHtml,
    calculateDistance,
    getAvailableAmbulances,
    parsePostGISPoint,
} from "@/utils/emergency";
import {
  cancelEmergencyWithinWindow,
    createEmergency,
  getEmergencyCancelWindowState,
    getActiveEmergency,
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
  const [activeEmergencyStatus, setActiveEmergencyStatus] = useState<string | null>(
    null,
  );
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

  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const nearestDistanceKm = useMemo(() => {
    if (nearbyAmbulances.length === 0) return null;
    return nearbyAmbulances.reduce((min, a) => Math.min(min, a.distanceKm), Infinity);
  }, [nearbyAmbulances]);

  const estimatedArrivalMinutes = useMemo(() => {
    if (nearestDistanceKm === null || !Number.isFinite(nearestDistanceKm)) {
      return null;
    }
    // Simple urban estimate: ~35 km/h average + 1 minute dispatch overhead.
    return Math.max(2, Math.round((nearestDistanceKm / 35) * 60 + 1));
  }, [nearestDistanceKm]);

  const canCancelByWindow =
    cancelRemainingSeconds > 0 &&
    ["pending", "assigned"].includes(activeEmergencyStatus || "pending");

  useEffect(() => {
    checkActiveEmergency();
    requestLocationPermission();
    loadNearbyAmbulances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reload ambulances when location changes
  useEffect(() => {
    if (location) loadNearbyAmbulances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.latitude, location?.longitude]);

  // Auto-refresh ambulance count every 15s (picks up driver availability toggles)
  useEffect(() => {
    const interval = setInterval(() => {
      loadNearbyAmbulances();
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.latitude, location?.longitude]);

  // Realtime: instantly refresh when any driver toggles availability
  useEffect(() => {
    const channel = supabase
      .channel("ambulance-availability")
      .on(
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "ambulances" },
        () => {
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

  const loadNearbyAmbulances = async () => {
    try {
      const { ambulances: data } = await getAvailableAmbulances();
      if (!data) return;
      const parsed = data
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
          // Filter out ambulances that are too far away
          if (dist !== null && dist > MAX_AMBULANCE_DISTANCE_KM) return null;
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
      setNearbyAmbulances(parsed as any[]);
    } catch (err) {
      console.error("Error loading ambulances:", err);
    }
  };

  // Subscribe to emergency status changes → notify patient & auto-navigate
  useEffect(() => {
    if (!activeEmergencyId) return;
    const unsub = subscribeToEmergency(activeEmergencyId, (updated) => {
      const status = updated?.status;
      setActiveEmergencyStatus(status ?? null);
      if (status === "en_route" || status === "assigned") {
        // Ambulance accepted → show notification and go to tracking
        const msg =
          status === "en_route"
            ? "An ambulance is now on its way to your location!"
            : "An ambulance has been assigned to your emergency.";
        showAlert("Ambulance Update", msg);
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
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });
    } catch (error) {
      console.error("Error getting location:", error);
      const msg =
        "Could not get your location. Please enable location services.";
      showError("Location Error", msg);
    }
  };

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
      const fullDescription = parts.length > 0 ? parts.join(" — ") : undefined;

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
      setActiveEmergencyCreatedAt(emergency.created_at || new Date().toISOString());
      setActiveEmergencyStatus(emergency.status || "pending");

      // Clear form
      setDescription("");
      setPatientCondition("");
      setOtherPersonName("");
      setOtherPersonContact("");

      const successMsg =
        "Your emergency request has been sent. Ambulance dispatch is in progress.\n\nStay calm and follow dispatcher instructions.";
      showSuccess("Emergency Request Sent", successMsg);

      // Navigate to tracking screen
      setTimeout(() => {
        router.push(`/patient-emergency-tracking?emergencyId=${emergency.id}`);
      }, 1000);
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
      <LoadingModal
        visible={loading}
        colorScheme={colorScheme}
        message="Requesting ambulance..."
      />

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
                <ThemedText style={styles.liveStatusLabel}>Live Status:</ThemedText>
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
                    : ["en_route", "at_scene", "arrived", "transporting", "at_hospital"].includes(
                          String(activeEmergencyStatus || ""),
                        )
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
                    backgroundColor:
                      canCancelByWindow
                        ? "rgba(239,68,68,0.08)"
                        : "rgba(148,163,184,0.08)",
                  },
                ]}
              />
            </>
          ) : (
            // No Emergency View
            <>
              {/* ── Map Box: Your location + nearby ambulances ─── */}
              {location && (
                <View
                  style={[styles.mapSection, { borderColor: colors.border }]}
                >
                  {(() => {
                    const mapHtml =
                      nearbyAmbulances.length > 0
                        ? buildPatientRequestMapHtml(
                            location.latitude,
                            location.longitude,
                            nearbyAmbulances,
                          )
                        : buildMapHtml(
                            location.latitude,
                            location.longitude,
                            16,
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
                          ? `${nearbyAmbulances.length} Ambulance${nearbyAmbulances.length > 1 ? "s" : ""} Available`
                          : "Searching for ambulances..."}
                      </ThemedText>
                    </View>
                    {nearbyAmbulances.length > 0 && (
                      <View style={styles.routeMetaRow}>
                        <ThemedText
                          style={[
                            styles.routeHint,
                            { color: colors.textMuted, marginBottom: 0 },
                          ]}
                        >
                          Route preview: nearest ambulance to your location
                        </ThemedText>
                        {estimatedArrivalMinutes !== null && (
                          <View style={styles.etaBadge}>
                            <MaterialIcons
                              name="schedule"
                              size={13}
                              color="#0369A1"
                            />
                            <ThemedText style={styles.etaText}>
                              ETA {estimatedArrivalMinutes} min
                            </ThemedText>
                          </View>
                        )}
                      </View>
                    )}
                    {nearbyAmbulances.slice(0, 3).map((amb, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.nearbyItem,
                          { backgroundColor: colors.surfaceMuted },
                        ]}
                      >
                        <View style={styles.nearbyDot} />
                        <ThemedText
                          style={[styles.nearbyLabel, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {amb.label}
                        </ThemedText>
                        {amb.distance ? (
                          <View style={styles.distBadge}>
                            <ThemedText style={styles.distText}>
                              {amb.distance}
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                    ))}
                    {nearbyAmbulances.length === 0 && (
                      <ThemedText
                        style={[
                          styles.nearbyEmpty,
                          { color: colors.textMuted },
                        ]}
                      >
                        No ambulances nearby — your request will still be
                        dispatched
                      </ThemedText>
                    )}
                  </View>
                </View>
              )}

              {/* Other person details */}
              {isForOther && (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>
                    Person in Need
                  </ThemedText>

                  <ThemedText style={styles.label}>Name</ThemedText>
                  <TextInput
                    style={[styles.input, isDark ? styles.inputDark : null]}
                    placeholder="Name of the person who needs help"
                    placeholderTextColor={isDark ? "#6B7280" : "#94A3B8"}
                    value={otherPersonName}
                    onChangeText={setOtherPersonName}
                  />

                  <ThemedText style={styles.label}>
                    Contact Number (optional)
                  </ThemedText>
                  <TextInput
                    style={[styles.input, isDark ? styles.inputDark : null]}
                    placeholder="Their phone number"
                    placeholderTextColor={isDark ? "#6B7280" : "#94A3B8"}
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
                  <SeverityButton level="low" label="Low" color="#3B82F6" />
                  <SeverityButton
                    level="medium"
                    label="Medium"
                    color="#F59E0B"
                  />
                  <SeverityButton level="high" label="High" color="#EF4444" />
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
                  style={[styles.input, isDark ? styles.inputDark : null]}
                  placeholder={
                    isForOther
                      ? "Describe what happened..."
                      : "Describe your emergency..."
                  }
                  placeholderTextColor={isDark ? "#6B7280" : "#94A3B8"}
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
                  style={[styles.input, isDark ? styles.inputDark : null]}
                  placeholder={
                    isForOther
                      ? "Describe their current condition..."
                      : "Describe your current condition..."
                  }
                  placeholderTextColor={isDark ? "#6B7280" : "#94A3B8"}
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
                  style={({ pressed }) => [
                    styles.sosButton,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <MaterialIcons name="phone" size={32} color="white" />
                  <ThemedText style={styles.sosButtonText}>
                    {isForOther
                      ? "SOS - Call Ambulance for Them"
                      : "SOS - Call Ambulance"}
                  </ThemedText>
                </Pressable>
              </Animated.View>

              <ThemedText style={styles.disclaimerText}>
                For life-threatening emergencies, also call your local emergency
                number (911, 112, etc.)
              </ThemedText>
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
