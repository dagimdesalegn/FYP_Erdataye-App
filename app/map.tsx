import { AppHeader } from '@/components/app-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  Ambulance,
  EmergencyRequest,
  Hospital,
  normalizeEmergency,
  parsePostGISPoint,
  getAvailableAmbulances,
  getHospitals,
} from '@/utils/emergency';
import { supabase } from '@/utils/supabase';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

export default function MapScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';

  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [ambulances, setAmbulances] = useState<Array<Ambulance & { lat: number; lng: number }>>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [hospitals, setHospitals] = useState<Array<Hospital & { lat: number; lng: number }>>([]);
  const [loading, setLoading] = useState(true);

  const textColor = Colors[theme].text;
  const subText = isDark ? '#B7BDC3' : '#475569';
  const accentColor = Colors[theme].tint;
  const cardBg = isDark ? '#1A2332' : '#FFFFFF';

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLocation(currentLocation);
      return currentLocation;
    } catch (error) {
      console.error('Error getting location:', error);
      return null;
    }
  };

  const fetchAmbulances = async () => {
    try {
      const { ambulances: data, error } = await getAvailableAmbulances();
      if (error) throw error;
      const parsed = (data || [])
        .map((a) => {
          const loc = parsePostGISPoint(a.last_known_location);
          return loc ? { ...a, lat: loc.latitude, lng: loc.longitude } : null;
        })
        .filter(Boolean) as Array<Ambulance & { lat: number; lng: number }>;
      setAmbulances(parsed);
    } catch (error) {
      console.error('Error fetching ambulances:', error);
    }
  };

  const fetchEmergencies = async () => {
    try {
      const { data, error } = await supabase
        .from('emergency_requests')
        .select('*')
        .in('status', ['pending', 'assigned', 'en_route', 'arrived']);
      if (error) throw error;
      setEmergencies((data || []).map(normalizeEmergency));
    } catch (error) {
      console.error('Error fetching emergencies:', error);
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
        .filter(Boolean) as Array<Hospital & { lat: number; lng: number }>;
      setHospitals(parsed);
    } catch (error) {
      console.error('Error fetching hospitals:', error);
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([getUserLocation(), fetchAmbulances(), fetchEmergencies(), fetchHospitals()]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAllData();
    const ambulanceSub = supabase
      .channel('map_ambulance_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ambulances' }, () => fetchAmbulances())
      .subscribe();
    const emergencySub = supabase
      .channel('map_emergency_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_requests' }, () => fetchEmergencies())
      .subscribe();
    const locationInterval = setInterval(() => getUserLocation(), 10000);
    return () => {
      ambulanceSub.unsubscribe();
      emergencySub.unsubscribe();
      clearInterval(locationInterval);
    };
  }, []);

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <AppHeader title="Erdataya Ambulance" />
        <View style={styles.loadingContent}>
          <ActivityIndicator size="large" color={accentColor} />
          <ThemedText style={{ marginTop: 16, color: textColor, fontFamily: Fonts.sans }}>
            Loading map…
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const userLat = location?.coords.latitude ?? 9.02;
  const userLng = location?.coords.longitude ?? 38.75;
  const accuracy = location?.coords.accuracy ?? null;

  // Build OpenStreetMap embed with markers
  const bbox = `${userLng - 0.05}%2C${userLat - 0.05}%2C${userLng + 0.05}%2C${userLat + 0.05}`;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${userLat}%2C${userLng}`;

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="Erdataya Ambulance" />

      {/* Map - iframe on web, fallback view on native */}
      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          // @ts-ignore – iframe is valid on web
          <iframe src={mapUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="Map" />
        ) : (
          <View style={[styles.nativeFallback, { backgroundColor: isDark ? '#0F1A2E' : '#EBF0F7' }]}>
            <MaterialIcons name="map" size={64} color={accentColor} />
            <ThemedText style={[styles.fallbackText, { color: textColor }]}>
              📍 {userLat.toFixed(5)}, {userLng.toFixed(5)}
            </ThemedText>
            {accuracy != null && (
              <ThemedText style={[styles.fallbackSub, { color: subText }]}>
                Accuracy: {accuracy.toFixed(0)}m
              </ThemedText>
            )}
          </View>
        )}
      </View>

      {/* Refresh button */}
      <View style={styles.controls}>
        <Pressable style={[styles.controlBtn, { backgroundColor: accentColor }]} onPress={fetchAllData}>
          <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Data panel */}
      <ScrollView style={[styles.dataPanel, { backgroundColor: cardBg }]}>
        {location && (
          <ThemedText style={[styles.locationText, { color: subText }]}>
            📍 Your location: {userLat.toFixed(5)}, {userLng.toFixed(5)}
            {accuracy != null && ` • Accuracy: ${accuracy.toFixed(0)}m`}
          </ThemedText>
        )}

        {/* Ambulances */}
        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
          🚑 Ambulances ({ambulances.length})
        </ThemedText>
        {ambulances.length === 0 && (
          <ThemedText style={[styles.emptyText, { color: subText }]}>No ambulances available</ThemedText>
        )}
        {ambulances.map((amb) => (
          <View key={amb.id} style={[styles.card, { borderColor: isDark ? '#1E3A5F' : '#E2E8F0' }]}>
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>
              Ambulance {amb.vehicle_number}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              Type: {amb.type || 'Standard'} • {amb.lat.toFixed(5)}, {amb.lng.toFixed(5)}
            </ThemedText>
          </View>
        ))}

        {/* Emergencies */}
        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
          ⚠️ Emergencies ({emergencies.length})
        </ThemedText>
        {emergencies.length === 0 && (
          <ThemedText style={[styles.emptyText, { color: subText }]}>No active emergencies</ThemedText>
        )}
        {emergencies
          .filter((e) => e.latitude !== 0 || e.longitude !== 0)
          .map((e) => (
            <View key={e.id} style={[styles.card, { borderColor: '#EF4444' }]}>
              <ThemedText style={[styles.cardTitle, { color: textColor }]}>
                {e.emergency_type} — {e.status}
              </ThemedText>
              <ThemedText style={[styles.cardSub, { color: subText }]}>{e.description}</ThemedText>
            </View>
          ))}

        {/* Hospitals */}
        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
          🏥 Hospitals ({hospitals.length})
        </ThemedText>
        {hospitals.length === 0 && (
          <ThemedText style={[styles.emptyText, { color: subText }]}>No hospitals found</ThemedText>
        )}
        {hospitals.map((h) => (
          <View key={h.id} style={[styles.card, { borderColor: isDark ? '#1E3A5F' : '#E2E8F0' }]}>
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>{h.name}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {h.address} • 📞 {h.phone}
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
  loadingContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  mapContainer: { width: '100%', height: '45%' },
  nativeFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  fallbackText: { fontSize: 16, fontWeight: '600', fontFamily: Fonts.sans },
  fallbackSub: { fontSize: 13, fontFamily: Fonts.sans },

  controls: { position: 'absolute', right: 16, top: 80, zIndex: 10 },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },

  dataPanel: {
    flex: 1,
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    marginTop: -16,
  },
  locationText: { fontSize: 12, fontFamily: Fonts.sans, marginBottom: 12 },
  sectionTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    fontFamily: Fonts.sans,
    marginTop: 12,
    marginBottom: 8,
  },
  emptyText: { fontSize: 13, fontFamily: Fonts.sans, marginBottom: 8, fontStyle: 'italic' },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  cardTitle: { fontWeight: '600', fontSize: 14, fontFamily: Fonts.sans },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
});
