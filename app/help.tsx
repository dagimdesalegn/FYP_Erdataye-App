import { AppButton } from "@/components/app-button";
import { AppHeader } from "@/components/app-header";
import { useAppState } from "@/components/app-state";
import { FirstAidFab } from "@/components/first-aid-fab";
import { HtmlMapView } from "@/components/html-map-view";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { signOut } from "@/utils/auth";
import { buildMapHtml, calculateDistance } from "@/utils/emergency";
import {
    getActiveEmergency,
    type PatientEmergency,
    updatePatientLiveLocation,
} from "@/utils/patient";
import { getUserProfile } from "@/utils/profile";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
    ActivityIndicator,
    AppState,
    Linking,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function HelpScreen() {
  const authLoading = useAuthGuard();
  const router = useRouter();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { user, setUser } = useAppState();
  const colors = Colors[colorScheme];
  const isDark = colorScheme === "dark";
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [directOpen, setDirectOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [activeEmergency, setActiveEmergency] =
    React.useState<PatientEmergency | null>(null);
  const [activeEmergencyId, setActiveEmergencyId] = React.useState<
    string | null
  >(null);
  const initialLat = Number(params.lat);
  const initialLng = Number(params.lng);
  const hasInitialLocation =
    Number.isFinite(initialLat) && Number.isFinite(initialLng);

  const [currentLocation, setCurrentLocation] = React.useState<{
    latitude: number;
    longitude: number;
  } | null>(
    hasInitialLocation ? { latitude: initialLat, longitude: initialLng } : null,
  );
  const [profileName, setProfileName] = React.useState<string>(
    user?.fullName || "",
  );
  const [dataLoading, setDataLoading] = React.useState(true);
  const locationWatchRef = React.useRef<Location.LocationSubscription | null>(
    null,
  );
  const lastLiveSyncRef = React.useRef<{
    latitude: number;
    longitude: number;
    at: number;
  } | null>(null);

  // Load profile name from DB
  React.useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      if (!user?.id) {
        setDataLoading(false);
        return;
      }
      try {
        const { profile } = await getUserProfile(user.id);
        if (!cancelled && profile) {
          setProfileName(profile.full_name || "");
          if (
            profile.full_name !== user.fullName ||
            profile.phone !== user.phone
          ) {
            setUser({
              ...user,
              fullName: profile.full_name || user.fullName,
              phone: profile.phone || user.phone,
            });
          }
        }
      } catch {
        /* handled */
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    };
    void loadProfile();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.fullName]);

  React.useEffect(() => {
    let cancelled = false;
    const loadActiveEmergency = async () => {
      if (!user?.id) {
        if (!cancelled) setActiveEmergencyId(null);
        return;
      }
      try {
        const { emergency } = await getActiveEmergency(user.id);
        if (!cancelled) {
          setActiveEmergency(emergency ?? null);
          setActiveEmergencyId(emergency?.id ?? null);
        }
      } catch {
        /* handled */
      }
    };
    void loadActiveEmergency();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  React.useEffect(() => {
    let cancelled = false;

    const applyCoords = (coords: Location.LocationObjectCoords) => {
      if (cancelled) return;
      setCurrentLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    };

    const loadCurrentLocation = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          return;
        }

        if (Platform.OS === "android") {
          try {
            await Location.enableNetworkProviderAsync();
          } catch {
            // Ignore provider prompt cancellation; GPS may still resolve.
          }
        }

        const lastKnown = await Location.getLastKnownPositionAsync({
          maxAge: 1000 * 60 * 10,
        });
        if (lastKnown) {
          applyCoords(lastKnown.coords);
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
          mayShowUserSettingsDialog: true,
        });
        applyCoords(position.coords);

        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 5,
          },
          (next) => applyCoords(next.coords),
        );
      } catch {
        if (!cancelled) {
          await Location.hasServicesEnabledAsync().catch(() => false);
        }
      }
    };
    void loadCurrentLocation();
    return () => {
      cancelled = true;
      try {
        locationWatchRef.current?.remove();
      } catch {
        // noop
      }
      locationWatchRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!activeEmergencyId || !currentLocation) return;
    const now = Date.now();
    const prev = lastLiveSyncRef.current;
    if (prev) {
      const moved =
        calculateDistance(
          prev.latitude,
          prev.longitude,
          currentLocation.latitude,
          currentLocation.longitude,
        ) * 1000;
      const elapsed = now - prev.at;
      if (moved < 8 && elapsed < 15000) return;
    }

    lastLiveSyncRef.current = {
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      at: now,
    };

    void updatePatientLiveLocation(
      activeEmergencyId,
      currentLocation.latitude,
      currentLocation.longitude,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeEmergencyId,
     
    currentLocation?.latitude,
    currentLocation?.longitude,
  ]);

  React.useEffect(() => {
    let mounted = true;
    let lastState = AppState.currentState;

    const refreshLocationOnResume = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") return;

        if (Platform.OS === "android") {
          try {
            await Location.enableNetworkProviderAsync();
          } catch {
            // Ignore provider prompt cancellation on resume.
          }
        }

        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
          mayShowUserSettingsDialog: true,
        });

        if (!mounted) return;
        setCurrentLocation({
          latitude: fresh.coords.latitude,
          longitude: fresh.coords.longitude,
        });
      } catch {
        if (!mounted) return;
        await Location.hasServicesEnabledAsync().catch(() => false);
      }
    };

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        const wasBackgrounded =
          lastState === "background" || lastState === "inactive";
        if (wasBackgrounded && nextState === "active") {
          void refreshLocationOnResume();
        }
        lastState = nextState;
      },
    );

    return () => {
      mounted = false;
      appStateSubscription.remove();
    };
  }, []);

  const mapLocation = React.useMemo(() => {
    const hasMeaningfulEmergencyCoords =
      !!activeEmergency &&
      Number.isFinite(activeEmergency.latitude) &&
      Number.isFinite(activeEmergency.longitude) &&
      Math.abs(activeEmergency.latitude) > 0.0001 &&
      Math.abs(activeEmergency.longitude) > 0.0001;

    if (currentLocation) {
      return {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        sourceLabel: "Current device location",
      };
    }
    if (hasMeaningfulEmergencyCoords) {
      return {
        latitude: activeEmergency!.latitude,
        longitude: activeEmergency!.longitude,
        sourceLabel: "Emergency location",
      };
    }
    return null;
  }, [activeEmergency, currentLocation]);

  const mapHtml = React.useMemo(() => {
    if (!mapLocation) return "";
    return buildMapHtml(mapLocation.latitude, mapLocation.longitude, 17);
  }, [mapLocation]);

  const openPatientEmergency = React.useCallback(() => {
    const locationQuery = currentLocation
      ? `?lat=${currentLocation.latitude}&lng=${currentLocation.longitude}`
      : "";

    if (!user?.id) {
      router.push("/login");
      return;
    }
    if (activeEmergencyId) {
      router.push(
        `/patient-emergency-tracking?emergencyId=${activeEmergencyId}`,
      );
      return;
    }
    router.push(`/patient-emergency${locationQuery}`);
  }, [activeEmergencyId, currentLocation, router, user?.id]);

  const handleForMe = () => {
    setHelpOpen(false);
    openPatientEmergency();
  };

  const handleForOther = () => {
    setHelpOpen(false);
    const locationQuery = currentLocation
      ? `&lat=${currentLocation.latitude}&lng=${currentLocation.longitude}`
      : "";
    router.push(`/patient-emergency?forOther=true${locationQuery}`);
  };

  const handleCall = (number: string) => {
    Linking.openURL(`tel:${number}`);
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    const { error } = await signOut();
    if (!error) {
      setUser(null);
      router.replace("/");
    }
  };

  if (authLoading || dataLoading) {
    return (
      <View
        style={[
          styles.bg,
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
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader
        title="እርዳታዬ"
        onProfilePress={() => setProfileOpen(!profileOpen)}
      />

      {/* Profile Dropdown Backdrop */}
      {profileOpen && (
        <Pressable
          style={styles.profileBackdrop}
          onPress={() => setProfileOpen(false)}
        />
      )}

      {/* Profile Dropdown */}
      {profileOpen && (
        <View
          style={[
            styles.profileDropdown,
            {
              top: Math.max(insets.top, 12) + 52,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.profileDropdownHeader}>
            <View style={{ flex: 1 }}>
              {profileName || user?.fullName ? (
                <ThemedText
                  style={[styles.profileName, { color: colors.text }]}
                >
                  {profileName || user?.fullName}
                </ThemedText>
              ) : null}
              <ThemedText
                style={[styles.profileEmail, { color: colors.textMuted }]}
              >
                {user?.phone
                  ? user.phone.startsWith("+")
                    ? user.phone
                    : user.phone.startsWith("0")
                      ? "+251" + user.phone.slice(1)
                      : "+251" + user.phone
                  : "Not signed in"}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => setProfileOpen(false)}
              style={({ pressed }) => [
                styles.profileCloseBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <MaterialIcons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              setProfileOpen(false);
              router.push("/patient-profile");
            }}
            style={({ pressed }) => [
              styles.profileMenuItem,
              pressed && { opacity: 0.7 },
            ]}
          >
            <MaterialIcons name="edit" size={18} color={colors.text} />
            <ThemedText
              style={[styles.profileMenuText, { color: colors.text }]}
            >
              Edit Profile
            </ThemedText>
          </Pressable>
          <View
            style={[styles.profileDivider, { backgroundColor: colors.border }]}
          />
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [
              styles.profileMenuItem,
              pressed && { opacity: 0.7 },
            ]}
          >
            <MaterialIcons name="logout" size={18} color={colors.primary} />
            <ThemedText
              style={[styles.profileMenuText, { color: colors.primary }]}
            >
              Sign Out
            </ThemedText>
          </Pressable>
        </View>
      )}

      <View
        style={[
          styles.content,
          { paddingTop: 54, paddingBottom: Math.max(insets.bottom, 14) + 14 },
        ]}
      >
        <ThemedView style={[styles.hero, { borderColor: colors.border }]}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <FirstAidFab
              triggerMode="tag"
              triggerLabel="Ask Chatbot"
              anchorStyle={styles.chatbotTagAnchor}
            />
          </View>

          <View
            style={[
              styles.mapShell,
              {
                borderColor: colors.border,
                backgroundColor: colors.surfaceMuted,
              },
            ]}
          >
            {mapLocation ? (
              <View style={styles.liveMapRoot}>
                <View style={styles.mapMetaRow}>
                  <View style={styles.mapMetaLeft}>
                    <MaterialIcons
                      name="my-location"
                      size={18}
                      color={isDark ? "#E6E9EC" : "#0F172A"}
                    />
                    <View>
                      <ThemedText style={styles.mapMetaLabel}>
                        Current location of your device
                      </ThemedText>
                    </View>
                  </View>
                </View>
                <View style={styles.mapFrameWrap}>
                  {mapHtml ? (
                    <HtmlMapView html={mapHtml} style={{ flex: 1 }} />
                  ) : null}
                </View>
              </View>
            ) : (
              <View style={styles.mapPlaceholder}>
                <MaterialIcons
                  name="map"
                  size={22}
                  color={isDark ? "#E6E9EC" : "#0F172A"}
                />
                <ThemedText
                  style={[
                    styles.mapPlaceholderText,
                    { color: isDark ? "#A3AAB3" : "#64748B" },
                  ]}
                >
                  Current location of your device
                </ThemedText>
              </View>
            )}
          </View>
        </ThemedView>

        <View style={styles.actionsRow}>
          <View style={styles.actionCol}>
            <AppButton
              label="Help"
              onPress={() => setHelpOpen(true)}
              variant="primary"
              fullWidth
              leftIcon={
                <MaterialIcons name="help-outline" size={18} color="#E2E8F0" />
              }
              style={[styles.actionBtn, styles.helpPrimary]}
            />
          </View>
          <View style={styles.actionCol}>
            <AppButton
              label="Direct"
              onPress={() => setDirectOpen(true)}
              variant="primary"
              fullWidth
              leftIcon={
                <MaterialIcons name="phone-in-talk" size={18} color="#E2E8F0" />
              }
              style={[styles.actionBtn, styles.directPrimary]}
            />
          </View>
        </View>

        {helpOpen ? (
          <View style={styles.modalRoot}>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setHelpOpen(false)}
            />
            <View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 14) + 14,
                  backgroundColor: isDark ? "#0B1220" : "#FFFFFF",
                  borderColor: isDark ? "#2E3236" : "#E6ECF2",
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <ThemedText style={styles.sheetTitle}>
                  Choose help type
                </ThemedText>
                <Pressable
                  onPress={() => setHelpOpen(false)}
                  style={({ pressed }) => [
                    styles.sheetClose,
                    pressed ? { opacity: 0.7 } : null,
                  ]}
                >
                  <MaterialIcons
                    name="close"
                    size={18}
                    color={isDark ? "#E6E9EC" : "#11181C"}
                  />
                </Pressable>
              </View>
              <View style={styles.modalActionsRow}>
                <View style={styles.actionCol}>
                  <AppButton
                    label="For me"
                    onPress={handleForMe}
                    variant="ghost"
                    fullWidth
                    leftIcon={
                      <MaterialIcons
                        name="person"
                        size={18}
                        color={isDark ? "#E6E9EC" : "#11181C"}
                      />
                    }
                    style={[styles.actionBtn, styles.modalMeBtn]}
                  />
                </View>
                <View style={styles.actionCol}>
                  <AppButton
                    label="For other"
                    onPress={handleForOther}
                    variant="ghost"
                    fullWidth
                    leftIcon={
                      <MaterialIcons
                        name="groups"
                        size={18}
                        color={isDark ? "#E6E9EC" : "#11181C"}
                      />
                    }
                    style={[styles.actionBtn, styles.modalOtherBtn]}
                  />
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* Direct Call Modal */}
        {directOpen ? (
          <View style={styles.modalRoot}>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setDirectOpen(false)}
            />
            <View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 14) + 14,
                  backgroundColor: isDark ? "#0B1220" : "#FFFFFF",
                  borderColor: isDark ? "#2E3236" : "#E6ECF2",
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <ThemedText style={styles.sheetTitle}>
                  Emergency Contacts
                </ThemedText>
                <Pressable
                  onPress={() => setDirectOpen(false)}
                  style={({ pressed }) => [
                    styles.sheetClose,
                    pressed ? { opacity: 0.7 } : null,
                  ]}
                >
                  <MaterialIcons
                    name="close"
                    size={18}
                    color={isDark ? "#E6E9EC" : "#11181C"}
                  />
                </Pressable>
              </View>

              <ThemedText
                style={[
                  styles.contactSectionTitle,
                  { color: isDark ? "#94A3B8" : "#64748B" },
                ]}
              >
                Ethiopian Emergency Services
              </ThemedText>

              <Pressable
                onPress={() => handleCall("911")}
                style={({ pressed }) => [
                  styles.contactRow,
                  {
                    backgroundColor: isDark ? "#1E2028" : "#FEF2F2",
                    borderColor: isDark ? "#2E3236" : "#FECACA",
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.contactIconWrap,
                    { backgroundColor: "#DC262620" },
                  ]}
                >
                  <MaterialIcons
                    name="local-hospital"
                    size={20}
                    color="#DC2626"
                  />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText
                    style={[styles.contactName, { color: colors.text }]}
                  >
                    Emergency (Ambulance)
                  </ThemedText>
                  <ThemedText
                    style={[styles.contactNumber, { color: "#DC2626" }]}
                  >
                    911
                  </ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#DC2626" />
              </Pressable>

              <Pressable
                onPress={() => handleCall("939")}
                style={({ pressed }) => [
                  styles.contactRow,
                  {
                    backgroundColor: isDark ? "#1E2028" : "#FFF7ED",
                    borderColor: isDark ? "#2E3236" : "#FED7AA",
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.contactIconWrap,
                    { backgroundColor: "#F59E0B20" },
                  ]}
                >
                  <MaterialIcons
                    name="local-fire-department"
                    size={20}
                    color="#F59E0B"
                  />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText
                    style={[styles.contactName, { color: colors.text }]}
                  >
                    Fire & Emergency
                  </ThemedText>
                  <ThemedText
                    style={[styles.contactNumber, { color: "#F59E0B" }]}
                  >
                    939
                  </ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#F59E0B" />
              </Pressable>

              <Pressable
                onPress={() => handleCall("991")}
                style={({ pressed }) => [
                  styles.contactRow,
                  {
                    backgroundColor: isDark ? "#1E2028" : "#EFF6FF",
                    borderColor: isDark ? "#2E3236" : "#BFDBFE",
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.contactIconWrap,
                    { backgroundColor: "#3B82F620" },
                  ]}
                >
                  <MaterialIcons
                    name="local-police"
                    size={20}
                    color="#3B82F6"
                  />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText
                    style={[styles.contactName, { color: colors.text }]}
                  >
                    Police
                  </ThemedText>
                  <ThemedText
                    style={[styles.contactNumber, { color: "#3B82F6" }]}
                  >
                    991
                  </ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#3B82F6" />
              </Pressable>

              <ThemedText
                style={[
                  styles.contactSectionTitle,
                  { color: isDark ? "#94A3B8" : "#64748B", marginTop: 12 },
                ]}
              >
                Family / Personal
              </ThemedText>

              <Pressable
                onPress={() => handleCall("+251911000000")}
                style={({ pressed }) => [
                  styles.contactRow,
                  {
                    backgroundColor: isDark ? "#1E2028" : "#F0FDF4",
                    borderColor: isDark ? "#2E3236" : "#BBF7D0",
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.contactIconWrap,
                    { backgroundColor: "#10B98120" },
                  ]}
                >
                  <MaterialIcons
                    name="family-restroom"
                    size={20}
                    color="#10B981"
                  />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText
                    style={[styles.contactName, { color: colors.text }]}
                  >
                    Emergency Contact
                  </ThemedText>
                  <ThemedText
                    style={[styles.contactNumber, { color: "#10B981" }]}
                  >
                    From your profile
                  </ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#10B981" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 14, justifyContent: "space-between" },
  hero: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  chatTagRow: {
    alignItems: "flex-end",
    marginBottom: 10,
  },
  chatbotTagAnchor: {
    position: "relative",
    zIndex: 5,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextCol: { flex: 1 },
  heroTitle: { fontSize: 18, fontFamily: Fonts.sansBlack, letterSpacing: -0.3 },
  mapShell: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    flex: 1,
    minHeight: 420,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  mapPlaceholderText: { fontSize: 13, fontFamily: Fonts.sansSemiBold, textAlign: "center" },
  liveMapRoot: { flex: 1 },
  mapMetaRow: {
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.26)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  mapMetaLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  mapMetaLabel: { fontSize: 12, fontFamily: Fonts.sansExtraBold },
  mapMetaValue: { fontSize: 12, marginTop: 2, fontFamily: Fonts.sansMedium },
  openMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  openMapText: { fontSize: 12, fontFamily: Fonts.sansBold },
  mapFrameWrap: { flex: 1, minHeight: 300 },
  actionsRow: { marginTop: 14, flexDirection: "row", gap: 14 },
  modalActionsRow: { marginTop: 14, flexDirection: "row", gap: 14 },
  actionCol: { flex: 1 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalRoot: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  sheet: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 17, fontFamily: Fonts.sansBlack },
  sheetClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  actionBtn: { minHeight: 56, borderRadius: 18, paddingVertical: 14 },
  helpPrimary: {
    backgroundColor: "#16A34A",
    borderColor: "#15803D",
    borderWidth: 1,
    shadowColor: "#14532D",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 8,
  },
  directPrimary: {
    backgroundColor: "#DC2626",
    borderColor: "#B91C1C",
    borderWidth: 1,
    shadowColor: "#7F1D1D",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 8,
  },
  modalMeBtn: {
    backgroundColor: "transparent",
    borderColor: "#DC2626",
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  modalOtherBtn: {
    backgroundColor: "transparent",
    borderColor: "#10B981",
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  profileBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 150 },
  profileDropdown: {
    position: "absolute",
    right: 16,
    zIndex: 200,
    borderRadius: 14,
    borderWidth: 1,
    padding: 8,
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  profileDropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  profileEmail: { fontSize: 12, fontFamily: Fonts.sansSemiBold, flex: 1 },
  profileName: { fontSize: 14, fontFamily: Fonts.sansBold, marginBottom: 2 },
  profileCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  profileMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  profileMenuText: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  profileDivider: { height: 1, marginVertical: 4, marginHorizontal: 8 },
  contactSectionTitle: {
    fontSize: 12,
    fontFamily: Fonts.sansBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  contactIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  contactInfo: { flex: 1, gap: 3 },
  contactName: { fontSize: 15, fontFamily: Fonts.sansBold },
  contactNumber: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
});
