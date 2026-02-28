import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  Ambulance,
  createEmergencyRequest,
  findNearestAmbulance,
  getAvailableAmbulances,
  parsePostGISPoint,
} from '@/utils/emergency';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

export default function EmergencyScreen() {
  const { user } = useAppState();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const textColor = Colors[theme].text;
  const subText = isDark ? '#B7BDC3' : '#475569';

  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [nearbyAmbulances, setNearbyAmbulances] = useState<Array<Ambulance & { lat: number; lng: number }>>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Get user's current location with high accuracy
  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return null;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setLocation(currentLocation);
      return currentLocation;
    } catch (error) {
      setErrorMsg(`Error getting location: ${error}`);
      return null;
    }
  };

  // Call emergency
  const handleEmergencyCall = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to call an ambulance');
      return;
    }

    setLoading(true);
    try {
      const currentLocation = await getUserLocation();
      if (!currentLocation) {
        Alert.alert('Error', 'Could not get your location. Please enable location services.');
        setLoading(false);
        return;
      }

      const { latitude, longitude } = currentLocation.coords;

      // Create emergency request
      const { request, error } = await createEmergencyRequest(
        user.id,
        latitude,
        longitude,
        'Emergency ambulance request',
        'medical'
      );

      if (error) {
        Alert.alert('Error', `Failed to create emergency request: ${error.message}`);
        setLoading(false);
        return;
      }

      // Try to find nearest ambulance
      const { ambulanceId, error: ambulanceError } = await findNearestAmbulance(latitude, longitude);
      if (ambulanceError) {
        console.warn('Warning finding nearest ambulance:', ambulanceError.message);
      }

      // Fetch available ambulances for display
      const { ambulances } = await getAvailableAmbulances();
      if (ambulances && ambulances.length > 0) {
        const parsed = ambulances
          .map((a) => {
            const loc = parsePostGISPoint(a.last_known_location);
            return loc ? { ...a, lat: loc.latitude, lng: loc.longitude } : null;
          })
          .filter(Boolean) as Array<Ambulance & { lat: number; lng: number }>;
        setNearbyAmbulances(parsed);
      }

      Alert.alert(
        'Emergency Request Sent',
        `Your location (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) has been sent. Help is on the way!`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert('Error', `Emergency call failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getUserLocation();
  }, []);

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="Erdataya" />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title" style={[styles.title, { color: textColor }]}>
          🚑 Emergency Ambulance Service
        </ThemedText>

        {errorMsg && <ThemedText style={styles.error}>{errorMsg}</ThemedText>}

        {location && (
          <View style={[styles.locationCard, { backgroundColor: isDark ? '#0B1220' : '#F0F9FF', borderColor: isDark ? '#2E3236' : '#BAE6FD' }]}>
            <MaterialIcons name="my-location" size={18} color="#3B82F6" />
            <ThemedText style={[styles.locationText, { color: subText }]}>
              {location.coords.latitude.toFixed(5)}, {location.coords.longitude.toFixed(5)}
              {'  '}• Accuracy: {location.coords.accuracy?.toFixed(0)}m
            </ThemedText>
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
                <ThemedText style={styles.callButtonText}>CALL{'\n'}AMBULANCE</ThemedText>
              </>
            )}
          </Pressable>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: '#3B82F6' }]}
            onPress={() => router.push('/map')}
          >
            <MaterialIcons name="map" size={22} color="#fff" />
            <ThemedText style={styles.actionBtnText}>Live Map</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: '#10B981' }]}
            onPress={() => router.push('/hospital')}
          >
            <MaterialIcons name="local-hospital" size={22} color="#fff" />
            <ThemedText style={styles.actionBtnText}>Hospital</ThemedText>
          </Pressable>
        </View>

        {/* Nearby Ambulances */}
        {nearbyAmbulances.length > 0 && (
          <View style={styles.ambulancesSection}>
            <ThemedText type="subtitle" style={[styles.ambulancesTitle, { color: textColor }]}>
              Available Ambulances ({nearbyAmbulances.length})
            </ThemedText>
            {nearbyAmbulances.map((ambulance) => (
              <View
                key={ambulance.id}
                style={[styles.ambulanceCard, { backgroundColor: isDark ? '#0B1220' : '#F8FAFC', borderColor: isDark ? '#2E3236' : '#EEF2F6' }]}
              >
                <View style={styles.ambulanceRow}>
                  <ThemedText style={[styles.ambulanceText, { color: textColor }]}>
                    🚑 {ambulance.vehicle_number}
                  </ThemedText>
                  <ThemedText style={[styles.ambulanceType, { color: subText }]}>
                    {ambulance.type || 'Standard'}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.ambulanceLocation, { color: subText }]}>
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
    alignItems: 'center',
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
    fontFamily: Fonts.sans,
  },
  error: {
    color: '#DC2626',
    marginBottom: 15,
    textAlign: 'center',
    fontFamily: Fonts.sans,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 24,
    width: '100%',
  },
  locationText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 24,
  },
  callButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#DC2626',
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
    color: 'white',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    fontFamily: Fonts.sans,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 24,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
  ambulancesSection: {
    width: '100%',
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  ambulanceText: {
    fontWeight: '600',
    fontSize: 15,
    fontFamily: Fonts.sans,
  },
  ambulanceType: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: Fonts.sans,
  },
  ambulanceLocation: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
});
