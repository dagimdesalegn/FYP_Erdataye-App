import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signOut } from '@/utils/auth';
import {
    getDriverAmbulanceDetails,
    getDriverAmbulanceId,
    getDriverAssignment,
    sendLocationUpdate,
    subscribeToAssignments,
    type AmbulanceDetails,
} from '@/utils/driver';
import { getUserProfile, type UserProfile } from '@/utils/profile';
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
  const [loading] = useState(false);
  const [hasAssignment, setHasAssignment] = useState(false);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [ambulanceId, setAmbulanceId] = useState<string | null>(null);
  const [ambulanceDetails, setAmbulanceDetails] = useState<AmbulanceDetails | null>(null);

  // Profile modal
  const [profileVisible, setProfileVisible] = useState(false);
  const [driverProfile, setDriverProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Load driver's ambulance ID and details
  useEffect(() => {
    if (!user) return;

    const loadAmbulance = async () => {
      const { ambulanceId: id, error } = await getDriverAmbulanceId(user.id);
      if (error) {
        console.error('Failed to load driver ambulance:', error);
        return;
      }
      setAmbulanceId(id);

      // Also load full details
      const { ambulance } = await getDriverAmbulanceDetails(user.id);
      if (ambulance) setAmbulanceDetails(ambulance);
    };

    loadAmbulance();
  }, [user]);

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

    const unsubscribe = subscribeToAssignments(user.id, (_assignment) => {
      setHasAssignment(true);
      setAssignmentCount((prev) => prev + 1);
      Alert.alert('New Emergency', 'You have a new emergency assignment');
    });

    return unsubscribe;
  }, [user, isAvailable]);

  // Send location updates when available
  useEffect(() => {
    if (!isAvailable || !user || !ambulanceId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startLocationTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location access is required for ambulance tracking');
          setIsAvailable(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync();
        await sendLocationUpdate(ambulanceId, location.coords.latitude, location.coords.longitude);

        intervalId = setInterval(async () => {
          const currentLocation = await Location.getCurrentPositionAsync();
          await sendLocationUpdate(
            ambulanceId,
            currentLocation.coords.latitude,
            currentLocation.coords.longitude
          );
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
  }, [isAvailable, user, ambulanceId]);

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

  const handleProfilePress = async () => {
    setProfileVisible(true);
    if (!user?.id || driverProfile) return;
    setProfileLoading(true);
    try {
      const { profile } = await getUserProfile(user.id);
      if (profile) setDriverProfile(profile);
    } catch (e) {
      console.error('Error loading driver profile:', e);
    } finally {
      setProfileLoading(false);
    }
  };

  // --- Profile Info Row ---
  const InfoRow = ({
    icon,
    label,
    value,
  }: {
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    value: string;
  }) => (
    <View style={styles.infoRow}>
      <MaterialIcons
        name={icon}
        size={20}
        color={isDark ? '#0EA5E9' : '#0284C7'}
        style={{ marginRight: 12 }}
      />
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.infoLabel}>{label}</ThemedText>
        <ThemedText style={styles.infoValue}>{value || '—'}</ThemedText>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Loading..." />

      {/* App Header – project name top-left, theme toggle + profile icon top-right */}
      <AppHeader title="Erdataya Ambulance" onProfilePress={handleProfilePress} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Welcome Card */}
        <ThemedView style={styles.welcomeCard}>
          <View style={styles.welcomeRow}>
            <View style={[styles.avatarCircle, isDark && styles.avatarCircleDark]}>
              <MaterialIcons
                name="local-shipping"
                size={28}
                color={isDark ? '#0EA5E9' : '#0284C7'}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <ThemedText style={styles.greeting}>
                Welcome, {user?.fullName || 'Driver'}
              </ThemedText>
              <ThemedText style={styles.email}>{user?.phone}</ThemedText>
            </View>
          </View>
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
              You have {assignmentCount} incoming emergency
              {assignmentCount > 1 ? 's' : ''}
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

        {/* Sign Out */}
        <AppButton
          label="Sign Out"
          onPress={handleLogout}
          variant="secondary"
          fullWidth
          style={{ marginTop: 8 }}
        />
      </ScrollView>

      {/* ===== Driver Profile Modal (read-only) ===== */}
      <Modal
        visible={profileVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setProfileVisible(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView
            style={[
              styles.modalContent,
              { backgroundColor: isDark ? '#111827' : '#FFFFFF' },
            ]}>
            {/* Close button top-right of the modal card */}
            <Pressable
              onPress={() => setProfileVisible(false)}
              style={[
                styles.modalCloseBtn,
                {
                  backgroundColor: isDark ? '#1E2028' : '#F1F5F9',
                  borderColor: isDark ? '#2E3236' : '#E6ECF2',
                },
              ]}>
              <MaterialIcons
                name="close"
                size={20}
                color={isDark ? '#E6E9EC' : '#11181C'}
              />
            </Pressable>

            {/* Avatar */}
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View
                style={[
                  styles.profileAvatar,
                  isDark ? styles.profileAvatarDark : styles.profileAvatarLight,
                ]}>
                <MaterialIcons
                  name="person"
                  size={40}
                  color={isDark ? '#0EA5E9' : '#0284C7'}
                />
              </View>
              <ThemedText style={styles.profileTitle}>Driver Profile</ThemedText>
            </View>

            {profileLoading ? (
              <ThemedText style={{ textAlign: 'center', marginVertical: 20, opacity: 0.6 }}>
                Loading...
              </ThemedText>
            ) : driverProfile ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 360 }}>
                <InfoRow icon="person" label="Full Name" value={driverProfile.full_name} />
                <InfoRow icon="phone" label="Phone" value={driverProfile.phone} />
                <InfoRow icon="badge" label="Role" value={driverProfile.role} />
                <InfoRow
                  icon="directions-car"
                  label="Plate Number"
                  value={ambulanceDetails?.vehicle_number || 'Not assigned'}
                />
                <InfoRow
                  icon="assignment"
                  label="Registration No."
                  value={ambulanceDetails?.registration_number || 'Not assigned'}
                />
                <InfoRow
                  icon="local-hospital"
                  label="Hospital"
                  value={driverProfile.hospital_id || 'Not assigned'}
                />
                <InfoRow
                  icon="calendar-today"
                  label="Member Since"
                  value={
                    driverProfile.created_at
                      ? new Date(driverProfile.created_at).toLocaleDateString()
                      : ''
                  }
                />
              </ScrollView>
            ) : (
              <ThemedText style={{ textAlign: 'center', marginVertical: 20, opacity: 0.6 }}>
                No profile data available
              </ThemedText>
            )}
          </ThemedView>
        </View>
      </Modal>
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
  welcomeCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircleDark: {
    backgroundColor: '#0C1F3A',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    marginBottom: 2,
  },
  email: {
    fontSize: 13,
    opacity: 0.6,
    fontFamily: Fonts.sans,
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
  /* ---- Profile Modal ---- */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileAvatarLight: {
    backgroundColor: '#F0F9FF',
  },
  profileAvatarDark: {
    backgroundColor: '#0C1F3A',
  },
  profileTitle: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: Fonts.sans,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.5,
    fontFamily: Fonts.sans,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
});
