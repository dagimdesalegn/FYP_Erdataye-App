import { AppHeader } from '@/components/app-header';
import { HtmlMapView } from '@/components/html-map-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    Ambulance,
    buildMapHtml,
    EmergencyRequest,
    formatCoords,
    getAvailableAmbulances,
    getHospitals,
    Hospital,
    normalizeEmergency,
    parsePostGISPoint,
} from '@/utils/emergency';
import { supabase } from '@/utils/supabase';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
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
  const [ambulances, setAmbulances] = useState<(Ambulance & { lat: number; lng: number })[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [hospitals, setHospitals] = useState<(Hospital & { lat: number; lng: number })[]>([]);
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
        .filter(Boolean) as (Ambulance & { lat: number; lng: number })[];
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
        .filter(Boolean) as (Hospital & { lat: number; lng: number })[];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const mapEmbedUrl = buildMapHtml(userLat, userLng, 17);

  const openInGoogleMaps = () => {
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${userLat},${userLng}`);
  };

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

      {/* Controls: Refresh + Open in Google Maps */}
      <View style={styles.controls}>
        <Pressable style={[styles.controlBtn, { backgroundColor: accentColor }]} onPress={fetchAllData}>
          <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
        </Pressable>
        <Pressable style={[styles.controlBtn, { backgroundColor: '#10B981', marginTop: 10 }]} onPress={openInGoogleMaps}>
          <MaterialIcons name="directions" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Data panel */}
      <ScrollView style={[styles.dataPanel, { backgroundColor: cardBg }]}>
        {location && (
          <ThemedText style={[styles.locationText, { color: subText }]}>
            📍 Your location: {formatCoords(userLat, userLng)}
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
              Type: {amb.type || 'Standard'} • {formatCoords(amb.lat, amb.lng)}
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

  mapContainer: { width: '100%', height: '50%', borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },

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
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
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
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardTitle: { fontWeight: '700', fontSize: 14, fontFamily: Fonts.sans },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 4, lineHeight: 18 },
});
