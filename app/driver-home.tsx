import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppButton } from "@/components/app-button";
import { AppHeader } from "@/components/app-header";
import { useAppState } from "@/components/app-state";
import { LoadingModal } from "@/components/loading-modal";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { signOut } from "@/utils/auth";
import {
    getDriverAmbulanceDetails,
    getDriverAmbulanceId,
    getDriverAssignment,
    getDriverHistory,
    getDriverStats,
    sendLocationUpdate,
    subscribeToAssignments,
    toggleAmbulanceAvailability,
    type AmbulanceDetails,
} from "@/utils/driver";
import { getUserProfile, type UserProfile } from "@/utils/profile";
import { useRouter } from "expo-router";

/**
 * Driver Home Screen - Status & Incoming Assignments
 */
export default function DriverHomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const { user, setUser } = useAppState();
  const { showAlert, showError, showConfirm, showSuccess } = useModal();

  const confirmAvailabilityChange = (newVal: boolean) =>
    new Promise<boolean>((resolve) => {
      showConfirm(
        newVal ? "Go Available" : "Go Offline",
        newVal
          ? "You will start receiving emergency assignments and share live location updates. Continue?"
          : "You will stop receiving new emergency assignments. Continue?",
        () => resolve(true),
        () => resolve(false),
      );
    });

  const [isAvailable, setIsAvailable] = useState(false);
  const [loading] = useState(false);
  const [hasAssignment, setHasAssignment] = useState(false);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [ambulanceId, setAmbulanceId] = useState<string | null>(null);
  const [ambulanceDetails, setAmbulanceDetails] =
    useState<AmbulanceDetails | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);

  // Completed history
  const [history, setHistory] = useState<any[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Profile modal
  const [profileVisible, setProfileVisible] = useState(false);
  const [driverProfile, setDriverProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Load driver's ambulance ID and details
  useEffect(() => {
    if (!user) return;

    const loadAmbulance = async () => {
      const { ambulanceId: id, error } = await getDriverAmbulanceId(user.id);
      if (error) {
        console.error("Failed to load driver ambulance:", error);
        return;
      }
      setAmbulanceId(id);

      // Also load full details
      const { ambulance } = await getDriverAmbulanceDetails(user.id);
      if (ambulance) setAmbulanceDetails(ambulance);
    };

    loadAmbulance();

    // Load stats
    const loadStats = async () => {
      const { active, completed } = await getDriverStats(user.id);
      setActiveCount(active);
      setCompletedCount(completed);
    };
    loadStats();

    // Load completed history
    const loadHistory = async () => {
      const { history: items } = await getDriverHistory(user.id);
      setHistory(items);
    };
    loadHistory();
  }, [user]);

  // Check for existing assignment
  useEffect(() => {
    if (!user) return;

    const checkAssignment = async () => {
      const { assignment, error } = await getDriverAssignment(user.id);
      if (!error && assignment) {
        setHasAssignment(true);
        setAssignmentCount(1);
      } else {
        // No active assignment — clear stale state
        setHasAssignment(false);
        setAssignmentCount(0);
      }
    };

    checkAssignment();

    // Re-check every 10s to clear stale completed assignments
    const interval = setInterval(checkAssignment, 10000);
    return () => clearInterval(interval);
  }, [user]);

  // Subscribe to new assignments
  useEffect(() => {
    if (!user || !isAvailable) return;

    const unsubscribe = subscribeToAssignments(user.id, async (_assignment) => {
      // Validate the assignment is truly active before showing
      const { assignment: verified } = await getDriverAssignment(user.id);
      if (verified) {
        setHasAssignment(true);
        setAssignmentCount(1);
        showAlert("New Emergency", "You have a new emergency assignment");
      }
    });

    return unsubscribe;
  }, [user, isAvailable, showAlert]);

  // Send location updates when available
  useEffect(() => {
    if (!isAvailable || !user || !ambulanceId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startLocationTracking = async () => {
      try {
        // Show pre-permission explanation first
        showAlert(
          "🚗 Location Tracking Required",
          "Patients need to see your real-time location to know when help arrives. This is critical for emergency response.",
        );

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          showError(
            "Location Tracking Disabled",
            "Enable location access in your device settings to track ambulance location.",
          );
          setIsAvailable(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync();
        await sendLocationUpdate(
          ambulanceId,
          location.coords.latitude,
          location.coords.longitude,
        );

        intervalId = setInterval(async () => {
          const currentLocation = await Location.getCurrentPositionAsync();
          await sendLocationUpdate(
            ambulanceId,
            currentLocation.coords.latitude,
            currentLocation.coords.longitude,
          );
        }, 10000);

        console.log("Location tracking started");
      } catch (error) {
        console.error("Error starting location tracking:", error);
      }
    };

    startLocationTracking();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAvailable, user, ambulanceId, showError, showAlert]);

  const handleLogout = async () => {
    setIsAvailable(false);
    if (ambulanceId) await toggleAmbulanceAvailability(ambulanceId, false);
    const { error } = await signOut();
    if (!error) {
      setUser(null);
      router.replace("/");
    } else {
      showError("Logout Failed", "Failed to logout");
    }
  };

  const handleViewAssignment = async () => {
    // Verify the assignment is still active before navigating
    if (!user) return;
    const { assignment } = await getDriverAssignment(user.id);
    if (!assignment) {
      // Assignment was completed/cancelled — clear the UI
      setHasAssignment(false);
      setAssignmentCount(0);
      // Also refresh stats
      const { active, completed } = await getDriverStats(user.id);
      setActiveCount(active);
      setCompletedCount(completed);
      const { history: items } = await getDriverHistory(user.id);
      setHistory(items);
      return;
    }
    router.push("/driver-emergency" as any);
  };

  const handleProfilePress = async () => {
    setProfileVisible(true);
    if (!user?.id || driverProfile) return;
    setProfileLoading(true);
    try {
      const { profile } = await getUserProfile(user.id);
      if (profile) setDriverProfile(profile);
    } catch (e) {
      console.error("Error loading driver profile:", e);
    } finally {
      setProfileLoading(false);
    }
  };

  // --- Profile Info Row ---
  const InfoRow = ({
    icon,
    label,
    value,
  }: {
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    value: string;
  }) => (
    <View style={styles.infoRow}>
      <MaterialIcons
        name={icon}
        size={20}
        color={isDark ? "#0EA5E9" : "#0284C7"}
        style={{ marginRight: 12 }}
      />
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.infoLabel}>{label}</ThemedText>
        <ThemedText style={styles.infoValue}>{value || "—"}</ThemedText>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LoadingModal
        visible={loading}
        colorScheme={colorScheme}
        message="Loading..."
      />

      {/* App Header – project name top-left, theme toggle + profile icon top-right */}
      <AppHeader
        title="Erdataya Ambulance"
        onProfilePress={handleProfilePress}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Card */}
        <ThemedView
          style={[
            styles.welcomeCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
        >
          <View style={styles.welcomeRow}>
            <View
              style={[styles.avatarCircle, isDark && styles.avatarCircleDark]}
            >
              <MaterialIcons
                name="local-shipping"
                size={28}
                color={isDark ? "#0EA5E9" : "#0284C7"}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <ThemedText style={styles.greeting}>
                Welcome, {user?.fullName || "Driver"}
              </ThemedText>
              <ThemedText style={styles.email}>{user?.phone}</ThemedText>
            </View>
          </View>
        </ThemedView>

        {/* Status Card */}
        <ThemedView
          style={[
            styles.card,
            styles.statusCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
        >
          <ThemedText style={styles.cardTitle}>Driver Status</ThemedText>

          <Pressable
            onPress={async () => {
              const newVal = !isAvailable;

              const ok = await confirmAvailabilityChange(newVal);
              if (!ok) return;

              setIsAvailable(newVal);

              if (ambulanceId) {
                const { error } = await toggleAmbulanceAvailability(
                  ambulanceId,
                  newVal,
                );
                if (error) {
                  console.warn("Failed to sync availability:", error);
                  setIsAvailable(!newVal);
                  showError(
                    "Status Update Failed",
                    "Could not update ambulance availability. Please try again.",
                  );
                  return;
                }
              }

              showSuccess(
                "Status Updated",
                newVal
                  ? "You are now available for emergency assignments."
                  : "You are now offline and will not receive new assignments.",
              );
            }}
            style={[
              styles.statusToggle,
              {
                backgroundColor: isAvailable ? "#10B981" : "#6B7280",
              },
            ]}
          >
            <MaterialIcons
              name={isAvailable ? "check-circle" : "radio-button-unchecked"}
              size={32}
              color="#fff"
            />
            <View style={{ marginLeft: 12 }}>
              <ThemedText style={styles.statusLabel}>
                {isAvailable ? "Available" : "Offline"}
              </ThemedText>
              <ThemedText style={styles.statusSubtitle}>
                {isAvailable ? "Ready to receive calls" : "Not receiving calls"}
              </ThemedText>
            </View>
          </Pressable>
        </ThemedView>

        {/* Assignment Alert */}
        {hasAssignment && (
          <ThemedView style={[styles.card, styles.alertCard]}>
            <View style={styles.alertHeader}>
              <MaterialIcons name="priority-high" size={28} color="#DC2626" />
              <ThemedText style={styles.alertTitle}>New Assignment!</ThemedText>
            </View>
            <ThemedText style={styles.alertSubtitle}>
              You have {assignmentCount} incoming emergency
              {assignmentCount > 1 ? "s" : ""}
            </ThemedText>
            <AppButton
              label="View Assignment"
              onPress={handleViewAssignment}
              variant="primary"
              fullWidth
              style={{ marginTop: 12 }}
            />
          </ThemedView>
        )}

        {/* Quick Stats */}
        <View style={styles.statsGrid}>
          <ThemedView
            style={[
              styles.statCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
              },
            ]}
          >
            <MaterialIcons name="local-shipping" size={28} color="#0EA5E9" />
            <ThemedText style={styles.statNumber}>{activeCount}</ThemedText>
            <ThemedText style={styles.statLabel}>Active</ThemedText>
          </ThemedView>

          <ThemedView
            style={[
              styles.statCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
              },
            ]}
          >
            <MaterialIcons name="check-circle" size={28} color="#10B981" />
            <ThemedText style={styles.statNumber}>{completedCount}</ThemedText>
            <ThemedText style={styles.statLabel}>Completed</ThemedText>
          </ThemedView>

          <ThemedView
            style={[
              styles.statCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
              },
            ]}
          >
            <MaterialIcons name="schedule" size={28} color="#F59E0B" />
            <ThemedText style={styles.statNumber}>
              {activeCount + completedCount}
            </ThemedText>
            <ThemedText style={styles.statLabel}>Total</ThemedText>
          </ThemedView>
        </View>

        {/* Completed History */}
        <ThemedView
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
            },
          ]}
        >
          <Pressable
            onPress={() => setHistoryExpanded(!historyExpanded)}
            style={styles.historyHeader}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <MaterialIcons
                name="history"
                size={22}
                color={isDark ? "#10B981" : "#059669"}
              />
              <ThemedText
                style={[styles.cardTitle, { marginBottom: 0, marginLeft: 8 }]}
              >
                Completed History
              </ThemedText>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View
                style={[
                  styles.historyBadge,
                  { backgroundColor: isDark ? "#064E3B" : "#D1FAE5" },
                ]}
              >
                <ThemedText
                  style={[
                    styles.historyBadgeText,
                    { color: isDark ? "#6EE7B7" : "#059669" },
                  ]}
                >
                  {history.length}
                </ThemedText>
              </View>
              <MaterialIcons
                name={historyExpanded ? "expand-less" : "expand-more"}
                size={24}
                color={isDark ? "#9CA3AF" : "#6B7280"}
              />
            </View>
          </Pressable>

          {historyExpanded && (
            <View style={{ marginTop: 12 }}>
              {history.length === 0 ? (
                <ThemedText style={styles.historyEmpty}>
                  No completed emergencies yet
                </ThemedText>
              ) : (
                history.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.historyItem,
                      { borderLeftColor: isDark ? "#10B981" : "#059669" },
                    ]}
                  >
                    <View style={styles.historyItemTop}>
                      <View
                        style={[
                          styles.historyTypeBadge,
                          { backgroundColor: isDark ? "#1E3A5F" : "#DBEAFE" },
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.historyTypeText,
                            { color: isDark ? "#60A5FA" : "#2563EB" },
                          ]}
                        >
                          {item.emergency_type || "Emergency"}
                        </ThemedText>
                      </View>
                      <ThemedText style={styles.historyDate}>
                        {item.updated_at
                          ? new Date(item.updated_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )
                          : "—"}
                      </ThemedText>
                    </View>
                    {item.description ? (
                      <ThemedText style={styles.historyDesc} numberOfLines={2}>
                        {item.description}
                      </ThemedText>
                    ) : null}
                    <View style={styles.historyMeta}>
                      <MaterialIcons
                        name="access-time"
                        size={14}
                        color={isDark ? "#9CA3AF" : "#6B7280"}
                      />
                      <ThemedText style={styles.historyMetaText}>
                        {item.created_at
                          ? new Date(item.created_at).toLocaleTimeString(
                              "en-US",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )
                          : "—"}
                      </ThemedText>
                      <MaterialIcons
                        name="check-circle"
                        size={14}
                        color="#10B981"
                        style={{ marginLeft: 12 }}
                      />
                      <ThemedText
                        style={[styles.historyMetaText, { color: "#10B981" }]}
                      >
                        Completed
                      </ThemedText>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
        </ThemedView>

        {/* Sign Out */}
        <AppButton
          label="Sign Out"
          onPress={handleLogout}
          variant="secondary"
          fullWidth
          style={{ marginTop: 8 }}
        />
      </ScrollView>

      {/* ===== Driver Profile Modal (read-only) ===== */}
      <Modal
        visible={profileVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setProfileVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
              },
            ]}
          >
            {/* Close button top-right of the modal card */}
            <Pressable
              onPress={() => setProfileVisible(false)}
              style={[
                styles.modalCloseBtn,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                },
              ]}
            >
              <MaterialIcons name="close" size={20} color={colors.text} />
            </Pressable>

            {/* Avatar */}
            <View style={{ alignItems: "center", marginBottom: 20 }}>
              <View
                style={[
                  styles.profileAvatar,
                  isDark ? styles.profileAvatarDark : styles.profileAvatarLight,
                ]}
              >
                <MaterialIcons
                  name="person"
                  size={40}
                  color={isDark ? "#0EA5E9" : "#0284C7"}
                />
              </View>
              <ThemedText style={styles.profileTitle}>
                Driver Profile
              </ThemedText>
            </View>

            {profileLoading ? (
              <ThemedText
                style={{
                  textAlign: "center",
                  marginVertical: 20,
                  opacity: 0.6,
                }}
              >
                Loading...
              </ThemedText>
            ) : driverProfile ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 360 }}
              >
                <InfoRow
                  icon="person"
                  label="Full Name"
                  value={driverProfile.full_name}
                />
                <InfoRow
                  icon="phone"
                  label="Phone"
                  value={driverProfile.phone}
                />
                <InfoRow icon="badge" label="Role" value={driverProfile.role} />
                <InfoRow
                  icon="directions-car"
                  label="Plate Number"
                  value={ambulanceDetails?.vehicle_number || "Not assigned"}
                />
                <InfoRow
                  icon="assignment"
                  label="Registration No."
                  value={
                    ambulanceDetails?.registration_number || "Not assigned"
                  }
                />
                <InfoRow
                  icon="local-hospital"
                  label="Hospital"
                  value={driverProfile.hospital_id || "Not assigned"}
                />
                <InfoRow
                  icon="calendar-today"
                  label="Member Since"
                  value={
                    driverProfile.created_at
                      ? new Date(driverProfile.created_at).toLocaleDateString()
                      : ""
                  }
                />
              </ScrollView>
            ) : (
              <ThemedText
                style={{
                  textAlign: "center",
                  marginVertical: 20,
                  opacity: 0.6,
                }}
              >
                No profile data available
              </ThemedText>
            )}
          </ThemedView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: 18,
    paddingBottom: 40,
  },
  welcomeCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  welcomeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 20,
    backgroundColor: "#F0F9FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(14, 165, 233, 0.15)",
  },
  avatarCircleDark: {
    backgroundColor: "#0C1F3A",
    borderColor: "rgba(14, 165, 233, 0.2)",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    marginBottom: 3,
    letterSpacing: -0.3,
  },
  email: {
    fontSize: 14,
    opacity: 0.6,
    fontFamily: Fonts.sans,
  },
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  statusCard: {
    marginBottom: 18,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 14,
    fontFamily: Fonts.sans,
    letterSpacing: -0.2,
  },
  statusToggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  statusLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    fontFamily: Fonts.sans,
  },
  statusSubtitle: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    marginTop: 3,
    fontFamily: Fonts.sans,
  },
  alertCard: {
    borderColor: "#DC2626",
    borderWidth: 1.5,
    backgroundColor: "rgba(220, 38, 38, 0.1)",
    marginBottom: 18,
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
    color: "#DC2626",
    fontFamily: Fonts.sans,
  },
  alertSubtitle: {
    fontSize: 13,
    marginBottom: 12,
    fontFamily: Fonts.sans,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  statCard: {
    flex: 1,
    borderRadius: 18,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "800",
    marginTop: 8,
    fontFamily: Fonts.sans,
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
    fontFamily: Fonts.sans,
    fontWeight: "600",
  },
  /* ---- Completed History ---- */
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 4,
  },
  historyBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  historyEmpty: {
    fontSize: 13,
    opacity: 0.5,
    textAlign: "center",
    paddingVertical: 16,
    fontFamily: Fonts.sans,
  },
  historyItem: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  historyItemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  historyTypeBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  historyTypeText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    textTransform: "capitalize",
  },
  historyDate: {
    fontSize: 11,
    opacity: 0.5,
    fontFamily: Fonts.sans,
  },
  historyDesc: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 6,
    fontFamily: Fonts.sans,
  },
  historyMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  historyMetaText: {
    fontSize: 11,
    opacity: 0.5,
    marginLeft: 4,
    fontFamily: Fonts.sans,
  },
  /* ---- Profile Modal ---- */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    padding: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 14,
  },
  modalCloseBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  profileAvatarLight: {
    backgroundColor: "#F0F9FF",
  },
  profileAvatarDark: {
    backgroundColor: "#0C1F3A",
  },
  profileTitle: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "600",
    opacity: 0.5,
    fontFamily: Fonts.sans,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: Fonts.sans,
  },
});
