import { AppHeader } from '@/components/app-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAppState } from '@/components/app-state';
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
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Callout, Marker, Region } from 'react-native-maps';

export default function MapScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const { user } = useAppState();

  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  // Default to Addis Ababa
  const [region, setRegion] = useState<Region>({
    latitude: 9.02,
    longitude: 38.75,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });
  const [ambulances, setAmbulances] = useState<Array<Ambulance & { lat: number; lng: number }>>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [hospitals, setHospitals] = useState<Array<Hospital & { lat: number; lng: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [trackingUser, setTrackingUser] = useState(true);

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

      if (trackingUser) {
        const newRegion = {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);
      }

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

  const centerOnUser = () => {
    if (location) {
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      mapRef.current?.animateToRegion(newRegion, 1000);
      setTrackingUser(true);
    } else {
      getUserLocation();
    }
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

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        region={region}
        onRegionChangeComplete={(r) => {
          setRegion(r);
          setTrackingUser(false);
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        showsTraffic={true}
        loadingEnabled={true}
        mapType="standard"
      >
        {/* Ambulance Markers */}
        {ambulances.map((amb) => (
          <Marker
            key={amb.id}
            coordinate={{ latitude: amb.lat, longitude: amb.lng }}
            title={`Ambulance ${amb.vehicle_number}`}
            description={`Type: ${amb.type || 'Standard'}`}
          >
            <View style={styles.ambulanceMarker}>
              <ThemedText style={styles.markerEmoji}>🚑</ThemedText>
            </View>
            <Callout>
              <View style={styles.callout}>
                <ThemedText style={styles.calloutTitle}>Ambulance {amb.vehicle_number}</ThemedText>
                <ThemedText style={styles.calloutText}>Type: {amb.type || 'Standard'}</ThemedText>
                <ThemedText style={styles.calloutText}>
                  {amb.lat.toFixed(5)}, {amb.lng.toFixed(5)}
                </ThemedText>
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Emergency Markers */}
        {emergencies
          .filter((e) => e.latitude !== 0 || e.longitude !== 0)
          .map((emergency) => (
            <Marker
              key={emergency.id}
              coordinate={{ latitude: emergency.latitude, longitude: emergency.longitude }}
              title="Emergency"
              description={emergency.description}
            >
              <View style={styles.emergencyMarker}>
                <MaterialIcons name="warning" size={22} color="#FFFFFF" />
              </View>
              <Callout>
                <View style={styles.callout}>
                  <ThemedText style={styles.calloutTitle}>Emergency</ThemedText>
                  <ThemedText style={styles.calloutText}>Status: {emergency.status}</ThemedText>
                  <ThemedText style={styles.calloutText}>Type: {emergency.emergency_type}</ThemedText>
                  <ThemedText style={styles.calloutText}>{emergency.description}</ThemedText>
                </View>
              </Callout>
            </Marker>
          ))}

        {/* Hospital Markers */}
        {hospitals.map((hospital) => (
          <Marker
            key={hospital.id}
            coordinate={{ latitude: hospital.lat, longitude: hospital.lng }}
            title={hospital.name}
            description={hospital.address}
          >
            <View style={styles.hospitalMarker}>
              <ThemedText style={styles.markerEmoji}>🏥</ThemedText>
            </View>
            <Callout>
              <View style={styles.callout}>
                <ThemedText style={styles.calloutTitle}>{hospital.name}</ThemedText>
                <ThemedText style={styles.calloutText}>{hospital.address}</ThemedText>
                <ThemedText style={styles.calloutText}>📞 {hospital.phone}</ThemedText>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Map Controls */}
      <View style={styles.controls}>
        <Pressable style={[styles.controlBtn, { backgroundColor: accentColor }]} onPress={centerOnUser}>
          <MaterialIcons name="my-location" size={24} color="#FFFFFF" />
        </Pressable>
        <Pressable style={[styles.controlBtn, { backgroundColor: accentColor }]} onPress={fetchAllData}>
          <MaterialIcons name="refresh" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Legend */}
      <View style={[styles.legend, { backgroundColor: isDark ? '#0B1220' : '#FFFFFF' }]}>
        <ThemedText style={[styles.legendTitle, { color: textColor }]}>Map Legend</ThemedText>
        <View style={styles.legendItem}>
          <ThemedText style={styles.legendEmoji}>🚑</ThemedText>
          <ThemedText style={[styles.legendText, { color: subText }]}>Ambulance</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <MaterialIcons name="warning" size={16} color="#EF4444" />
          <ThemedText style={[styles.legendText, { color: subText }]}>Emergency</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <ThemedText style={styles.legendEmoji}>🏥</ThemedText>
          <ThemedText style={[styles.legendText, { color: subText }]}>Hospital</ThemedText>
        </View>
      </View>

      {/* Info bar */}
      {location && (
        <View style={[styles.infoBar, { backgroundColor: isDark ? '#0B1220' : '#FFFFFF' }]}>
          <ThemedText style={[styles.infoBarText, { color: subText }]}>
            📍 {location.coords.latitude.toFixed(5)}, {location.coords.longitude.toFixed(5)}
            {'  '}• Accuracy: {location.coords.accuracy?.toFixed(0)}m
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  ambulanceMarker: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 4,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  emergencyMarker: {
    backgroundColor: '#EF4444',
    borderRadius: 20,
    padding: 6,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  hospitalMarker: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 4,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  markerEmoji: {
    fontSize: 26,
  },
  callout: {
    minWidth: 150,
    maxWidth: 250,
    padding: 4,
  },
  calloutTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
    fontFamily: Fonts.sans,
  },
  calloutText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  controls: {
    position: 'absolute',
    right: 16,
    bottom: 120,
    gap: 12,
  },
  controlBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  legend: {
    position: 'absolute',
    left: 16,
    bottom: 80,
    padding: 12,
    borderRadius: 12,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  legendTitle: {
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 8,
    fontFamily: Fonts.sans,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
    gap: 6,
  },
  legendEmoji: {
    fontSize: 16,
  },
  legendText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  infoBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 16,
    left: 16,
    right: 16,
    padding: 10,
    borderRadius: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    alignItems: 'center',
  },
  infoBarText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
});
