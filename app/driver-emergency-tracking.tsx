import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Linking,
    Platform,
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
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { backendGet } from "@/utils/api";
import {
    getDriverAmbulanceId,
    getPatientInfo,
    sendLocationUpdate,
    subscribeToEmergencyStatus,
    updateEmergencyStatus,
} from "@/utils/driver";
import {
    buildDriverPatientMapHtml,
    buildMapHtml,
    calculateDistance,
    formatCoords,
    parsePostGISPoint,
} from "@/utils/emergency";
import {
    addMedicalNote,
    formatNoteTime,
    getMedicalNotes,
    type MedicalNote,
    NOTE_TYPE_LABELS,
    type NoteType,
    type Vitals,
} from "@/utils/medical-notes";
import supabase from "@/utils/supabase";

type Tab = "map" | "status" | "notes";

const STATUS_LABELS: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  pending: { label: "Pending", icon: "hourglass-top", color: "#F59E0B" },
  assigned: { label: "Assigned", icon: "local-shipping", color: "#0EA5E9" },
  en_route: { label: "En Route", icon: "directions-car", color: "#06B6D4" },
  at_scene: { label: "At Scene", icon: "place", color: "#10B981" },
  transporting: {
    label: "Transporting",
    icon: "local-hospital",
    color: "#8B5CF6",
  },
  at_hospital: {
    label: "At Hospital",
    icon: "local-hospital",
    color: "#7C3AED",
  },
  completed: { label: "Completed", icon: "check-circle", color: "#059669" },
};

export default function DriverEmergencyTrackingScreen() {
  const authLoading = useAuthGuard(["ambulance", "driver"]);
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme];
  const { emergencyId } = useLocalSearchParams();
  const { user } = useAppState();
  const { showError, showSuccess } = useModal();
  const insets = useSafeAreaInsets();

  const [currentStatus, setCurrentStatus] = useState("assigned");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [ambulanceId, setAmbulanceId] = useState<string | null>(null);
  const [driverCoords, setDriverCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [patientCoords, setPatientCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [patientInfo, setPatientInfo] = useState<any>(null);
  const [locationTracking, setLocationTracking] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const lastResyncRef = useRef(0);

  // Medical notes state
  const [medicalNotes, setMedicalNotes] = useState<MedicalNote[]>([]);
  const [noteContent, setNoteContent] = useState("");
  const [noteType, setNoteType] = useState<NoteType>("initial_assessment");
  const [vitals, setVitals] = useState<Vitals>({});
  const [submittingNote, setSubmittingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [showVitals, setShowVitals] = useState(false);

  const statusFlow = [
    "assigned",
    "en_route",
    "at_scene",
    "transporting",
    "at_hospital",
    "completed",
  ];

  const driverNextStatusMap: Record<string, string | null> = {
    assigned: "en_route",
    en_route: "at_scene",
    at_scene: "transporting",
    arrived: "transporting",
    transporting: null,
    at_hospital: null,
    completed: null,
    cancelled: null,
    pending: null,
  };

  // Load emergency data + ambulance + patient info
  useEffect(() => {
    if (!emergencyId || !user) return;

    let mounted = true;

    const loadData = async () => {
      try {
        setLoading(true);

        // Fetch critical data in parallel for faster first paint.
        const [ambResult, detailRes] = await Promise.all([
          getDriverAmbulanceId(user.id),
          backendGet<{ emergency: any }>(
            `/ops/patient/emergencies/${emergencyId}/detail`,
          ),
        ]);

        if (!mounted) return;

        if (ambResult.ambulanceId) {
          setAmbulanceId(ambResult.ambulanceId);
        }

        const emergData = detailRes?.emergency;

        if (emergData) {
          setCurrentStatus(emergData.status || "assigned");
          const patLoc = parsePostGISPoint(emergData.patient_location);
          if (patLoc) {
            setPatientCoords(patLoc);
          }

          if (emergData.patient_id) {
            // Do not block screen render on patient profile details.
            void getPatientInfo(emergData.patient_id, emergencyId as string)
              .then(({ info }) => {
                if (mounted && info) setPatientInfo(info);
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error("Error loading data:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadData();

    // Subscribe to status changes
    const unsubscribe = subscribeToEmergencyStatus(
      emergencyId as string,
      (status: string) => {
        setCurrentStatus(status);
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [emergencyId, user]);

  // Subscribe to live patient location updates via Supabase realtime
  useEffect(() => {
    if (!emergencyId) return;
    const channel = supabase
      .channel(`patient-loc-${emergencyId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "emergency_requests",
          filter: `id=eq.${emergencyId}`,
        },
        (payload: any) => {
          const patLoc = parsePostGISPoint(payload.new?.patient_location);
          if (patLoc) setPatientCoords(patLoc);
          if (payload.new?.status) setCurrentStatus(payload.new.status);
        },
      )
      .subscribe((status: string) => {
        // Re-sync on reconnect so no position updates are missed (debounced)
        if (status !== "SUBSCRIBED") return;
        const now = Date.now();
        if (now - lastResyncRef.current < 10000) return;
        lastResyncRef.current = now;
        void supabase
          .from("emergency_requests")
          .select("patient_location,status")
          .eq("id", emergencyId as string)
          .maybeSingle()
          .then(({ data }: any) => {
            if (!data) return;
            const patLoc = parsePostGISPoint(data.patient_location);
            if (patLoc) setPatientCoords(patLoc);
            if (data.status) setCurrentStatus(data.status);
          });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [emergencyId]);

  // Load medical notes when notes tab is active
  const loadNotes = useCallback(async () => {
    if (!emergencyId) return;
    setLoadingNotes(true);
    const { notes } = await getMedicalNotes(emergencyId as string);
    setMedicalNotes(notes);
    setLoadingNotes(false);
  }, [emergencyId]);

  useEffect(() => {
    if (activeTab === "notes" && emergencyId) {
      loadNotes();
    }
  }, [activeTab, emergencyId, loadNotes]);

  const handleSubmitNote = async () => {
    if (!emergencyId || !noteContent.trim()) return;
    setSubmittingNote(true);
    const hasVitals = Object.values(vitals).some(
      (v) => v !== undefined && v !== "" && v !== null,
    );
    const { note, error } = await addMedicalNote(
      emergencyId as string,
      noteType,
      noteContent.trim(),
      hasVitals ? vitals : null,
    );
    if (error) {
      showError("Note Failed", error);
    } else if (note) {
      setMedicalNotes((prev) => [...prev, note]);
      setNoteContent("");
      setVitals({});
      setShowVitals(false);
      showSuccess("Note Saved", "Medical note has been recorded successfully.");
    }
    setSubmittingNote(false);
  };

  // Auto-navigate back to home when emergency is completed or cancelled
  useEffect(() => {
    if (currentStatus === "completed" || currentStatus === "cancelled") {
      const label =
        currentStatus === "completed"
          ? "Emergency Completed"
          : "Emergency Cancelled";
      const msg =
        currentStatus === "completed"
          ? "This emergency has been marked as completed. Returning to home."
          : "This emergency has been cancelled. Returning to home.";
      showSuccess(label, msg);
      const timeout = setTimeout(() => {
        router.replace("/driver-home");
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [currentStatus]);

  // Location tracking - updates driver position + sends to DB
  useEffect(() => {
    if (!locationTracking || !ambulanceId) return;

    let watcher: Location.LocationSubscription | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        try {
          const initial = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          setDriverCoords({
            latitude: initial.coords.latitude,
            longitude: initial.coords.longitude,
          });
          await sendLocationUpdate(
            ambulanceId,
            initial.coords.latitude,
            initial.coords.longitude,
          );
        } catch {
          // keep watcher/polling fallback below
        }

        if (Platform.OS === "web") {
          intervalId = setInterval(async () => {
            try {
              const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              });
              setDriverCoords({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
              await sendLocationUpdate(
                ambulanceId,
                loc.coords.latitude,
                loc.coords.longitude,
              );
            } catch (pollErr) {
              console.warn("Web location polling failed:", pollErr);
            }
          }, 8000);
          return;
        }

        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          async (loc) => {
            try {
              setDriverCoords({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });
              await sendLocationUpdate(
                ambulanceId,
                loc.coords.latitude,
                loc.coords.longitude,
              );
            } catch (e) {
              console.warn("Location update failed:", e);
            }
          },
        );
      } catch (error) {
        console.error("Location error:", error);
      }
    };

    startTracking();
    return () => {
      if (intervalId) clearInterval(intervalId);
      if (watcher && typeof (watcher as any).remove === "function") {
        try {
          watcher.remove();
        } catch (removeErr) {
          console.warn("Location watcher cleanup failed:", removeErr);
        }
      }
    };
  }, [locationTracking, ambulanceId]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!emergencyId || !user) return;
    try {
      setUpdating(true);
      const { error } = await updateEmergencyStatus(
        emergencyId as string,
        newStatus as any,
      );
      if (error) {
        const msg = "Failed to update status";
        showError("Update Failed", msg);
        return;
      }
      setCurrentStatus(newStatus);
      if (newStatus === "transporting") {
        showSuccess(
          "Transport Started",
          "Patient is now in transport. Hospital will update arrival and completion.",
        );
      }
    } catch {
      showError("Update Failed", "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  const getNextStatus = () => {
    return driverNextStatusMap[currentStatus] ?? null;
  };

  // ─── Loading ──────────────────────────────────────────
  if (loading) {
    return (
      <View
        style={[
          styles.root,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  const nextStatus = getNextStatus();
  const canUpdate = Boolean(nextStatus);
  const waitingForHospital = currentStatus === "transporting";
  const st = STATUS_LABELS[currentStatus] || STATUS_LABELS.assigned;

  // Distance
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

  // Build Google Maps embed URL
  const mapHtml = (() => {
    if (driverCoords && patientCoords) {
      return buildDriverPatientMapHtml(
        driverCoords.latitude,
        driverCoords.longitude,
        patientCoords.latitude,
        patientCoords.longitude,
      );
    }
    if (patientCoords)
      return buildMapHtml(patientCoords.latitude, patientCoords.longitude);
    if (driverCoords)
      return buildMapHtml(driverCoords.latitude, driverCoords.longitude);
    return "";
  })();

  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const subtleText = colors.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Header ───────────────────────────────────── */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: cardBg,
            borderBottomColor: cardBorder,
            paddingTop: Math.max(insets.top, 12),
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: isDark ? "#334155" : "#F1F5F9" },
            pressed && { opacity: 0.6 },
          ]}
        >
          <MaterialIcons
            name="arrow-back"
            size={20}
            color={isDark ? "#E2E8F0" : "#334155"}
          />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <ThemedText
            style={[
              styles.headerTitle,
              { color: isDark ? "#F1F5F9" : "#0F172A" },
            ]}
          >
            Emergency Tracking
          </ThemedText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 2,
            }}
          >
            <View style={[styles.statusDot, { backgroundColor: st.color }]} />
            <ThemedText style={[styles.headerSub, { color: st.color }]}>
              {st.label}
            </ThemedText>
            {distanceText ? (
              <ThemedText style={[styles.headerSub, { color: subtleText }]}>
                {" "}
                • {distanceText}
              </ThemedText>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => setLocationTracking(!locationTracking)}
          style={({ pressed }) => [
            styles.headerBtn,
            { backgroundColor: locationTracking ? "#10B98120" : "#6B728020" },
            pressed && { opacity: 0.6 },
          ]}
        >
          <MaterialIcons
            name={locationTracking ? "location-on" : "location-off"}
            size={20}
            color={locationTracking ? "#10B981" : "#6B7280"}
          />
        </Pressable>
      </View>

      {/* ── Tabs ─────────────────────────────────────── */}
      <View
        style={[
          styles.tabBar,
          { backgroundColor: cardBg, borderBottomColor: cardBorder },
        ]}
      >
        <Pressable
          onPress={() => setActiveTab("map")}
          style={[styles.tabBtn, activeTab === "map" && styles.tabBtnActive]}
        >
          <MaterialIcons
            name="map"
            size={18}
            color={activeTab === "map" ? "#0EA5E9" : subtleText}
          />
          <ThemedText
            style={[
              styles.tabLabel,
              { color: activeTab === "map" ? "#0EA5E9" : subtleText },
            ]}
          >
            Map
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("status")}
          style={[styles.tabBtn, activeTab === "status" && styles.tabBtnActive]}
        >
          <MaterialIcons
            name="timeline"
            size={18}
            color={activeTab === "status" ? "#0EA5E9" : subtleText}
          />
          <ThemedText
            style={[
              styles.tabLabel,
              { color: activeTab === "status" ? "#0EA5E9" : subtleText },
            ]}
          >
            Update Status
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("notes")}
          style={[styles.tabBtn, activeTab === "notes" && styles.tabBtnActive]}
        >
          <MaterialIcons
            name="medical-services"
            size={18}
            color={activeTab === "notes" ? "#0EA5E9" : subtleText}
          />
          <ThemedText
            style={[
              styles.tabLabel,
              { color: activeTab === "notes" ? "#0EA5E9" : subtleText },
            ]}
          >
            Medical Notes
          </ThemedText>
        </Pressable>
      </View>

      {/* ── Tab Content ──────────────────────────────── */}
      {activeTab === "map" ? (
        /* ═══════════ MAP TAB ═══════════ */
        <View style={styles.mapTabWrap}>
          {mapHtml ? (
            <HtmlMapView html={mapHtml} style={styles.mapFull} />
          ) : (
            <View style={styles.noMapWrap}>
              <MaterialIcons name="map" size={48} color={subtleText} />
              <ThemedText style={[styles.noMapText, { color: subtleText }]}>
                Map not available
              </ThemedText>
            </View>
          )}

          {/* Floating info overlay on map */}
          <View
            style={[
              styles.mapOverlay,
              { backgroundColor: cardBg + "EE", borderColor: cardBorder },
            ]}
          >
            {patientInfo && (
              <View style={styles.overlayRow}>
                <MaterialIcons name="person" size={16} color="#059669" />
                <ThemedText
                  style={[
                    styles.overlayText,
                    { color: isDark ? "#F1F5F9" : "#0F172A" },
                  ]}
                  numberOfLines={1}
                >
                  {patientInfo.full_name}
                </ThemedText>
                {patientInfo.phone ? (
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}
                  >
                    <MaterialIcons name="phone" size={16} color="#0EA5E9" />
                  </Pressable>
                ) : null}
              </View>
            )}
            {patientCoords && (
              <Pressable
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${patientCoords.latitude},${patientCoords.longitude}`;
                  Linking.openURL(url);
                }}
                style={styles.navOverlayBtn}
              >
                <MaterialIcons name="navigation" size={14} color="#FFF" />
                <ThemedText style={styles.navOverlayText}>Navigate</ThemedText>
              </Pressable>
            )}
          </View>

          {/* Legend */}
          <View style={[styles.mapLegend, { backgroundColor: cardBg + "DD" }]}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: "#0EA5E9" }]}
              />
              <ThemedText style={[styles.legendText, { color: subtleText }]}>
                You
              </ThemedText>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: "#DC2626" }]}
              />
              <ThemedText style={[styles.legendText, { color: subtleText }]}>
                Patient
              </ThemedText>
            </View>
          </View>

          {/* Quick status update floating button */}
          {canUpdate && nextStatus && (
            <Pressable
              onPress={() => handleStatusUpdate(nextStatus)}
              disabled={updating}
              style={({ pressed }) => [
                styles.floatingBtn,
                pressed && { opacity: 0.8 },
                updating && { opacity: 0.7 },
              ]}
            >
              {updating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MaterialIcons name="update" size={18} color="#FFF" />
                  <ThemedText style={styles.floatingBtnText}>
                    → {nextStatus.replace(/_/g, " ").toUpperCase()}
                  </ThemedText>
                </>
              )}
            </Pressable>
          )}
        </View>
      ) : activeTab === "status" ? (
        /* ═══════════ STATUS TAB ═══════════ */
        <ScrollView
          contentContainerStyle={styles.statusScroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Current status card */}
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: st.color + "15",
                borderColor: st.color + "30",
              },
            ]}
          >
            <MaterialIcons name={st.icon as any} size={32} color={st.color} />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <ThemedText style={[styles.statusCardLabel, { color: st.color }]}>
                {st.label}
              </ThemedText>
              <ThemedText
                style={[styles.statusCardSub, { color: st.color + "AA" }]}
              >
                {distanceText
                  ? `${distanceText} from patient`
                  : "Active emergency"}
              </ThemedText>
            </View>
          </View>

          {/* Timeline */}
          <View
            style={[
              styles.timelineCard,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <ThemedText
              style={[
                styles.sectionTitle,
                { color: isDark ? "#E2E8F0" : "#1E293B" },
              ]}
            >
              Emergency Progress
            </ThemedText>
            {statusFlow.map((step, i) => {
              const timelineStatus =
                currentStatus === "arrived" ? "at_scene" : currentStatus;
              const stepIdx = statusFlow.indexOf(timelineStatus);
              const done = i <= stepIdx;
              const active = i === stepIdx;
              const meta = STATUS_LABELS[step] || STATUS_LABELS.assigned;
              const col = done ? "#10B981" : isDark ? "#475569" : "#CBD5E1";
              return (
                <View key={step}>
                  <View style={styles.timelineItem}>
                    <View
                      style={[
                        styles.timelineNode,
                        {
                          backgroundColor: done ? "#10B981" : "transparent",
                          borderColor: col,
                        },
                      ]}
                    >
                      {done ? (
                        <MaterialIcons name="check" size={14} color="#FFF" />
                      ) : (
                        <MaterialIcons
                          name={meta.icon as any}
                          size={14}
                          color={col}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1, paddingTop: 2 }}>
                      <ThemedText
                        style={[
                          styles.timelineLabel,
                          {
                            color: done ? "#10B981" : subtleText,
                            fontWeight: active ? "800" : "500",
                          },
                        ]}
                      >
                        {meta.label}
                      </ThemedText>
                    </View>
                    {active && (
                      <View
                        style={[
                          styles.activePulse,
                          { backgroundColor: meta.color + "30" },
                        ]}
                      >
                        <ThemedText
                          style={{
                            color: meta.color,
                            fontSize: 10,
                            fontWeight: "700",
                            fontFamily: Fonts.sans,
                          }}
                        >
                          CURRENT
                        </ThemedText>
                      </View>
                    )}
                  </View>
                  {i < statusFlow.length - 1 && (
                    <View
                      style={[
                        styles.timelineConnector,
                        {
                          backgroundColor:
                            i < stepIdx
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

          {/* Next action */}
          {canUpdate && nextStatus && (
            <View
              style={[
                styles.actionCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Next Step
              </ThemedText>
              <ThemedText style={[styles.actionDesc, { color: subtleText }]}>
                Update the emergency status to:
              </ThemedText>
              <View
                style={[
                  styles.nextBadge,
                  {
                    backgroundColor:
                      (STATUS_LABELS[nextStatus]?.color || "#0EA5E9") + "15",
                  },
                ]}
              >
                <MaterialIcons
                  name={(STATUS_LABELS[nextStatus]?.icon as any) || "update"}
                  size={20}
                  color={STATUS_LABELS[nextStatus]?.color || "#0EA5E9"}
                />
                <ThemedText
                  style={[
                    styles.nextBadgeText,
                    { color: STATUS_LABELS[nextStatus]?.color || "#0EA5E9" },
                  ]}
                >
                  {nextStatus.replace(/_/g, " ").toUpperCase()}
                </ThemedText>
              </View>
              <AppButton
                label={`Update to ${(STATUS_LABELS[nextStatus]?.label || nextStatus).toUpperCase()}`}
                onPress={() => handleStatusUpdate(nextStatus)}
                variant="primary"
                fullWidth
                disabled={updating}
                style={{ marginTop: 12 }}
              />
            </View>
          )}

          {waitingForHospital && (
            <View
              style={[
                styles.actionCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Waiting For Hospital Update
              </ThemedText>
              <ThemedText style={[styles.actionDesc, { color: subtleText }]}>
                Transport is active. Hospital staff will mark At Hospital and
                Completed.
              </ThemedText>
            </View>
          )}

          {/* Patient info */}
          {patientInfo && (
            <View
              style={[
                styles.infoCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[styles.iconCircle, { backgroundColor: "#ECFDF5" }]}
                >
                  <MaterialIcons name="person" size={18} color="#059669" />
                </View>
                <ThemedText
                  style={[
                    styles.sectionTitle,
                    {
                      color: isDark ? "#E2E8F0" : "#1E293B",
                      marginBottom: 0,
                      marginLeft: 10,
                    },
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
              {patientInfo.phone && (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}
                >
                  <View style={styles.infoRow}>
                    <ThemedText
                      style={[styles.infoLabel, { color: subtleText }]}
                    >
                      Phone
                    </ThemedText>
                    <ThemedText style={styles.phoneLink}>
                      {patientInfo.phone}
                    </ThemedText>
                  </View>
                </Pressable>
              )}
              {patientCoords && (
                <View style={styles.infoRow}>
                  <ThemedText style={[styles.infoLabel, { color: subtleText }]}>
                    Location
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.infoValue,
                      { color: isDark ? "#F1F5F9" : "#0F172A", fontSize: 13 },
                    ]}
                  >
                    {formatCoords(
                      patientCoords.latitude,
                      patientCoords.longitude,
                    )}
                  </ThemedText>
                </View>
              )}
            </View>
          )}

          {/* Location tracking toggle */}
          <Pressable
            onPress={() => setLocationTracking(!locationTracking)}
            style={[
              styles.trackingRow,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <MaterialIcons
              name={locationTracking ? "location-on" : "location-off"}
              size={22}
              color={locationTracking ? "#10B981" : "#6B7280"}
            />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText
                style={[
                  styles.trackingLabel,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                {locationTracking
                  ? "Location Sharing On"
                  : "Location Sharing Off"}
              </ThemedText>
              <ThemedText style={[styles.trackingSub, { color: subtleText }]}>
                {locationTracking
                  ? "Patient can see your live position"
                  : "Patient cannot track you"}
              </ThemedText>
            </View>
            <View
              style={[
                styles.togglePill,
                { backgroundColor: locationTracking ? "#10B981" : "#6B7280" },
              ]}
            >
              <View
                style={[
                  styles.toggleKnob,
                  { alignSelf: locationTracking ? "flex-end" : "flex-start" },
                ]}
              />
            </View>
          </Pressable>
        </ScrollView>
      ) : activeTab === "notes" ? (
        /* ═══════════ NOTES TAB ═══════════ */
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.statusScroll}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Existing Notes ────────────────────────── */}
            <View
              style={[
                styles.infoCard,
                { backgroundColor: cardBg, borderColor: cardBorder },
              ]}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[styles.iconCircle, { backgroundColor: "#EFF6FF" }]}
                >
                  <MaterialIcons name="description" size={18} color="#3B82F6" />
                </View>
                <ThemedText
                  style={[
                    styles.sectionTitle,
                    {
                      color: isDark ? "#E2E8F0" : "#1E293B",
                      marginBottom: 0,
                      marginLeft: 10,
                    },
                  ]}
                >
                  Clinical Notes ({medicalNotes.length})
                </ThemedText>
              </View>

              {loadingNotes ? (
                <ActivityIndicator
                  size="small"
                  color={colors.tint}
                  style={{ marginVertical: 16 }}
                />
              ) : medicalNotes.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 20 }}>
                  <MaterialIcons
                    name="note-add"
                    size={40}
                    color={isDark ? "#475569" : "#CBD5E1"}
                  />
                  <ThemedText
                    style={[styles.emptyNoteText, { color: subtleText }]}
                  >
                    No medical notes yet. Add your assessment below.
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
                      style={[styles.noteItem, { borderColor: cardBorder }]}
                    >
                      <View style={styles.noteHeader}>
                        <View
                          style={[
                            styles.noteTypeBadge,
                            { backgroundColor: meta.color + "18" },
                          ]}
                        >
                          <MaterialIcons
                            name={meta.icon as any}
                            size={14}
                            color={meta.color}
                          />
                          <ThemedText
                            style={[styles.noteTypeText, { color: meta.color }]}
                          >
                            {meta.label}
                          </ThemedText>
                        </View>
                        <ThemedText
                          style={[styles.noteTime, { color: subtleText }]}
                        >
                          {formatNoteTime(n.created_at)}
                        </ThemedText>
                      </View>
                      <ThemedText
                        style={[
                          styles.noteContent,
                          { color: isDark ? "#E2E8F0" : "#1E293B" },
                        ]}
                      >
                        {n.content}
                      </ThemedText>
                      {n.vitals && Object.keys(n.vitals).length > 0 && (
                        <View style={styles.vitalsRow}>
                          {n.vitals.blood_pressure ? (
                            <View
                              style={[
                                styles.vitalChip,
                                {
                                  backgroundColor: isDark
                                    ? "#1E293B"
                                    : "#F1F5F9",
                                },
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.vitalLabel,
                                  { color: subtleText },
                                ]}
                              >
                                BP
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.vitalValue,
                                  { color: isDark ? "#E2E8F0" : "#0F172A" },
                                ]}
                              >
                                {n.vitals.blood_pressure}
                              </ThemedText>
                            </View>
                          ) : null}
                          {n.vitals.heart_rate ? (
                            <View
                              style={[
                                styles.vitalChip,
                                {
                                  backgroundColor: isDark
                                    ? "#1E293B"
                                    : "#F1F5F9",
                                },
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.vitalLabel,
                                  { color: subtleText },
                                ]}
                              >
                                HR
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.vitalValue,
                                  { color: isDark ? "#E2E8F0" : "#0F172A" },
                                ]}
                              >
                                {n.vitals.heart_rate} bpm
                              </ThemedText>
                            </View>
                          ) : null}
                          {n.vitals.spo2 ? (
                            <View
                              style={[
                                styles.vitalChip,
                                {
                                  backgroundColor: isDark
                                    ? "#1E293B"
                                    : "#F1F5F9",
                                },
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.vitalLabel,
                                  { color: subtleText },
                                ]}
                              >
                                SpO₂
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.vitalValue,
                                  { color: isDark ? "#E2E8F0" : "#0F172A" },
                                ]}
                              >
                                {n.vitals.spo2}%
                              </ThemedText>
                            </View>
                          ) : null}
                          {n.vitals.temperature ? (
                            <View
                              style={[
                                styles.vitalChip,
                                {
                                  backgroundColor: isDark
                                    ? "#1E293B"
                                    : "#F1F5F9",
                                },
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.vitalLabel,
                                  { color: subtleText },
                                ]}
                              >
                                Temp
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.vitalValue,
                                  { color: isDark ? "#E2E8F0" : "#0F172A" },
                                ]}
                              >
                                {n.vitals.temperature}°C
                              </ThemedText>
                            </View>
                          ) : null}
                          {n.vitals.respiratory_rate ? (
                            <View
                              style={[
                                styles.vitalChip,
                                {
                                  backgroundColor: isDark
                                    ? "#1E293B"
                                    : "#F1F5F9",
                                },
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.vitalLabel,
                                  { color: subtleText },
                                ]}
                              >
                                RR
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.vitalValue,
                                  { color: isDark ? "#E2E8F0" : "#0F172A" },
                                ]}
                              >
                                {n.vitals.respiratory_rate}/min
                              </ThemedText>
                            </View>
                          ) : null}
                          {n.vitals.consciousness_level ? (
                            <View
                              style={[
                                styles.vitalChip,
                                {
                                  backgroundColor: isDark
                                    ? "#1E293B"
                                    : "#F1F5F9",
                                },
                              ]}
                            >
                              <ThemedText
                                style={[
                                  styles.vitalLabel,
                                  { color: subtleText },
                                ]}
                              >
                                AVPU
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.vitalValue,
                                  { color: isDark ? "#E2E8F0" : "#0F172A" },
                                ]}
                              >
                                {n.vitals.consciousness_level}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      )}
                      {n.author_name && (
                        <ThemedText
                          style={[styles.noteAuthor, { color: subtleText }]}
                        >
                          — {n.author_name} ({n.author_role})
                        </ThemedText>
                      )}
                    </View>
                  );
                })
              )}
            </View>

            {/* ── Add Note Form ─────────────────────────── */}
            {!["completed", "cancelled"].includes(currentStatus) && (
              <View
                style={[
                  styles.infoCard,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <View style={styles.cardHeader}>
                  <View
                    style={[styles.iconCircle, { backgroundColor: "#F0FDF4" }]}
                  >
                    <MaterialIcons name="edit-note" size={18} color="#10B981" />
                  </View>
                  <ThemedText
                    style={[
                      styles.sectionTitle,
                      {
                        color: isDark ? "#E2E8F0" : "#1E293B",
                        marginBottom: 0,
                        marginLeft: 10,
                      },
                    ]}
                  >
                    Add Clinical Note
                  </ThemedText>
                </View>

                {/* Note Type Selector */}
                <ThemedText style={[styles.formLabel, { color: subtleText }]}>
                  NOTE TYPE
                </ThemedText>
                <View style={styles.noteTypeRow}>
                  {(
                    [
                      "initial_assessment",
                      "transport_observation",
                      "general",
                    ] as NoteType[]
                  ).map((t) => {
                    const meta = NOTE_TYPE_LABELS[t];
                    const selected = noteType === t;
                    return (
                      <Pressable
                        key={t}
                        onPress={() => setNoteType(t)}
                        style={[
                          styles.noteTypeChip,
                          {
                            borderColor: selected ? meta.color : cardBorder,
                            backgroundColor: selected
                              ? meta.color + "15"
                              : "transparent",
                          },
                        ]}
                      >
                        <MaterialIcons
                          name={meta.icon as any}
                          size={14}
                          color={selected ? meta.color : subtleText}
                        />
                        <ThemedText
                          style={[
                            styles.noteTypeChipText,
                            { color: selected ? meta.color : subtleText },
                          ]}
                        >
                          {meta.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Content Input */}
                <ThemedText style={[styles.formLabel, { color: subtleText }]}>
                  OBSERVATION
                </ThemedText>
                <TextInput
                  style={[
                    styles.noteInput,
                    {
                      backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                      borderColor: cardBorder,
                      color: isDark ? "#E2E8F0" : "#0F172A",
                    },
                  ]}
                  value={noteContent}
                  onChangeText={setNoteContent}
                  placeholder="Describe patient condition, symptoms, observations..."
                  placeholderTextColor={subtleText}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  maxLength={2000}
                />

                {/* Vitals Toggle */}
                <Pressable
                  onPress={() => setShowVitals(!showVitals)}
                  style={[styles.vitalsToggle, { borderColor: cardBorder }]}
                >
                  <MaterialIcons
                    name="monitor-heart"
                    size={18}
                    color="#0EA5E9"
                  />
                  <ThemedText
                    style={[
                      styles.vitalsToggleText,
                      { color: isDark ? "#E2E8F0" : "#1E293B" },
                    ]}
                  >
                    {showVitals ? "Hide Vitals" : "Add Vitals (Optional)"}
                  </ThemedText>
                  <MaterialIcons
                    name={showVitals ? "expand-less" : "expand-more"}
                    size={20}
                    color={subtleText}
                  />
                </Pressable>

                {showVitals && (
                  <View style={styles.vitalsGrid}>
                    <View style={styles.vitalInputRow}>
                      <View style={styles.vitalInputWrap}>
                        <ThemedText
                          style={[
                            styles.vitalInputLabel,
                            { color: subtleText },
                          ]}
                        >
                          Blood Pressure
                        </ThemedText>
                        <TextInput
                          style={[
                            styles.vitalInputField,
                            {
                              backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                              borderColor: cardBorder,
                              color: isDark ? "#E2E8F0" : "#0F172A",
                            },
                          ]}
                          value={vitals.blood_pressure || ""}
                          onChangeText={(v) =>
                            setVitals((p) => ({ ...p, blood_pressure: v }))
                          }
                          placeholder="120/80"
                          placeholderTextColor={subtleText}
                          maxLength={10}
                        />
                      </View>
                      <View style={styles.vitalInputWrap}>
                        <ThemedText
                          style={[
                            styles.vitalInputLabel,
                            { color: subtleText },
                          ]}
                        >
                          Heart Rate
                        </ThemedText>
                        <TextInput
                          style={[
                            styles.vitalInputField,
                            {
                              backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                              borderColor: cardBorder,
                              color: isDark ? "#E2E8F0" : "#0F172A",
                            },
                          ]}
                          value={vitals.heart_rate?.toString() || ""}
                          onChangeText={(v) =>
                            setVitals((p) => ({
                              ...p,
                              heart_rate: v ? Number(v) : undefined,
                            }))
                          }
                          placeholder="72"
                          placeholderTextColor={subtleText}
                          keyboardType="numeric"
                          maxLength={4}
                        />
                      </View>
                    </View>
                    <View style={styles.vitalInputRow}>
                      <View style={styles.vitalInputWrap}>
                        <ThemedText
                          style={[
                            styles.vitalInputLabel,
                            { color: subtleText },
                          ]}
                        >
                          SpO₂ %
                        </ThemedText>
                        <TextInput
                          style={[
                            styles.vitalInputField,
                            {
                              backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                              borderColor: cardBorder,
                              color: isDark ? "#E2E8F0" : "#0F172A",
                            },
                          ]}
                          value={vitals.spo2?.toString() || ""}
                          onChangeText={(v) =>
                            setVitals((p) => ({
                              ...p,
                              spo2: v ? Number(v) : undefined,
                            }))
                          }
                          placeholder="98"
                          placeholderTextColor={subtleText}
                          keyboardType="numeric"
                          maxLength={4}
                        />
                      </View>
                      <View style={styles.vitalInputWrap}>
                        <ThemedText
                          style={[
                            styles.vitalInputLabel,
                            { color: subtleText },
                          ]}
                        >
                          Temp °C
                        </ThemedText>
                        <TextInput
                          style={[
                            styles.vitalInputField,
                            {
                              backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                              borderColor: cardBorder,
                              color: isDark ? "#E2E8F0" : "#0F172A",
                            },
                          ]}
                          value={vitals.temperature?.toString() || ""}
                          onChangeText={(v) =>
                            setVitals((p) => ({
                              ...p,
                              temperature: v ? Number(v) : undefined,
                            }))
                          }
                          placeholder="36.6"
                          placeholderTextColor={subtleText}
                          keyboardType="decimal-pad"
                          maxLength={5}
                        />
                      </View>
                    </View>
                    <View style={styles.vitalInputRow}>
                      <View style={styles.vitalInputWrap}>
                        <ThemedText
                          style={[
                            styles.vitalInputLabel,
                            { color: subtleText },
                          ]}
                        >
                          Resp. Rate
                        </ThemedText>
                        <TextInput
                          style={[
                            styles.vitalInputField,
                            {
                              backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                              borderColor: cardBorder,
                              color: isDark ? "#E2E8F0" : "#0F172A",
                            },
                          ]}
                          value={vitals.respiratory_rate?.toString() || ""}
                          onChangeText={(v) =>
                            setVitals((p) => ({
                              ...p,
                              respiratory_rate: v ? Number(v) : undefined,
                            }))
                          }
                          placeholder="16"
                          placeholderTextColor={subtleText}
                          keyboardType="numeric"
                          maxLength={3}
                        />
                      </View>
                      <View style={styles.vitalInputWrap}>
                        <ThemedText
                          style={[
                            styles.vitalInputLabel,
                            { color: subtleText },
                          ]}
                        >
                          AVPU Level
                        </ThemedText>
                        <TextInput
                          style={[
                            styles.vitalInputField,
                            {
                              backgroundColor: isDark ? "#1E293B" : "#F8FAFC",
                              borderColor: cardBorder,
                              color: isDark ? "#E2E8F0" : "#0F172A",
                            },
                          ]}
                          value={vitals.consciousness_level || ""}
                          onChangeText={(v) =>
                            setVitals((p) => ({ ...p, consciousness_level: v }))
                          }
                          placeholder="Alert"
                          placeholderTextColor={subtleText}
                          maxLength={20}
                        />
                      </View>
                    </View>
                  </View>
                )}

                {/* Submit */}
                <AppButton
                  label={submittingNote ? "Saving..." : "Save Medical Note"}
                  onPress={handleSubmitNote}
                  variant="primary"
                  fullWidth
                  disabled={submittingNote || !noteContent.trim()}
                  style={{ marginTop: 14 }}
                />
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontWeight: "800", fontFamily: Fonts.sans },
  headerSub: { fontSize: 12, fontWeight: "600", fontFamily: Fonts.sans },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  // Tabs
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#0EA5E9",
  },
  tabLabel: { fontSize: 13, fontWeight: "600", fontFamily: Fonts.sans },

  // Map tab
  mapTabWrap: { flex: 1, position: "relative", overflow: "hidden" as any },
  mapFull: { flex: 1, width: "100%" as any, minHeight: 350 },
  noMapWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    minHeight: 300,
  },
  noMapText: { fontSize: 14, fontFamily: Fonts.sans },

  mapOverlay: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    maxWidth: 360,
  },
  overlayRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  overlayText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: Fonts.sans,
  },
  navOverlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  navOverlayText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },

  mapLegend: {
    position: "absolute",
    bottom: 80,
    alignSelf: "center",
    flexDirection: "row",
    gap: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 13, fontFamily: Fonts.sans },

  floatingBtn: {
    position: "absolute",
    bottom: 20,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  floatingBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },

  // Status tab
  statusScroll: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    alignSelf: "center" as any,
    width: "100%" as any,
  },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  statusCardLabel: { fontSize: 17, fontWeight: "800", fontFamily: Fonts.sans },
  statusCardSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },

  timelineCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    marginBottom: 14,
  },

  timelineItem: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  timelineNode: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  timelineLabel: { fontSize: 14, fontFamily: Fonts.sans },
  timelineConnector: { width: 2, height: 16, marginLeft: 13, marginBottom: 6 },
  activePulse: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },

  actionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  actionDesc: { fontSize: 13, fontFamily: Fonts.sans, marginBottom: 8 },
  nextBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  nextBadgeText: { fontSize: 15, fontWeight: "700", fontFamily: Fonts.sans },

  infoCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  infoRow: { marginBottom: 10 },
  infoLabel: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: { fontSize: 14, fontWeight: "600", fontFamily: Fonts.sans },
  phoneLink: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    color: "#0EA5E9",
    textDecorationLine: "underline",
  },

  trackingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  trackingLabel: { fontSize: 14, fontWeight: "600", fontFamily: Fonts.sans },
  trackingSub: { fontSize: 13, fontFamily: Fonts.sans, marginTop: 2 },
  togglePill: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: "center",
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFF",
  },

  // Medical notes styles
  emptyNoteText: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    marginTop: 8,
    textAlign: "center",
  },
  noteItem: { borderTopWidth: 1, paddingTop: 12, marginTop: 12 },
  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  noteTypeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  noteTypeText: { fontSize: 12, fontWeight: "600", fontFamily: Fonts.sans },
  noteTime: { fontSize: 11, fontFamily: Fonts.sans },
  noteContent: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    marginBottom: 6,
  },
  noteAuthor: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontStyle: "italic",
    marginTop: 4,
  },
  vitalsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  vitalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  vitalLabel: { fontSize: 11, fontWeight: "600", fontFamily: Fonts.sans },
  vitalValue: { fontSize: 12, fontWeight: "700", fontFamily: Fonts.sans },
  formLabel: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 14,
  },
  noteTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  noteTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  noteTypeChipText: { fontSize: 12, fontWeight: "600", fontFamily: Fonts.sans },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontFamily: Fonts.sans,
    minHeight: 100,
    lineHeight: 20,
  },
  vitalsToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: 1,
  },
  vitalsToggleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: Fonts.sans,
  },
  vitalsGrid: { gap: 8, marginTop: 8 },
  vitalInputRow: { flexDirection: "row", gap: 10 },
  vitalInputWrap: { flex: 1 },
  vitalInputLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    marginBottom: 4,
  },
  vitalInputField: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
});
