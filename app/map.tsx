import NativeMapView from '@/components/native-map-view';
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
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';

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

  // Get user's current location with high accuracy
  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for the map');
        return null;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });

      setLocation(currentLocation);
      return currentLocation;
    } catch (error) {
      console.error('Error getting location:', error);
      return null;
    }
  };

  // Fetch ambulances with PostGIS location parsing
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

  // Fetch active emergencies
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

  // Fetch hospitals with PostGIS location parsing
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

  // Load all data
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

    // Real-time subscriptions
    const ambulanceSub = supabase
      .channel('map_ambulance_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ambulances' }, () => fetchAmbulances())
      .subscribe();

    const emergencySub = supabase
      .channel('map_emergency_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_requests' }, () => fetchEmergencies())
      .subscribe();

    // Refresh user location every 10 seconds
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
        <ActivityIndicator size="large" color={accentColor} />
        <ThemedText style={{ marginTop: 16, color: textColor, fontFamily: Fonts.sans }}>Loading map…</ThemedText>
      </ThemedView>
    );
  }

  const userLat = location?.coords.latitude ?? 9.02;
  const userLng = location?.coords.longitude ?? 38.75;
  const accuracy = location?.coords.accuracy ?? null;

  return (
    <NativeMapView
      userLat={userLat}
      userLng={userLng}
      accuracy={accuracy}
      ambulances={ambulances}
      emergencies={emergencies}
      hospitals={hospitals}
      isDark={isDark}
      accentColor={accentColor}
      textColor={textColor}
      subText={subText}
      onCenterUser={() => getUserLocation()}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
