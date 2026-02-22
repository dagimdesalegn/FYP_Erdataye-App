import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signOut } from '@/utils/auth';
import { getDriverAssignment, sendLocationUpdate, subscribeToAssignments } from '@/utils/driver';
import { useRouter } from 'expo-router';

/**
 * Driver Home Screen - Status & Incoming Assignments
 */
export default function DriverHomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { user, setUser } = useAppState();
  
  const [isAvailable, setIsAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasAssignment, setHasAssignment] = useState(false);
  const [assignmentCount, setAssignmentCount] = useState(0);

  // Check for existing assignment
  useEffect(() => {
    if (!user) return;

    const checkAssignment = async () => {
      const { assignment, error } = await getDriverAssignment(user.id);
      if (!error && assignment) {
        setHasAssignment(true);
        setAssignmentCount((prev) => prev + 1);
      }
    };

    checkAssignment();
  }, [user]);

  // Subscribe to new assignments
  useEffect(() => {
    if (!user || !isAvailable) return;

    const unsubscribe = subscribeToAssignments(user.id, (assignment) => {
      setHasAssignment(true);
      setAssignmentCount((prev) => prev + 1);
      Alert.alert('New Emergency', 'You have a new emergency assignment');
    });

    return unsubscribe;
  }, [user, isAvailable]);

  // Send location updates when available
  useEffect(() => {
    if (!isAvailable || !user) return;

    let locationSubscription: Location.LocationSubscription | null = null;
    let intervalId: any = null;

    const startLocationTracking = async () => {
      try {
        // Request location permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location access is required for ambulance tracking');
          setIsAvailable(false);
          return;
        }

        // Send initial location
        const location = await Location.getCurrentPositionAsync();
        if (user.id) {
          // In production, get ambulance_id from driver profile
          await sendLocationUpdate(user.id, location.coords.latitude, location.coords.longitude);
        }

        // Send location updates every 10 seconds
        intervalId = setInterval(async () => {
          const currentLocation = await Location.getCurrentPositionAsync();
          if (user.id) {
            await sendLocationUpdate(user.id, currentLocation.coords.latitude, currentLocation.coords.longitude);
          }
        }, 10000);

        console.log('Location tracking started');
      } catch (error) {
        console.error('Error starting location tracking:', error);
      }
    };

    startLocationTracking();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAvailable, user]);

  const handleLogout = async () => {
    setIsAvailable(false);
    const { error } = await signOut();
    if (!error) {
      setUser(null);
      router.replace('/');
    } else {
      Alert.alert('Error', 'Failed to logout');
    }
  };

  const handleViewAssignment = () => {
    router.push('/driver-emergency' as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Loading..." />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <ThemedView style={styles.header}>
          <View>
            <ThemedText style={styles.greeting}>Welcome, Driver</ThemedText>
            <ThemedText style={styles.email}>{user?.email}</ThemedText>
          </View>
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="logout" size={24} color="#DC2626" />
          </Pressable>
        </ThemedView>

        {/* Status Card */}
        <ThemedView style={[styles.card, styles.statusCard]}>
          <ThemedText style={styles.cardTitle}>Driver Status</ThemedText>
          
          <Pressable
            onPress={() => setIsAvailable(!isAvailable)}
            style={[
              styles.statusToggle,
              {
                backgroundColor: isAvailable ? '#10B981' : '#6B7280',
              },
            ]}>
            <MaterialIcons
              name={isAvailable ? 'check-circle' : 'radio-button-unchecked'}
              size={32}
              color="#fff"
            />
            <View style={{ marginLeft: 12 }}>
              <ThemedText style={styles.statusLabel}>
                {isAvailable ? 'Available' : 'Offline'}
              </ThemedText>
              <ThemedText style={styles.statusSubtitle}>
                {isAvailable ? 'Ready to receive calls' : 'Not receiving calls'}
              </ThemedText>
            </View>
          </Pressable>
        </ThemedView>

        {/* Assignment Alert */}
        {hasAssignment && (
          <ThemedView style={[styles.card, styles.alertCard]}>
            <View style={styles.alertHeader}>
              <MaterialIcons name="priority-high" size={28} color="#DC2626" />
              <ThemedText style={styles.alertTitle}>New Assignment!</ThemedText>
            </View>
            <ThemedText style={styles.alertSubtitle}>
              You have {assignmentCount} incoming emergency{assignmentCount > 1 ? 's' : ''}
            </ThemedText>
            <AppButton
              label="View Assignment"
              onPress={handleViewAssignment}
              variant="primary"
              fullWidth
              style={{ marginTop: 12 }}
            />
          </ThemedView>
        )}

        {/* Quick Stats */}
        <View style={styles.statsGrid}>
          <ThemedView style={styles.statCard}>
            <MaterialIcons name="local-shipping" size={28} color="#0EA5E9" />
            <ThemedText style={styles.statNumber}>0</ThemedText>
            <ThemedText style={styles.statLabel}>Active</ThemedText>
          </ThemedView>

          <ThemedView style={styles.statCard}>
            <MaterialIcons name="check-circle" size={28} color="#10B981" />
            <ThemedText style={styles.statNumber}>0</ThemedText>
            <ThemedText style={styles.statLabel}>Completed</ThemedText>
          </ThemedView>

          <ThemedView style={styles.statCard}>
            <MaterialIcons name="schedule" size={28} color="#F59E0B" />
            <ThemedText style={styles.statNumber}>0</ThemedText>
            <ThemedText style={styles.statLabel}>Avg Response</ThemedText>
          </ThemedView>
        </View>

        {/* Help Section */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Need Help?</ThemedText>
          <Pressable style={styles.helpButton}>
            <MaterialIcons name="help-outline" size={20} color="#0EA5E9" />
            <ThemedText style={{ color: '#0EA5E9', marginLeft: 8 }}>Contact Support</ThemedText>
          </Pressable>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 12,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    marginBottom: 4,
  },
  email: {
    fontSize: 13,
    opacity: 0.6,
    fontFamily: Fonts.sans,
  },
  logoutBtn: {
    padding: 8,
    borderRadius: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  statusCard: {
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    fontFamily: Fonts.sans,
  },
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    fontFamily: Fonts.sans,
  },
  statusSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
    fontFamily: Fonts.sans,
  },
  alertCard: {
    borderColor: '#DC2626',
    borderWidth: 1,
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    marginBottom: 20,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    color: '#DC2626',
    fontFamily: Fonts.sans,
  },
  alertSubtitle: {
    fontSize: 13,
    marginBottom: 12,
    fontFamily: Fonts.sans,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
    fontFamily: Fonts.sans,
  },
  statLabel: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 4,
    fontFamily: Fonts.sans,
  },
  helpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
