import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";

import { AppButton } from "@/components/app-button";
import { AppHeader } from "@/components/app-header";
import { useAppState } from "@/components/app-state";
import { LanguageToggle } from "@/components/language-toggle";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { signOut } from "@/utils/auth";
import { calculateDistance } from "@/utils/emergency";
import { t } from "@/utils/i18n";

import {
    ensureAmbulanceHospitalLink,
    getDriverAmbulanceDetails,
    getDriverAmbulanceId,
    getDriverAssignment,
    getDriverHistory,
    getDriverStats,
    getHospitalSummary,
    sendLocationUpdate,
    subscribeToAssignments,
    toggleAmbulanceAvailability,
    type AmbulanceDetails,
} from "@/utils/driver";
import { getUserProfile, type UserProfile } from "@/utils/profile";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Driver Home Screen - Status & Incoming Assignments
 */
export default function DriverHomeScreen() {
  const authLoading = useAuthGuard(["ambulance", "driver"]);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAppState();
  const { showAlert, showError, showConfirm } = useModal();

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
  const [toggleLoading, setToggleLoading] = useState(false);
  const [hasAssignment, setHasAssignment] = useState(false);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [ambulanceId, setAmbulanceId] = useState<string | null>(null);
  const [ambulanceDetails, setAmbulanceDetails] =
    useState<AmbulanceDetails | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);

  // Completed history
  const [history, setHistory] = useState<any[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const lastSentLocationRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const lastSentAtRef = useRef<number>(0);

  // Profile modal
  const [profileVisible, setProfileVisible] = useState(false);
  const [driverProfile, setDriverProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [hospitalDisplayName, setHospitalDisplayName] =
    useState<string>("Not assigned");

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
      if (ambulance) {
        setAmbulanceDetails(ambulance);
        setIsAvailable(Boolean(ambulance.is_available));

        if (!ambulance.hospital_id && id) {
          try {
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status === "granted") {
              const current = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              });
              await ensureAmbulanceHospitalLink(id, {
                latitude: current.coords.latitude,
                longitude: current.coords.longitude,
              });
              const { ambulance: refreshed } = await getDriverAmbulanceDetails(
                user.id,
              );
              if (refreshed) {
                setAmbulanceDetails(refreshed);
                setIsAvailable(Boolean(refreshed.is_available));
              }
            }
          } catch (linkErr) {
            console.warn("Ambulance-hospital auto-link failed:", linkErr);
          }
        }
      }
    };

    loadAmbulance().finally(() => setInitialLoading(false));

    // Push current GPS to ambulance row on screen load so the DB always has
    // a reasonably fresh location even before the driver toggles Available.
    const pushInitialLocation = async () => {
      try {
        const { ambulanceId: id } = await getDriverAmbulanceId(user.id);
        if (!id) return;
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        await sendLocationUpdate(id, pos.coords.latitude, pos.coords.longitude);
      } catch (e) {
        console.warn("Initial location push failed:", e);
      }
    };
    pushInitialLocation();

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

  useEffect(() => {
    const resolveHospitalName = async () => {
      const hospitalId =
        ambulanceDetails?.hospital_id || driverProfile?.hospital_id;
      if (!hospitalId) {
        setHospitalDisplayName("Not assigned");
        return;
      }

      const { hospital, error } = await getHospitalSummary(hospitalId);
      if (error || !hospital) {
        setHospitalDisplayName("Assigned hospital");
        return;
      }

      setHospitalDisplayName(hospital.name || "Assigned hospital");
    };

    resolveHospitalName();
  }, [ambulanceDetails?.hospital_id, driverProfile?.hospital_id]);

  // Refresh stats, assignment, and history when screen regains focus
  // (e.g. returning from driver-emergency-tracking after completion)
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      const refresh = async () => {
        const [statsResult, histResult] = await Promise.all([
          getDriverStats(user.id),
          getDriverHistory(user.id),
        ]);
        setActiveCount(statsResult.active);
        setCompletedCount(statsResult.completed);
        setHistory(histResult.history);

        const { assignment } = await getDriverAssignment(user.id);
        if (assignment) {
          setHasAssignment(true);
          setAssignmentCount(1);
        } else {
          setHasAssignment(false);
          setAssignmentCount(0);
        }
      };
      refresh().catch(console.warn);
    }, [user]),
  );

  // Check for existing assignment
  useEffect(() => {
    if (!user) return;

    const checkAssignment = async () => {
      const { assignment, error } = await getDriverAssignment(user.id);
      if (!error && assignment) {
        setHasAssignment(true);
        setAssignmentCount(1);
      } else {
        // No active assignment -> clear stale state
        setHasAssignment(false);
        setAssignmentCount(0);
      }
    };

    checkAssignment();

    // Re-check every 20s to clear stale completed assignments
    const interval = setInterval(checkAssignment, 20000);
    return () => clearInterval(interval);
  }, [user]);

  // Subscribe to new assignments
  useEffect(() => {
    if (!user || !isAvailable) return;

    const unsubscribe = subscribeToAssignments(user.id, async (_assignment) => {
      // Surface assignment state immediately for faster UX.
      setHasAssignment(true);
      setAssignmentCount(1);

      // Keep a background verification pass so stale inserts don't persist.
      try {
        const { assignment: verified } = await getDriverAssignment(user.id);
        if (!verified) {
          setHasAssignment(false);
          setAssignmentCount(0);
        }
      } catch {
        // Leave immediate optimistic state; periodic refresh will reconcile.
      }
    });

    return unsubscribe;
  }, [user, isAvailable, showAlert]);

  // Send location updates when available
  useEffect(() => {
    if (!isAvailable || !user || !ambulanceId) return;

    let watcher: Location.LocationSubscription | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startLocationTracking = async () => {
      const maybeSendLocation = async (lat: number, lng: number) => {
        const now = Date.now();
        const previous = lastSentLocationRef.current;
        if (previous) {
          const movedMeters =
            calculateDistance(previous.latitude, previous.longitude, lat, lng) *
            1000;
          const elapsed = now - lastSentAtRef.current;
          if (movedMeters < 10 && elapsed < 20000) {
            return;
          }
        }

        await sendLocationUpdate(ambulanceId, lat, lng);
        lastSentLocationRef.current = { latitude: lat, longitude: lng };
        lastSentAtRef.current = now;
      };

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          showError(
            "Location Tracking Disabled",
            "Enable location access in your device settings to track ambulance location.",
          );
          return;
        }

        // Send an immediate location snapshot once tracking is enabled.
        try {
          const initial = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          await maybeSendLocation(
            initial.coords.latitude,
            initial.coords.longitude,
          );
        } catch (initialErr) {
          console.warn("Initial location snapshot failed:", initialErr);
        }

        if (Platform.OS === "web") {
          intervalId = setInterval(async () => {
            try {
              const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              });
              await maybeSendLocation(
                loc.coords.latitude,
                loc.coords.longitude,
              );
            } catch (locErr) {
              console.warn("Web location polling failed:", locErr);
            }
          }, 8000);
        } else {
          watcher = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: 5000,
              distanceInterval: 5,
            },
            async (loc) => {
              try {
                await maybeSendLocation(
                  loc.coords.latitude,
                  loc.coords.longitude,
                );
              } catch {}
            },
          );
        }

        console.log("Location tracking started");
      } catch (error) {
        console.error("Error starting location tracking:", error);
      }
    };

    startLocationTracking();

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (watcher) {
        try {
          watcher.remove();
        } catch (removeErr) {
          console.warn("Location watcher cleanup failed:", removeErr);
        }
      }
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
      // Assignment was completed/cancelled -> clear the UI
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
        <ThemedText style={styles.infoValue}>{value || "--"}</ThemedText>
      </View>
    </View>
  );

  if (authLoading || initialLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingBottom: insets.bottom },
      ]}
    >
      {/* App Header with project name top-left, theme toggle + profile icon top-right */}
      <AppHeader
        title={t("app_name")}
        onProfilePress={handleProfilePress}
        rightExtra={<LanguageToggle />}
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
                {t("welcome")}, {user?.fullName || t("role_driver")}
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
          <ThemedText style={styles.cardTitle}>
            {t("ambulance_status")}
          </ThemedText>

          <Pressable
            onPress={async () => {
              const newVal = !isAvailable;

              const ok = await confirmAvailabilityChange(newVal);
              if (!ok) return;

              setToggleLoading(true);
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
                  setToggleLoading(false);
                  return;
                }

                if (newVal) {
                  // Push one immediate location update so patient nearby list can populate quickly.
                  try {
                    const { status } =
                      await Location.getForegroundPermissionsAsync();
                    if (status === "granted") {
                      const current = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.High,
                      });
                      await sendLocationUpdate(
                        ambulanceId,
                        current.coords.latitude,
                        current.coords.longitude,
                      );
                    }
                  } catch (initialSendErr) {
                    console.warn(
                      "Immediate location update failed:",
                      initialSendErr,
                    );
                  }
                }
              }

              setTimeout(() => setToggleLoading(false), 100);
            }}
            style={[
              styles.statusToggle,
              {
                backgroundColor: isAvailable ? "#10B981" : "#6B7280",
              },
            ]}
          >
            {toggleLoading ? (
              <View
                style={{
                  width: 32,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator color="#fff" size="small" />
              </View>
            ) : (
              <MaterialIcons
                name={isAvailable ? "check-circle" : "radio-button-unchecked"}
                size={32}
                color="#fff"
              />
            )}
            <View style={{ marginLeft: 12 }}>
              <ThemedText style={styles.statusLabel}>
                {isAvailable ? t("available") : t("offline")}
              </ThemedText>
              <ThemedText style={styles.statusSubtitle}>
                {isAvailable
                  ? t("ready_to_receive_calls")
                  : t("not_receiving_calls")}
              </ThemedText>
            </View>
          </Pressable>
        </ThemedView>

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
          {/* Assignment Alert */}
          {hasAssignment && (
            <ThemedView style={[styles.card, styles.alertCard]}>
              <View style={styles.alertHeader}>
                <MaterialIcons name="priority-high" size={28} color="#DC2626" />
                <ThemedText style={styles.alertTitle}>
                  {t("new_assignment")}!
                </ThemedText>
              </View>
              <ThemedText style={styles.alertSubtitle}>
                {t("active_emergencies")}: {assignmentCount}
                {assignmentCount > 1 ? "s" : ""}
              </ThemedText>
              <AppButton
                label={t("view_assignment")}
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
              <ThemedText style={styles.statLabel}>{t("active")}</ThemedText>
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
              <ThemedText style={styles.statNumber}>
                {completedCount}
              </ThemedText>
              <ThemedText style={styles.statLabel}>{t("completed")}</ThemedText>
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
              <ThemedText style={styles.statLabel}>{t("total")}</ThemedText>
            </ThemedView>
          </View>
        </ThemedView>

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
                {t("completed_history")}
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
                  {t("no_completed_emergencies_yet")}
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
                          : "--"}
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
                          : "--"}
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
          label={t("sign_out")}
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
                Ambulance Profile
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
                  value={hospitalDisplayName}
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
    fontFamily: Fonts.sansExtraBold,
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
    marginBottom: 14,
    fontFamily: Fonts.sansBold,
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
    color: "#fff",
    fontFamily: Fonts.sansBold,
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
    marginLeft: 8,
    color: "#DC2626",
    fontFamily: Fonts.sansSemiBold,
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
    marginTop: 8,
    fontFamily: Fonts.sansExtraBold,
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
    fontFamily: Fonts.sansSemiBold,
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
    fontFamily: Fonts.sansBold,
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
    fontFamily: Fonts.sansSemiBold,
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
    fontFamily: Fonts.sansExtraBold,
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
    opacity: 0.5,
    fontFamily: Fonts.sansSemiBold,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
});
