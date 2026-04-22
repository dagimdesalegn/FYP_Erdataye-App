import { AppHeader } from "@/components/app-header";
import { useAppState } from "@/components/app-state";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    Ambulance,
    formatCoords,
    getAvailableAmbulances,
    parsePostGISPoint,
} from "@/utils/emergency";
import { createEmergency } from "@/utils/patient";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
  Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";

export default function EmergencyScreen() {
  const _authLoading = useAuthGuard();
  const { user } = useAppState();
  const { showError, showAlert, showConfirm } = useModal();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? "light";
  const colors = Colors[theme];
  const textColor = colors.text;
  const subText = colors.textMuted;

  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(
    null,
  );
  const [nearbyAmbulances, setNearbyAmbulances] = useState<
    (Ambulance & { lat: number; lng: number })[]
  >([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "fetching" | "ready" | "denied" | "unavailable"
  >("idle");

  // Show location permission info modal before requesting
  const requestLocationWithPrompt = useCallback(async () => {
    return new Promise((resolve) => {
      showConfirm(
        "Enable Location",
        "We need your precise location to dispatch the nearest ambulance to you. This helps us get help to you faster.",
        async () => {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") setLocationStatus("denied");
          resolve(status === "granted");
        },
        () => {
          setLocationStatus("denied");
          resolve(false);
        },
      );
    });
  }, [showConfirm]);

  // Get user's current location with high accuracy
  const getUserLocation = useCallback(async (showPermissionError: boolean = true) => {
    try {
      setLocationStatus("fetching");
      setErrorMsg(null);
      const allowed = await requestLocationWithPrompt();
      if (!allowed) {
        setLocation(null);
        if (showPermissionError) {
          showError(
            "Location Required",
            "Location access is required to call an ambulance. Tap Go to Settings to enable location permission.",
          );
        }
        return null;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setLocation(currentLocation);
      setLocationStatus("ready");
      return currentLocation;
    } catch (error) {
      setLocationStatus("unavailable");
      setLocation(null);
      setErrorMsg(`Error getting location: ${error}`);
      return null;
    }
  }, [requestLocationWithPrompt, showError]);

  const handleOpenSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      showError(
        "Settings Unavailable",
        "Unable to open system settings from this device. Please enable location manually in your phone settings.",
      );
    }
  }, [showError]);

  // Call emergency
  const handleEmergencyCall = async () => {
    if (!user) {
      showError(
        "Authentication Required",
        "You must be logged in to call an ambulance",
      );
      return;
    }

    setLoading(true);
    try {
      const currentLocation = await getUserLocation(true);
      if (!currentLocation) {
        showError(
          "Location Required",
          "Could not get your location. Please enable location services.",
        );
        setLoading(false);
        return;
      }

      const { latitude, longitude } = currentLocation.coords;

      // Create emergency request via patient flow (auto dispatches nearest ambulance)
      const { emergency, error } = await createEmergency(
        user.id,
        latitude,
        longitude,
        "medical",
        "Emergency ambulance request",
      );

      if (error || !emergency) {
        showError(
          "Request Failed",
          `Failed to create emergency request: ${error?.message ?? "Unknown error"}`,
        );
        setLoading(false);
        return;
      }

      // Fetch available ambulances for display
      const { ambulances } = await getAvailableAmbulances();
      if (ambulances && ambulances.length > 0) {
        const parsed = ambulances
          .map((a) => {
            const loc = parsePostGISPoint(a.last_known_location);
            return loc ? { ...a, lat: loc.latitude, lng: loc.longitude } : null;
          })
          .filter(Boolean) as (Ambulance & { lat: number; lng: number })[];
        setNearbyAmbulances(parsed);
      }

      showAlert(
        "Emergency Request Sent",
        `Your location (${formatCoords(latitude, longitude)}) has been sent.${emergency.assigned_ambulance_id ? "\\n\\nNearest ambulance was assigned automatically. Help is on the way!" : "\\n\\nRequest created. Dispatch retry is running in the background."}`,
      );
    } catch (error) {
      showError("Emergency Failed", `Emergency call failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getUserLocation(false);
  }, [getUserLocation]);

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="እርዳታዬ" onBackPress={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title" style={[styles.title, { color: textColor }]}>
          🚑 Emergency Ambulance Service
        </ThemedText>

        {errorMsg && <ThemedText style={styles.error}>{errorMsg}</ThemedText>}

        {location && (
          <View
            style={[
              styles.locationCard,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
          >
            <MaterialIcons name="my-location" size={18} color={colors.info} />
            <ThemedText style={[styles.locationText, { color: subText }]}>
              {formatCoords(
                location.coords.latitude,
                location.coords.longitude,
              )}
              {"  "}• Accuracy: {location.coords.accuracy?.toFixed(0)}m
            </ThemedText>
          </View>
        )}

        {locationStatus === "fetching" && (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator size="small" color={colors.info} />
            <ThemedText style={[styles.statusText, { color: subText }]}>Fetching your location...</ThemedText>
          </View>
        )}

        {locationStatus === "unavailable" && (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
          >
            <MaterialIcons name="location-off" size={18} color="#DC2626" />
            <ThemedText style={[styles.statusText, { color: subText }]}>Location unavailable. Please check GPS and network, then try again.</ThemedText>
          </View>
        )}

        {locationStatus === "denied" && (
          <View
            style={[
              styles.statusCard,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
            ]}
          >
            <MaterialIcons name="privacy-tip" size={18} color="#DC2626" />
            <View style={styles.statusContent}>
              <ThemedText style={[styles.statusText, { color: subText }]}>Location permission denied. Enable location access to dispatch the nearest ambulance.</ThemedText>
              <Pressable style={styles.settingsBtn} onPress={handleOpenSettings}>
                <MaterialIcons name="settings" size={14} color="#FFFFFF" />
                <ThemedText style={styles.settingsBtnText}>Go to Settings</ThemedText>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.buttonContainer}>
          <Pressable
            style={[styles.callButton, loading && styles.callButtonDisabled]}
            onPress={handleEmergencyCall}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <>
                <MaterialIcons name="phone-in-talk" size={48} color="#fff" />
                <ThemedText style={styles.callButtonText}>
                  CALL{"\n"}AMBULANCE
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: "#3B82F6" }]}
            onPress={() => router.push("/map")}
          >
            <MaterialIcons name="map" size={22} color="#fff" />
            <ThemedText style={styles.actionBtnText}>Live Map</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: "#10B981" }]}
            onPress={() => router.push("/hospital")}
          >
            <MaterialIcons name="local-hospital" size={22} color="#fff" />
            <ThemedText style={styles.actionBtnText}>Hospital</ThemedText>
          </Pressable>
        </View>

        {/* Nearby Ambulances */}
        {nearbyAmbulances.length > 0 && (
          <View style={styles.ambulancesSection}>
            <ThemedText
              type="subtitle"
              style={[styles.ambulancesTitle, { color: textColor }]}
            >
              Available Ambulances ({nearbyAmbulances.length})
            </ThemedText>
            {nearbyAmbulances.map((ambulance) => (
              <View
                key={ambulance.id}
                style={[
                  styles.ambulanceCard,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.ambulanceRow}>
                  <ThemedText
                    style={[styles.ambulanceText, { color: textColor }]}
                  >
                    🚑 {ambulance.vehicle_number}
                  </ThemedText>
                  <ThemedText
                    style={[styles.ambulanceType, { color: subText }]}
                  >
                    {ambulance.type || "Standard"}
                  </ThemedText>
                </View>
                <ThemedText
                  style={[styles.ambulanceLocation, { color: subText }]}
                >
                  📍 {ambulance.lat.toFixed(4)}, {ambulance.lng.toFixed(4)}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    alignItems: "center",
    paddingBottom: 40,
  },
  title: {
    fontSize: 30,
    marginBottom: 16,
    textAlign: "center",
    fontFamily: Fonts.sansExtraBold,
  },
  error: {
    color: "#DC2626",
    marginBottom: 15,
    textAlign: "center",
    fontFamily: Fonts.sans,
  },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 24,
    width: "100%",
  },
  locationText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
    width: "100%",
  },
  statusContent: {
    flex: 1,
    gap: 8,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.sans,
    lineHeight: 18,
  },
  settingsBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DC2626",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  settingsBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.sansBold,
  },
  buttonContainer: {
    width: "100%",
    alignItems: "center",
    marginBottom: 24,
  },
  callButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#DC2626",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    gap: 4,
  },
  callButtonDisabled: {
    opacity: 0.6,
  },
  callButtonText: {
    color: "white",
    fontSize: 16,
    textAlign: "center",
    fontFamily: Fonts.sansExtraBold,
  },
  quickActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginBottom: 24,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  ambulancesSection: {
    width: "100%",
    marginTop: 8,
  },
  ambulancesTitle: {
    marginBottom: 12,
    fontFamily: Fonts.sans,
  },
  ambulanceCard: {
    padding: 14,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  ambulanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  ambulanceText: {
    fontSize: 16,
    fontFamily: Fonts.sansSemiBold,
  },
  ambulanceType: {
    fontSize: 13,
    fontFamily: Fonts.sansMedium,
  },
  ambulanceLocation: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
});
