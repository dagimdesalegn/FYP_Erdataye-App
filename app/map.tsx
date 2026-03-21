import { AppHeader } from "@/components/app-header";
import { HtmlMapView } from "@/components/html-map-view";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    Ambulance,
    buildMapHtml,
    EmergencyRequest,
    formatCoords,
    getLiveAvailableAmbulances,
    getHospitals,
    Hospital,
    normalizeEmergency,
    parsePostGISPoint,
} from "@/utils/emergency";
import { supabase } from "@/utils/supabase";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";

export default function MapScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? "light";
  const isDark = theme === "dark";
  const colors = Colors[theme];

  const [location, setLocation] = useState<Location.LocationObject | null>(
    null,
  );
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [ambulances, setAmbulances] = useState<
    (Ambulance & { lat: number; lng: number })[]
  >([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [hospitals, setHospitals] = useState<
    (Hospital & { lat: number; lng: number })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const locationWatcherRef = React.useRef<Location.LocationSubscription | null>(
    null,
  );
  

  const textColor = colors.text;
  const subText = colors.textMuted;
  const accentColor = colors.primary;
  const cardBg = colors.surface;

  const distanceMeters = (
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ) => {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getUserLocation = async () => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationError(
          "Location services are turned off. Please enable GPS.",
        );
        return null;
      }

      const { status, canAskAgain } =
        await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError(
          canAskAgain
            ? "Location permission denied. Please allow location access."
            : "Location permission denied. Enable it in system settings.",
        );
        return null;
      }

      setLocationError(null);

      // On Android, prompt the user to enable high-accuracy provider when available.
      if (Platform.OS === "android") {
        try {
          await Location.enableNetworkProviderAsync();
        } catch {
          // Non-fatal: location can still work with device GPS/provider settings.
        }
      }

      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 1000 * 60 * 10,
      });
      if (lastKnown) {
        setLocation(lastKnown);
        setMapCenter({ lat: lastKnown.coords.latitude, lng: lastKnown.coords.longitude });
      }

      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy:
            Platform.OS === "android"
              ? Location.Accuracy.Balanced
              : Location.Accuracy.High,
          mayShowUserSettingsDialog: true,
        });
        setLocation(currentLocation);
        setMapCenter({ lat: currentLocation.coords.latitude, lng: currentLocation.coords.longitude });
        return currentLocation;
      } catch (positionError) {
        if (lastKnown) {
          setLocationError("Using last known location. Waiting for GPS fix.");
          return lastKnown;
        }

        // Final fallback for devices that fail with stricter accuracy requests.
        const fallbackLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
        }).catch(() => null);
        if (fallbackLocation) {
          setLocation(fallbackLocation);
          setMapCenter({ lat: fallbackLocation.coords.latitude, lng: fallbackLocation.coords.longitude });
          setLocationError(
            "GPS signal is weak. Using lower-accuracy location.",
          );
          return fallbackLocation;
        }

        setLocationError(
          `Unable to read current location. ${
            positionError instanceof Error
              ? positionError.message
              : "Try moving outdoors and enabling device location."
          }`,
        );
        return null;
      }
    } catch (error) {
      console.error("Error getting location:", error);
      setLocationError(
        "Unable to read current location. Check permissions and GPS.",
      );
      return null;
    }
  };

  const fetchAmbulances = async () => {
    try {
      const { ambulances: data, error } = await getLiveAvailableAmbulances(10);
      if (error) throw error;
      const parsed = (data || [])
        .map((a) => {
          const loc = parsePostGISPoint(a.last_known_location);
          return loc ? { ...a, lat: loc.latitude, lng: loc.longitude } : null;
        })
        .filter(Boolean) as (Ambulance & { lat: number; lng: number })[];
      setAmbulances(parsed);
    } catch (error) {
      console.error("Error fetching ambulances:", error);
    }
  };

  const fetchEmergencies = async () => {
    try {
      const { data, error } = await supabase
        .from("emergency_requests")
        .select("*")
        .in("status", ["pending", "assigned", "en_route", "arrived"]);
      if (error) throw error;
      setEmergencies((data || []).map(normalizeEmergency));
    } catch (error) {
      console.error("Error fetching emergencies:", error);
    }
  };

  const fetchHospitals = async () => {
    try {
      const { hospitals: data, error } = await getHospitals();
      if (error) throw error;
      const parsed = (data || [])
        .map((h) => {
          const loc = parsePostGISPoint(h.location);
          return loc ? { ...h, lat: loc.latitude, lng: loc.longitude } : null;
        })
        .filter(Boolean) as (Hospital & { lat: number; lng: number })[];
      setHospitals(parsed);
    } catch (error) {
      console.error("Error fetching hospitals:", error);
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([
      getUserLocation(),
      fetchAmbulances(),
      fetchEmergencies(),
      fetchHospitals(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAllData();
    const ambulanceSub = supabase
      .channel("map_ambulance_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ambulances" },
        () => fetchAmbulances(),
      )
      .subscribe();
    const emergencySub = supabase
      .channel("map_emergency_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "emergency_requests" },
        () => fetchEmergencies(),
      )
      .subscribe();    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        locationWatcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 12000,
            distanceInterval: 15,
          },
          (next) => {
            setLocation(next);
            const nextLat = next.coords.latitude;
            const nextLng = next.coords.longitude;

            setMapCenter((prev) => {
              if (!prev) return { lat: nextLat, lng: nextLng };
              const moved = distanceMeters(prev.lat, prev.lng, nextLat, nextLng);
              return moved >= 20 ? { lat: nextLat, lng: nextLng } : prev;
            });
          },
        );
      } catch {
        // fallback to initial location lookup
      }
    })();
    return () => {
      ambulanceSub.unsubscribe();
      emergencySub.unsubscribe();
      locationWatcherRef.current?.remove();
      locationWatcherRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <AppHeader title="Erdataya Ambulance" />
        <View style={styles.loadingContent}>
          <ActivityIndicator size="large" color={accentColor} />
          <ThemedText
            style={{ marginTop: 16, color: textColor, fontFamily: Fonts.sans }}
          >
            Loading map...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const userLat = mapCenter?.lat ?? location?.coords.latitude ?? 9.02;
  const userLng = mapCenter?.lng ?? location?.coords.longitude ?? 38.75;
  const mapEmbedUrl = buildMapHtml(userLat, userLng, 17);

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="Erdataya Ambulance" />

      {/* Map via HtmlMapView (works on both web & native) */}
      <View style={styles.mapContainer}>
        <HtmlMapView
          html={mapEmbedUrl}
          style={{ flex: 1 }}
          title="Live ambulance map"
        />
      </View>

      {/* Controls: Refresh only (directions removed) */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.controlBtn, { backgroundColor: accentColor }]}
          onPress={fetchAllData}
        >
          <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Data panel */}
      <ScrollView style={[styles.dataPanel, { backgroundColor: cardBg }]}>
        {locationError && (
          <ThemedText style={[styles.errorText, { color: "#EF4444" }]}>
            {locationError}
          </ThemedText>
        )}

        {location && (
          <ThemedText style={[styles.locationText, { color: subText }]}>
            📍 Live location map
          </ThemedText>
        )}

        {/* Ambulances */}
        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
          🚑 Ambulances ({ambulances.length})
        </ThemedText>
        {ambulances.length === 0 && (
          <ThemedText style={[styles.emptyText, { color: subText }]}>
            No ambulances available
          </ThemedText>
        )}
        {ambulances.map((amb) => (
          <View
            key={amb.id}
            style={[styles.card, { borderColor: colors.border }]}
          >
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>
              Ambulance {amb.vehicle_number}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              Type: {amb.type || "Standard"} - {formatCoords(amb.lat, amb.lng)}
            </ThemedText>
          </View>
        ))}

        {/* Emergencies */}
        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
          (!) Emergencies ({emergencies.length})
        </ThemedText>
        {emergencies.length === 0 && (
          <ThemedText style={[styles.emptyText, { color: subText }]}>
            No active emergencies
          </ThemedText>
        )}
        {emergencies
          .filter((e) => e.latitude !== 0 || e.longitude !== 0)
          .map((e) => (
            <View
              key={e.id}
              style={[styles.card, { borderColor: colors.danger }]}
            >
              <ThemedText style={[styles.cardTitle, { color: textColor }]}>
                {e.emergency_type} - {e.status}
              </ThemedText>
              <ThemedText style={[styles.cardSub, { color: subText }]}>
                {e.description}
              </ThemedText>
            </View>
          ))}

        {/* Hospitals */}
        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
          Hospitals ({hospitals.length})
        </ThemedText>
        {hospitals.length === 0 && (
          <ThemedText style={[styles.emptyText, { color: subText }]}>
            No hospitals found
          </ThemedText>
        )}
        {hospitals.map((h) => (
          <View
            key={h.id}
            style={[
              styles.card,
              { borderColor: isDark ? "#1E3A5F" : "#E2E8F0" },
            ]}
          >
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>
              {h.name}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {h.address} - phone: {h.phone}
            </ThemedText>
          </View>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1 },
  loadingContent: { flex: 1, justifyContent: "center", alignItems: "center" },

  mapContainer: {
    width: "100%",
    height: "50%",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },

  controls: { position: "absolute", right: 16, top: 80, zIndex: 10 },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
  },

  dataPanel: {
    flex: 1,
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  locationText: { fontSize: 12, fontFamily: Fonts.sans, marginBottom: 12 },
  errorText: {
    marginBottom: 10,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  sectionTitle: {
    fontWeight: "bold",
    fontSize: 16,
    fontFamily: Fonts.sans,
    marginTop: 12,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    marginBottom: 8,
    fontStyle: "italic",
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: { fontWeight: "700", fontSize: 14, fontFamily: Fonts.sans },
  cardSub: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 4,
    lineHeight: 18,
  },
});





