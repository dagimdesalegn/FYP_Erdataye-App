import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppState } from "@/components/app-state";
import { HtmlMapView } from "@/components/html-map-view";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    acceptEmergency,
    declineEmergency,
    getDriverAmbulanceId,
    getDriverAssignment,
    getPatientInfo,
    subscribeToAssignments,
} from "@/utils/driver";
import {
    buildDriverPatientMapHtml,
    buildMapHtml,
    calculateDistance,
    parsePostGISPoint,
} from "@/utils/emergency";
import { supabase } from "@/utils/supabase";

interface MedicalProfile {
  blood_type?: string;
  allergies?: string;
  medical_conditions?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

interface PatientInfo {
  id: string;
  full_name: string;
  phone: string;
  medical_profiles?: MedicalProfile[];
}

export default function DriverEmergencyScreen() {
  const authLoading = useAuthGuard(["ambulance", "driver"]);
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme];
  const { user } = useAppState();
  const { showAlert, showError, showConfirm } = useModal();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth > 600;
  const insets = useSafeAreaInsets();

  const [assignment, setAssignment] = useState<any>(null);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const liveLocationRef = useRef(false);

  // Live GPS for driver's own location
  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startLiveLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        // Immediate snapshot
        try {
          const initial = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setDriverCoords({
            latitude: initial.coords.latitude,
            longitude: initial.coords.longitude,
          });
          liveLocationRef.current = true;
        } catch {}

        if (Platform.OS === "web") {
          intervalId = setInterval(async () => {
            try {
              const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              setDriverCoords({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
            } catch {}
          }, 8000);
        } else {
          watcher = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 8000,
              distanceInterval: 10,
            },
            (loc) => {
              setDriverCoords({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
            },
          );
        }
      } catch {}
    };

    startLiveLocation();

    return () => {
      if (watcher) watcher.remove();
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const loadAssignment = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!user) return;
      if (!options?.silent) {
        setLoading(true);
      }

      try {
        const { assignment: asgn, error } = await getDriverAssignment(user.id);

        if (error || !asgn) {
          if (!options?.silent) {
            const message = "No active assignment found";
            showAlert("Info", message);
            router.back();
          }
          return;
        }

        setAssignment(asgn);

        // Load patient info (backend returns medical_profiles via service-role)
        const pid = asgn.emergency_requests?.patient_id || "";
        if (pid) {
          const { info } = await getPatientInfo(
            pid,
            asgn.emergency_id || asgn.emergency_requests?.id,
          );
          if (info) {
            setPatientInfo(info);
          }
        }

        // Load driver's ambulance location from DB as initial fallback
        // (live GPS will override this once it gets a fix)
        if (!liveLocationRef.current) {
          const { ambulanceId } = await getDriverAmbulanceId(user.id);
          if (ambulanceId) {
            const { data } = await supabase
              .from("ambulances")
              .select("last_known_location")
              .eq("id", ambulanceId)
              .maybeSingle();
            if (data?.last_known_location) {
              const parsed = parsePostGISPoint(data.last_known_location);
              if (parsed) setDriverCoords(parsed);
            }
          }
        }
      } catch (err) {
        console.error("Error loading assignment:", err);
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [router, user, showAlert],
  );

  useEffect(() => {
    loadAssignment();
  }, [loadAssignment]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToAssignments(user.id, () => {
      loadAssignment({ silent: true });
    });
    return unsubscribe;
  }, [user, loadAssignment]);

  const handleAccept = async () => {
    if (!assignment || !user) return;
    try {
      setProcessing(true);
      const { error } = await acceptEmergency(
        assignment.id,
        assignment.emergency_id,
      );
      if (error) {
        const msg = error.message || "Failed to accept emergency";
        showError("Accept Failed", msg);
        return;
      }
      router.replace({
        pathname: "/driver-emergency-tracking" as any,
        params: { emergencyId: assignment.emergency_id },
      });
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = () => {
    if (!assignment || !user) return;

    const doDecline = async () => {
      try {
        setProcessing(true);
        const { error } = await declineEmergency(
          assignment.id,
          assignment.emergency_id,
        );
        if (error) {
          const msg = error.message || "Failed to decline";
          showError("Decline Failed", msg);
          return;
        }
        router.replace("/driver-home" as any);
      } catch (err) {
        console.error(err);
      } finally {
        setProcessing(false);
      }
    };

    showConfirm(
      "Decline Emergency?",
      "Are you sure you want to decline this emergency?",
      doDecline,
    );
  };

  // ─── Helpers ──────────────────────────────────────────────
  const severityMeta = (type: string) => {
    switch (type?.toLowerCase()) {
      case "critical":
        return {
          color: "#DC2626",
          bg: "#FEE2E2",
          icon: "priority-high" as const,
          label: "CRITICAL",
        };
      case "high":
        return {
          color: "#EA580C",
          bg: "#FFF7ED",
          icon: "warning" as const,
          label: "HIGH",
        };
      case "medium":
        return {
          color: "#0284C7",
          bg: "#E0F2FE",
          icon: "info" as const,
          label: "MEDIUM",
        };
      case "low":
        return {
          color: "#059669",
          bg: "#ECFDF5",
          icon: "check-circle" as const,
          label: "LOW",
        };
      default:
        return {
          color: "#6B7280",
          bg: "#F3F4F6",
          icon: "help" as const,
          label: type?.toUpperCase() || "UNKNOWN",
        };
    }
  };

  // ─── Loading / empty ─────────────────────────────────────
  if (loading) {
    return (
      <View
        style={[
          styles.root,
          {
            backgroundColor: Colors[colorScheme].background,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={Colors[colorScheme].tint} />
      </View>
    );
  }

  if (!assignment) {
    return (
      <View
        style={[
          styles.root,
          { backgroundColor: Colors[colorScheme].background },
        ]}
      >
        <View style={styles.emptyWrap}>
          <MaterialIcons name="assignment-late" size={56} color="#94A3B8" />
          <ThemedText style={styles.emptyLabel}>
            No active assignment
          </ThemedText>
        </View>
      </View>
    );
  }

  const emergency = assignment.emergency_requests;
  const patientCoords = parsePostGISPoint(emergency?.patient_location);
  const sev = severityMeta(emergency?.emergency_type);

  // Distance between driver and patient
  let distanceText = "";
  if (driverCoords && patientCoords) {
    const km = calculateDistance(
      driverCoords.latitude,
      driverCoords.longitude,
      patientCoords.latitude,
      patientCoords.longitude,
    );
    distanceText =
      km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }

  // Map HTML — memoised with rounded coords to avoid iframe reloads on GPS drift
  const mapHtml = useMemo(() => {
    if (driverCoords && patientCoords) {
      return buildDriverPatientMapHtml(
        +driverCoords.latitude.toFixed(4),
        +driverCoords.longitude.toFixed(4),
        +patientCoords.latitude.toFixed(4),
        +patientCoords.longitude.toFixed(4),
      );
    }
    if (patientCoords) return buildMapHtml(patientCoords.latitude, patientCoords.longitude, 16);
    return null;
  }, [
    driverCoords && +driverCoords.latitude.toFixed(4),
    driverCoords && +driverCoords.longitude.toFixed(4),
    patientCoords?.latitude,
    patientCoords?.longitude,
  ]);

  const medFromProfile = patientInfo?.medical_profiles?.[0];
  let medFromAssignment: any = null;
  try {
    const rawNotes = assignment?.notes;
    if (typeof rawNotes === "string" && rawNotes.trim()) {
      const parsed = JSON.parse(rawNotes);
      medFromAssignment = parsed?.medical_snapshot ?? null;
    }
  } catch {
    medFromAssignment = null;
  }

  const med = medFromAssignment || medFromProfile;

  // ─── UI ───────────────────────────────────────────────────
  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const subtleText = colors.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.topEmergencyBox,
          {
            top: Math.max(insets.top, 12),
            backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
            borderColor: cardBorder,
          },
        ]}
      >
        <View style={styles.topEmergencyTextWrap}>
          <ThemedText style={[styles.topEmergencyTitle, { color: sev.color }]}>
            {sev.label} EMERGENCY
          </ThemedText>
          <ThemedText
            style={[
              styles.topEmergencySub,
              { color: isDark ? "#CBD5E1" : "#475569" },
            ]}
          >
            {new Date(emergency?.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {distanceText ? `  •  ${distanceText} away` : ""}
          </ThemedText>
        </View>

        <View style={styles.topActions}>
          <Pressable
            onPress={async () => {
              setRefreshing(true);
              await loadAssignment({ silent: true });
              setRefreshing(false);
            }}
            disabled={refreshing}
            style={({ pressed }) => [
              styles.topIconBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(2,6,23,0.06)",
              },
              (pressed || refreshing) && { opacity: 0.7 },
            ]}
          >
            <MaterialIcons
              name="refresh"
              size={17}
              color={isDark ? "#E2E8F0" : "#334155"}
            />
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.topCloseBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(2,6,23,0.06)",
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <MaterialIcons
              name="close"
              size={18}
              color={isDark ? "#E2E8F0" : "#334155"}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 16) + 84 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── MAP ───────────────────────────────────────── */}
        {mapHtml && (
          <View
            style={[
              styles.mapCard,
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
                Live Map
              </ThemedText>
              {distanceText ? (
                <View style={styles.distBadge}>
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

            {/* Navigate button inside map card */}
            {patientCoords && (
              <Pressable
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${patientCoords.latitude},${patientCoords.longitude}`;
                  Linking.openURL(url);
                }}
                style={styles.navBtn}
              >
                <MaterialIcons name="navigation" size={18} color="#FFF" />
                <ThemedText style={styles.navBtnText}>
                  Open in Google Maps
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}

        {/* ── Patient Info Card ─────────────────────────── */}
        {patientInfo && (
          <View
            style={[
              styles.infoCard,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: "#ECFDF5" }]}>
                <MaterialIcons name="person" size={20} color="#059669" />
              </View>
              <ThemedText
                style={[
                  styles.cardHeading,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Patient
              </ThemedText>
            </View>

            <View style={styles.infoRow}>
              <ThemedText style={[styles.infoLabel, { color: subtleText }]}>
                Name
              </ThemedText>
              <ThemedText
                style={[
                  styles.infoValue,
                  { color: isDark ? "#F1F5F9" : "#0F172A" },
                ]}
              >
                {patientInfo.full_name}
              </ThemedText>
            </View>

            {patientInfo.phone ? (
              <View style={styles.infoRow}>
                <ThemedText style={[styles.infoLabel, { color: subtleText }]}>
                  Phone
                </ThemedText>
                <View
                  style={[
                    styles.phoneLayout,
                    {
                      backgroundColor: isDark ? "#0F172A" : "#F8FAFC",
                      borderColor: cardBorder,
                    },
                  ]}
                >
                  <View style={styles.phoneLeft}>
                    <MaterialIcons name="phone" size={17} color="#0EA5E9" />
                    <ThemedText style={styles.phoneValue}>
                      {patientInfo.phone}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}
                    style={({ pressed }) => [
                      styles.callNowBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <MaterialIcons name="call" size={15} color="#FFFFFF" />
                    <ThemedText style={styles.callNowText}>Call</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {emergency?.description ? (
              <View
                style={[
                  styles.descBox,
                  {
                    backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                    borderColor: cardBorder,
                  },
                ]}
              >
                <MaterialIcons
                  name="description"
                  size={16}
                  color={subtleText}
                />
                <ThemedText
                  style={[
                    styles.descText,
                    { color: isDark ? "#CBD5E1" : "#475569" },
                  ]}
                >
                  {emergency.description}
                </ThemedText>
              </View>
            ) : null}

            <View
              style={[
                styles.medicalInlineWrap,
                {
                  backgroundColor: isDark ? "#0F172A" : "#F8FAFC",
                  borderColor: cardBorder,
                },
              ]}
            >
              <View style={styles.medicalInlineHeader}>
                <MaterialIcons
                  name="medical-services"
                  size={16}
                  color="#DC2626"
                />
                <ThemedText
                  style={[
                    styles.medicalInlineTitle,
                    { color: isDark ? "#F8FAFC" : "#0F172A" },
                  ]}
                >
                  Medical Profile
                </ThemedText>
              </View>

              <View style={styles.medicalInlineGrid}>
                <View
                  style={[
                    styles.medicalInlineTile,
                    {
                      backgroundColor: isDark ? "#3B0A0A" : "#FFF1F2",
                      borderColor: isDark ? "#7F1D1D" : "#FCA5A5",
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.medicalTileLabel,
                      { color: isDark ? "#FCA5A5" : "#B91C1C" },
                    ]}
                  >
                    Blood Type
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.medicalTileValue,
                      { color: isDark ? "#FEE2E2" : "#7F1D1D" },
                    ]}
                  >
                    {med?.blood_type || "Not set"}
                  </ThemedText>
                </View>

                <View
                  style={[
                    styles.medicalInlineTile,
                    {
                      backgroundColor: isDark ? "#3A2602" : "#FFFBEB",
                      borderColor: isDark ? "#F59E0B" : "#F59E0B",
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.medicalTileLabel,
                      { color: isDark ? "#FCD34D" : "#92400E" },
                    ]}
                  >
                    Allergies
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.medicalTileValue,
                      { color: isDark ? "#FEF3C7" : "#78350F" },
                    ]}
                    numberOfLines={2}
                  >
                    {med?.allergies || "None reported"}
                  </ThemedText>
                </View>
              </View>

              <View
                style={[
                  styles.emergencyContactCard,
                  {
                    backgroundColor: isDark ? "#052E2B" : "#ECFDF5",
                    borderColor: isDark ? "#0F766E" : "#6EE7B7",
                  },
                ]}
              >
                <View style={styles.emergencyContactHeader}>
                  <MaterialIcons
                    name="contact-phone"
                    size={16}
                    color={isDark ? "#5EEAD4" : "#0F766E"}
                  />
                  <ThemedText
                    style={[
                      styles.medicalDetailLabel,
                      {
                        color: isDark ? "#5EEAD4" : "#0F766E",
                        marginBottom: 0,
                      },
                    ]}
                  >
                    Emergency Contact
                  </ThemedText>
                </View>

                <ThemedText
                  style={[
                    styles.emergencyContactName,
                    { color: isDark ? "#E6FFFA" : "#064E3B" },
                  ]}
                >
                  {med?.emergency_contact_name || "Not provided"}
                </ThemedText>

                {med?.emergency_contact_phone ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(`tel:${med.emergency_contact_phone}`)
                    }
                    style={({ pressed }) => [
                      styles.emergencyCallBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <MaterialIcons name="call" size={14} color="#FFFFFF" />
                    <ThemedText style={styles.emergencyCallBtnText}>
                      {med.emergency_contact_phone}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Bottom Action Bar ────────────────────────────── */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
            borderColor: cardBorder,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={styles.buttonRow}>
          <Pressable
            onPress={handleDecline}
            disabled={processing}
            style={({ pressed }) => [
              styles.declineBtn,
              pressed && { opacity: 0.85 },
              processing && { opacity: 0.6 },
            ]}
          >
            {processing ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <>
                <MaterialIcons name="close" size={18} color="#DC2626" />
                <ThemedText style={styles.declineBtnText}>Decline</ThemedText>
              </>
            )}
          </Pressable>

          <Pressable
            onPress={handleAccept}
            disabled={processing}
            style={({ pressed }) => [
              styles.acceptWrapper,
              pressed && { opacity: 0.95 },
              processing && { opacity: 0.6 },
            ]}
          >
            <LinearGradient
              colors={["#059669", "#047857"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.acceptGradient}
            >
              {processing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MaterialIcons name="check" size={18} color="#FFF" />
                  <ThemedText style={styles.acceptBtnText}>
                    Accept & Go
                  </ThemedText>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 160,
    maxWidth: 640,
    alignSelf: "center" as any,
    width: "100%" as any,
  },
  closeBtn: {
    alignSelf: "flex-end",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },

  topEmergencyBox: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 20,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 6,
  },
  topCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 10,
  },
  topIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  topEmergencyTextWrap: {
    flex: 1,
    justifyContent: "center",
  },
  topEmergencyTitle: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    letterSpacing: 0.45,
  },
  topEmergencySub: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 1,
  },

  // Empty
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 80,
  },
  emptyLabel: {
    fontSize: 16,
    marginTop: 12,
    fontFamily: Fonts.sans,
    color: "#94A3B8",
  },

  // Severity banner
  severityBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  sevLabel: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    letterSpacing: 0.5,
  },
  sevSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },

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
    paddingHorizontal: 14,
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0EA5E9",
    margin: 14,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  navBtnText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
    fontFamily: Fonts.sans,
  },

  // Info card
  infoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
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
  },

  infoRow: { marginBottom: 14 },
  infoLabel: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoValue: { fontSize: 15, fontWeight: "600", fontFamily: Fonts.sans },

  phoneLink: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    color: "#0EA5E9",
    textDecorationLine: "underline",
  },
  phoneLayout: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  phoneLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  phoneValue: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#0EA5E9",
  },
  callNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  callNowText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
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

  // Medical card
  medicalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  medicalGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  medicalGridItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    gap: 6,
  },
  medicalGridValue: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  medicalGridLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  medicalConditionBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  emergencyContactBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },

  // Medical (kept for grid items)
  bloodBadge: {
    backgroundColor: "#DC2626",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  bloodText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 16,
    fontFamily: Fonts.sans,
  },

  // Bottom bar
  bottomBar: {
    position: "absolute" as any,
    bottom: 8,
    left: 12,
    right: 12,
    borderWidth: 1,
    borderRadius: 18,
    paddingTop: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 14,
  },
  bottomInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 10,
  },
  bottomTitle: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    maxWidth: 230,
    textAlign: "center",
  },
  distChip: {
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  distChipText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch",
    justifyContent: "center",
  },
  declineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
    paddingVertical: 13,
    minHeight: 50,
    gap: 6,
  },
  declineBtnText: {
    color: "#DC2626",
    fontWeight: "700",
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  acceptWrapper: {
    flex: 1,
    minHeight: 50,
  },
  acceptGradient: {
    borderRadius: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  acceptBtnText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
    fontFamily: Fonts.sans,
  },

  // Medical info merged into patient card
  medicalInlineWrap: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  medicalInlineHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  medicalInlineTitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    fontWeight: "700",
  },
  medicalInlineGrid: {
    flexDirection: "row",
    gap: 8,
  },
  medicalInlineTile: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    minHeight: 68,
    justifyContent: "center",
  },
  medicalTileLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  medicalTileValue: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    fontWeight: "700",
    color: "#0F172A",
  },
  medicalDetailBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  emergencyContactCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  emergencyContactHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  emergencyContactName: {
    fontSize: 15,
    fontFamily: Fonts.sans,
    fontWeight: "700",
  },
  emergencyCallBtn: {
    marginTop: 2,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  emergencyCallBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: "700",
  },
  medicalDetailLabel: {
    fontSize: 11,
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  medicalDetailValue: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    fontWeight: "600",
  },
});
