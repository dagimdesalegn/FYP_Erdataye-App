import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    sendLocationUpdate,
    subscribeToEmergencyStatus,
    updateEmergencyStatus
} from '@/utils/driver';

interface EmergencyUpdate {
  id: string;
  status: string;
  updated_at: string;
}

interface StatusTimeline {
  status: string;
  completed: boolean;
  timestamp?: string;
}

/**
 * Driver Emergency Tracking Screen - Update Emergency Status & Track Patient
 */
export default function DriverEmergencyTrackingScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { emergencyId } = useLocalSearchParams();
  const { user } = useAppState();

  const [currentStatus, setCurrentStatus] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [patientInfo, setPatientInfo] = useState<any>(null);
  const [hospitalInfo, setHospitalInfo] = useState<any>(null);
  const [locationTracking, setLocationTracking] = useState(true);

  const statusFlow = ['pending', 'assigned', 'en_route', 'at_scene', 'transporting', 'at_hospital', 'completed'];

  const statusTimeline: StatusTimeline[] = [
    { status: 'pending', completed: statusFlow.indexOf(currentStatus) >= 0 },
    { status: 'assigned', completed: statusFlow.indexOf(currentStatus) >= 1 },
    { status: 'en_route', completed: statusFlow.indexOf(currentStatus) >= 2 },
    { status: 'at_scene', completed: statusFlow.indexOf(currentStatus) >= 3 },
    { status: 'transporting', completed: statusFlow.indexOf(currentStatus) >= 4 },
    { status: 'at_hospital', completed: statusFlow.indexOf(currentStatus) >= 5 },
    { status: 'completed', completed: statusFlow.indexOf(currentStatus) >= 6 },
  ];

  // Load patient info and subscribe to status changes
  useEffect(() => {
    if (!emergencyId || !user) return;

    const loadData = async () => {
      try {
        setLoading(true);
        // Patient info will be fetched when status updates
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Subscribe to status changes
    const unsubscribe = subscribeToEmergencyStatus(emergencyId as string, (status: string) => {
      setCurrentStatus(status);
    });

    return unsubscribe;
  }, [emergencyId, user]);

  // Location tracking when en route or at scene
  useEffect(() => {
    if (
      !locationTracking ||
      !user ||
      !['en_route', 'at_scene', 'transporting'].includes(currentStatus)
    ) {
      return;
    }

    let intervalId: any = null;

    const startTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        // Send location immediately
        const location = await Location.getCurrentPositionAsync();
        await sendLocationUpdate(user.id, location.coords.latitude, location.coords.longitude);

        // Send location every 10 seconds
        intervalId = setInterval(async () => {
          const currentLoc = await Location.getCurrentPositionAsync();
          await sendLocationUpdate(user.id, currentLoc.coords.latitude, currentLoc.coords.longitude);
        }, 10000);
      } catch (error) {
        console.error('Location error:', error);
      }
    };

    startTracking();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [locationTracking, user, currentStatus]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!emergencyId || !user) return;

    try {
      setUpdating(true);
      const { error } = await updateEmergencyStatus(emergencyId as string, newStatus as any);

      if (error) {
        Alert.alert('Error', 'Failed to update status');
        return;
      }

      setCurrentStatus(newStatus);

      if (newStatus === 'completed') {
        Alert.alert('Success', 'Emergency marked as completed', [
          {
            text: 'Return Home',
            onPress: () => router.replace('/driver-home' as any),
          },
        ]);
      }
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Error', 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  const getStatusColor = (status: string, isCompleted: boolean) => {
    if (isCompleted) return '#10B981';
    if (status === currentStatus) return '#0EA5E9';
    return '#9CA3AF';
  };

  const getNextStatus = () => {
    const currentIndex = statusFlow.indexOf(currentStatus);
    return currentIndex < statusFlow.length - 1 ? statusFlow[currentIndex + 1] : null;
  };

  const nextStatus = getNextStatus();
  const canUpdate = currentStatus !== 'completed';

  return (
    <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={loading || updating} colorScheme={colorScheme} message="Updating..." />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Current Status Card */}
        <ThemedView style={styles.statusCard}>
          <ThemedText style={styles.cardTitle}>Current Status</ThemedText>
          <View
            style={[
              styles.currentStatusDisplay,
              { backgroundColor: getStatusColor(currentStatus, false) + '20' },
            ]}>
            <MaterialIcons
              name="assignment-turned-in"
              size={32}
              color={getStatusColor(currentStatus, false)}
            />
            <ThemedText style={[styles.currentStatusText, { color: getStatusColor(currentStatus, false) }]}>
              {currentStatus.replace(/_/g, ' ').toUpperCase()}
            </ThemedText>
          </View>
        </ThemedView>

        {/* Status Timeline */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Emergency Progress</ThemedText>

          {statusTimeline.map((item, index) => (
            <View key={item.status}>
              <View style={styles.timelineItem}>
                <View
                  style={[
                    styles.timelineNode,
                    {
                      backgroundColor: getStatusColor(item.status, item.completed),
                      borderColor: getStatusColor(item.status, item.completed),
                    },
                  ]}>
                  {item.completed && (
                    <MaterialIcons name="check" size={16} color="#fff" />
                  )}
                </View>

                <View style={styles.timelineContent}>
                  <ThemedText style={[styles.timelineStatus, { fontWeight: item.completed ? '700' : '500' }]}>
                    {item.status.replace(/_/g, ' ').toUpperCase()}
                  </ThemedText>
                </View>
              </View>

              {index < statusTimeline.length - 1 && (
                <View
                  style={[
                    styles.timelineConnector,
                    {
                      backgroundColor: getStatusColor(
                        item.status,
                        statusTimeline[index + 1]?.completed
                      ),
                    },
                  ]}
                />
              )}
            </View>
          ))}
        </ThemedView>

        {/* Action Button */}
        {canUpdate && nextStatus && (
          <ThemedView style={styles.card}>
            <ThemedText style={styles.cardTitle}>Next Action</ThemedText>
            <ThemedText style={styles.actionDescription}>
              When ready, update the emergency status to:
            </ThemedText>
            <ThemedText style={[styles.nextStatusText]}>
              {nextStatus.replace(/_/g, ' ').toUpperCase()}
            </ThemedText>

            <AppButton
              label={`Update to ${nextStatus.replace(/_/g, ' ').toUpperCase()}`}
              onPress={() => handleStatusUpdate(nextStatus)}
              variant="primary"
              fullWidth
              disabled={updating}
              style={{ marginTop: 12 }}
            />
          </ThemedView>
        )}

        {/* Location Tracking Toggle */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Location Tracking</ThemedText>
          <Pressable
            onPress={() => setLocationTracking(!locationTracking)}
            style={[
              styles.trackingToggle,
              {
                backgroundColor: locationTracking ? '#10B98120' : '#6B728020',
              },
            ]}>
            <MaterialIcons
              name={locationTracking ? 'location-on' : 'location-off'}
              size={24}
              color={locationTracking ? '#10B981' : '#6B7280'}
            />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.trackingLabel}>
                {locationTracking ? 'Location Sharing Active' : 'Location Sharing Inactive'}
              </ThemedText>
              <ThemedText style={styles.trackingSubtitle}>
                {locationTracking
                  ? 'Patient can see your location'
                  : 'Patient cannot see your location'}
              </ThemedText>
            </View>
          </Pressable>
        </ThemedView>

        {/* Emergency Info */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Emergency Information</ThemedText>

          <View style={styles.infoRow}>
            <MaterialIcons name="assignment" size={20} color="#0EA5E9" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.infoLabel}>Emergency ID</ThemedText>
              <ThemedText style={styles.infoValue}>{emergencyId}</ThemedText>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <MaterialIcons name="schedule" size={20} color="#0EA5E9" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.infoLabel}>Time in Progress</ThemedText>
              <ThemedText style={styles.infoValue}>Tracking...</ThemedText>
            </View>
          </View>
        </ThemedView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  statusCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    fontFamily: Fonts.sans,
  },
  currentStatusDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  currentStatusText: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 12,
    fontFamily: Fonts.sans,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  timelineNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  timelineContent: {
    flex: 1,
    paddingTop: 6,
  },
  timelineStatus: {
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  timelineConnector: {
    width: 2,
    height: 24,
    marginLeft: 14,
    marginBottom: 4,
  },
  actionDescription: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 8,
    fontFamily: Fonts.sans,
  },
  nextStatusText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0EA5E9',
    marginBottom: 12,
    fontFamily: Fonts.sans,
  },
  trackingToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  trackingLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
  trackingSubtitle: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
    fontFamily: Fonts.sans,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 12,
    opacity: 0.6,
    fontFamily: Fonts.sans,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: Fonts.sans,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginVertical: 12,
  },
});
