import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ambulance, createEmergencyRequest, findNearestAmbulances } from '@/utils/emergency';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';

export default function EmergencyScreen() {
  const { user } = useAppState();
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [nearbyAmbulances, setNearbyAmbulances] = useState<Ambulance[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Get user's current location
  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return null;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
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
      // Get current location
      const currentLocation = await getUserLocation();
      if (!currentLocation) {
        Alert.alert('Error', 'Could not get your location. Please enable location services.');
        setLoading(false);
        return;
      }

      const { latitude, longitude } = currentLocation.coords;

      // Create emergency request in database
      const { request, error } = await createEmergencyRequest(
        user.id,
        latitude,
        longitude,
        'Emergency ambulance request',
        'critical'
      );

      if (error) {
        Alert.alert('Error', `Failed to create emergency request: ${error.message}`);
        setLoading(false);
        return;
      }

      // Find nearest ambulances
      const { ambulances, error: ambulanceError } = await findNearestAmbulances(latitude, longitude);

      if (ambulanceError) {
        console.warn('Warning getting ambulances:', ambulanceError.message);
        // Still show success even if we can't find ambulances nearby
      } else if (ambulances && ambulances.length > 0) {
        setNearbyAmbulances(ambulances);
      }

      Alert.alert(
        'Emergency Request Sent',
        `Your location (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) has been sent to nearby ambulances. Help is on the way!`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert('Error', `Emergency call failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Get location on component mount
    getUserLocation();
  }, []);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title" style={styles.title}>
          🚑 Emergency Ambulance Service
        </ThemedText>

        {errorMsg && <ThemedText style={styles.error}>{errorMsg}</ThemedText>}

        {location && (
          <ThemedText style={styles.locationText}>
            Your Location: {location.coords.latitude.toFixed(4)}, {location.coords.longitude.toFixed(4)}
          </ThemedText>
        )}

        <View style={styles.buttonContainer}>
          <View
            style={[
              styles.callButton,
              loading && styles.callButtonDisabled,
            ]}
          >
            {loading ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <View>
                <ThemedText style={styles.callButtonText} onPress={handleEmergencyCall}>
                  CALL AMBULANCE
                </ThemedText>
              </View>
            )}
          </View>
        </View>

        {nearbyAmbulances.length > 0 && (
          <View style={styles.ambulancesSection}>
            <ThemedText type="subtitle" style={styles.ambulancesTitle}>
              Nearby Ambulances ({nearbyAmbulances.length})
            </ThemedText>
            {nearbyAmbulances.map((ambulance) => (
              <View key={ambulance.id} style={styles.ambulanceCard}>
                <ThemedText style={styles.ambulanceText}>
                  🚐 {ambulance.vehicle_number}
                </ThemedText>
                <ThemedText style={styles.ambulanceStatus}>
                  Status: {ambulance.status}
                </ThemedText>
                <ThemedText style={styles.ambulanceLocation}>
                  Location: {ambulance.latitude.toFixed(4)}, {ambulance.longitude.toFixed(4)}
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
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  error: {
    color: 'red',
    marginBottom: 15,
    textAlign: 'center',
  },
  locationText: {
    marginBottom: 30,
    textAlign: 'center',
    fontSize: 14,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 30,
  },
  callButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  callButtonDisabled: {
    opacity: 0.6,
  },
  callButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  ambulancesSection: {
    width: '100%',
    marginTop: 20,
  },
  ambulancesTitle: {
    marginBottom: 10,
  },
  ambulanceCard: {
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  ambulanceText: {
    fontWeight: '600',
    marginBottom: 5,
  },
  ambulanceStatus: {
    fontSize: 12,
    marginBottom: 3,
  },
  ambulanceLocation: {
    fontSize: 12,
    marginTop: 5,
  },
});
