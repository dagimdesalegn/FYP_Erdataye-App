import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
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
    formatCoords,
    parsePostGISPoint,
} from "@/utils/emergency";
import { supabaseAdmin } from "@/utils/supabase";

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
  const [driverCoords, setDriverCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

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

        // Load patient info
        const pid = asgn.emergency_requests?.patient_id || "";
        if (pid) {
          const { info } = await getPatientInfo(pid);
          if (info) setPatientInfo(info);
        }

        // Load driver's ambulance location
        const { ambulanceId } = await getDriverAmbulanceId(user.id);
        if (ambulanceId) {
          const { data } = await supabaseAdmin
            .from("ambulances")
            .select("last_known_location")
            .eq("id", ambulanceId)
            .maybeSingle();
          if (data?.last_known_location) {
            const parsed = parsePostGISPoint(data.last_known_location);
            if (parsed) setDriverCoords(parsed);
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
      <LoadingModal
        visible
        colorScheme={colorScheme}
        message="Loading assignment..."
      />
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

  // Map HTML
  const mapHtml =
    driverCoords && patientCoords
      ? buildDriverPatientMapHtml(
          driverCoords.latitude,
          driverCoords.longitude,
          patientCoords.latitude,
          patientCoords.longitude,
        )
      : patientCoords
        ? buildMapHtml(patientCoords.latitude, patientCoords.longitude, 16)
        : null;

  const med = patientInfo?.medical_profiles?.[0];

  // ─── UI ───────────────────────────────────────────────────
  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const subtleText = colors.textMuted;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LoadingModal
        visible={processing}
        colorScheme={colorScheme}
        message="Processing..."
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 16) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── X Close Button ───────────────────────────── */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.closeBtn,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.12)"
                : "rgba(0,0,0,0.06)",
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          <MaterialIcons
            name="close"
            size={20}
            color={isDark ? "#E2E8F0" : "#334155"}
          />
        </Pressable>

        {/* ── Severity Banner ───────────────────────────── */}
        <View style={[styles.severityBanner, { backgroundColor: sev.bg }]}>
          <MaterialIcons name={sev.icon} size={28} color={sev.color} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <ThemedText style={[styles.sevLabel, { color: sev.color }]}>
              {sev.label} EMERGENCY
            </ThemedText>
            <ThemedText style={[styles.sevSub, { color: sev.color + "AA" }]}>
              {new Date(emergency?.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {distanceText ? `  •  ${distanceText} away` : ""}
            </ThemedText>
          </View>
        </View>

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
                <Pressable
                  onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}
                >
                  <ThemedText style={styles.phoneLink}>
                    {patientInfo.phone}
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

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

            {/* View Full Medical Profile Button */}
            {patientInfo.id && (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/driver-patient-info" as any,
                    params: { patientId: patientInfo.id },
                  })
                }
                style={({ pressed }) => [
                  styles.viewProfileBtn,
                  {
                    backgroundColor: isDark ? "#0C4A6E" : "#E0F2FE",
                    borderColor: isDark ? "#0369A1" : "#7DD3FC",
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <MaterialIcons
                  name="medical-services"
                  size={16}
                  color="#0EA5E9"
                />
                <ThemedText style={styles.viewProfileBtnText}>
                  View Medical Profile
                </ThemedText>
                <MaterialIcons name="chevron-right" size={18} color="#0EA5E9" />
              </Pressable>
            )}
          </View>
        )}

        {/* ── Medical Profile Summary Card ──────────────── */}
        {med && (
          <View
            style={[
              styles.medicalCard,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: "#FEE2E2" }]}>
                <MaterialIcons
                  name="medical-services"
                  size={20}
                  color="#DC2626"
                />
              </View>
              <ThemedText
                style={[
                  styles.cardHeading,
                  { color: isDark ? "#E2E8F0" : "#1E293B" },
                ]}
              >
                Medical Profile
              </ThemedText>
            </View>

            {/* Quick stats row */}
            <View style={styles.medicalGrid}>
              {med.blood_type ? (
                <View
                  style={[
                    styles.medicalGridItem,
                    { backgroundColor: isDark ? "#450A0A" : "#FEF2F2" },
                  ]}
                >
                  <View style={styles.bloodBadge}>
                    <ThemedText style={styles.bloodText}>
                      {med.blood_type}
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={[styles.medicalGridLabel, { color: subtleText }]}
                  >
                    Blood Type
                  </ThemedText>
                </View>
              ) : null}

              {med.allergies ? (
                <View
                  style={[
                    styles.medicalGridItem,
                    { backgroundColor: isDark ? "#451A03" : "#FFFBEB" },
                  ]}
                >
                  <MaterialIcons name="warning" size={22} color="#D97706" />
                  <ThemedText
                    style={[
                      styles.medicalGridValue,
                      { color: isDark ? "#FBBF24" : "#92400E" },
                    ]}
                    numberOfLines={2}
                  >
                    {med.allergies}
                  </ThemedText>
                  <ThemedText
                    style={[styles.medicalGridLabel, { color: subtleText }]}
                  >
                    Allergies
                  </ThemedText>
                </View>
              ) : null}
            </View>

            {med.medical_conditions ? (
              <View
                style={[
                  styles.medicalConditionBox,
                  {
                    backgroundColor: isDark ? "#0F172A" : "#F0F9FF",
                    borderColor: isDark ? "#1E3A5F" : "#BAE6FD",
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <MaterialIcons name="healing" size={16} color="#0284C7" />
                  <ThemedText
                    style={[
                      styles.infoLabel,
                      { color: "#0284C7", marginBottom: 0 },
                    ]}
                  >
                    Conditions
                  </ThemedText>
                </View>
                <ThemedText
                  style={[
                    styles.infoValue,
                    { color: isDark ? "#F1F5F9" : "#0F172A" },
                  ]}
                >
                  {med.medical_conditions}
                </ThemedText>
              </View>
            ) : null}

            {med.emergency_contact_name ? (
              <View
                style={[
                  styles.emergencyContactBox,
                  {
                    backgroundColor: isDark ? "#0F172A" : "#F8FAFC",
                    borderColor: cardBorder,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  <MaterialIcons
                    name="contact-phone"
                    size={16}
                    color="#059669"
                  />
                  <ThemedText
                    style={[
                      styles.infoLabel,
                      { color: "#059669", marginBottom: 0 },
                    ]}
                  >
                    Emergency Contact
                  </ThemedText>
                </View>
                <ThemedText
                  style={[
                    styles.infoValue,
                    { color: isDark ? "#F1F5F9" : "#0F172A" },
                  ]}
                >
                  {med.emergency_contact_name}
                </ThemedText>
                {med.emergency_contact_phone ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(`tel:${med.emergency_contact_phone}`)
                    }
                  >
                    <ThemedText style={[styles.phoneLink, { marginTop: 4 }]}>
                      {med.emergency_contact_phone}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
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
        <View style={styles.bottomInfo}>
          <MaterialIcons name="flash-on" size={16} color="#0EA5E9" />
          <ThemedText
            style={[
              styles.bottomTitle,
              { color: isDark ? "#E2E8F0" : "#0F172A" },
            ]}
            numberOfLines={1}
          >
            {patientInfo?.full_name
              ? `${patientInfo.full_name} needs help`
              : "Incoming emergency"}
          </ThemedText>
          {distanceText ? (
            <View style={styles.distChip}>
              <ThemedText style={styles.distChipText}>
                {distanceText}
              </ThemedText>
            </View>
          ) : null}
        </View>

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
            <MaterialIcons name="close" size={18} color="#DC2626" />
            <ThemedText style={styles.declineBtnText}>Decline</ThemedText>
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
              <MaterialIcons name="check" size={18} color="#FFF" />
              <ThemedText style={styles.acceptBtnText}>Accept & Go</ThemedText>
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

  // View Profile button
  viewProfileBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 12,
    gap: 8,
  },
  viewProfileBtnText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    color: "#0EA5E9",
    flex: 1,
    textAlign: "center",
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
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    paddingTop: 12,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 14,
  },
  bottomInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  bottomTitle: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    flex: 1,
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
    gap: 6,
  },
  declineBtnText: {
    color: "#DC2626",
    fontWeight: "700",
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  acceptWrapper: {
    flex: 2,
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
});
