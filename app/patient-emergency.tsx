import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Animated,
    Dimensions,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createEmergency, getActiveEmergency } from '@/utils/patient';
import { useRouter } from 'expo-router';

export default function PatientEmergencyScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { user } = useAppState();

  const [hasActiveEmergency, setHasActiveEmergency] = useState(false);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [description, setDescription] = useState('');
  const [patientCondition, setPatientCondition] = useState('');
  const [activeEmergencyId, setActiveEmergencyId] = useState<string | null>(null);

  const screenHeight = Dimensions.get('window').height;
  const scaleAnim = new Animated.Value(1);

  useEffect(() => {
    checkActiveEmergency();
    requestLocationPermission();
  }, [user?.id]);

  const checkActiveEmergency = async () => {
    if (!user?.id) return;
    const { emergency } = await getActiveEmergency(user.id);
    if (emergency) {
      setHasActiveEmergency(true);
      setActiveEmergencyId(emergency.id);
    } else {
      setHasActiveEmergency(false);
      setActiveEmergencyId(null);
    }
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to request emergency services');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Could not get your location. Please enable location services.');
    }
  };

  const handleSOS = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    if (!location) {
      Alert.alert('Error', 'Location not available. Please enable location services.');
      return;
    }

    Alert.alert(
      'Confirm Emergency Call',
      `Severity: ${severity}\n\nAre you sure you want to request emergency ambulance service?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Call Ambulance',
          style: 'destructive',
          onPress: () => createEmergencyRequest(),
        },
      ]
    );
  };

  const createEmergencyRequest = async () => {
    if (!user?.id || !location) return;

    setLoading(true);
    try {
      const { emergency, error } = await createEmergency(
        user.id,
        location.latitude,
        location.longitude,
        severity,
        description || undefined,
        patientCondition || undefined
      );

      if (error || !emergency) {
        Alert.alert('Error', `Failed to create emergency: ${error?.message}`);
        return;
      }

      setHasActiveEmergency(true);
      setActiveEmergencyId(emergency.id);

      // Clear form
      setDescription('');
      setPatientCondition('');

      Alert.alert(
        'Emergency Request Sent',
        'Your emergency request has been sent. Ambulance dispatch is in progress.\n\nStay calm and follow dispatcher instructions.'
      );

      // Navigate to tracking screen
      setTimeout(() => {
        router.push(`/patient-emergency-tracking?emergencyId=${emergency.id}`);
      }, 1000);
    } catch (error) {
      console.error('Error creating emergency:', error);
      Alert.alert('Error', `Failed to request emergency services: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePulseAnimation = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const SeverityButton = ({
    level,
    label,
    color,
  }: {
    level: 'low' | 'medium' | 'high' | 'critical';
    label: string;
    color: string;
  }) => {
    const isSelected = severity === level;
    return (
      <Pressable
        onPress={() => !hasActiveEmergency && setSeverity(level)}
        disabled={hasActiveEmergency}
        style={({ pressed }) => [
          styles.severityButton,
          isSelected
            ? {
                backgroundColor: color,
                borderColor: color,
              }
            : {
                backgroundColor: isDark ? '#0B1220' : '#F8FAFC',
                borderColor: isDark ? '#2E3236' : '#E6ECF2',
              },
          pressed && { opacity: 0.8 },
          hasActiveEmergency && { opacity: 0.5 },
        ]}>
        <ThemedText
          style={[
            styles.severityLabel,
            isSelected && { color: '#FFFFFF', fontWeight: '700' },
          ]}>
          {label}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Requesting ambulance..." />

      <AppHeader title="Emergency Service" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <ThemedView style={styles.card}>
          {/* Status Badge */}
          <View style={styles.statusContainer}>
            <View
              style={[
                styles.statusBadge,
                hasActiveEmergency ? styles.activeBadge : styles.inactiveBadge,
              ]}>
              <MaterialIcons
                name={hasActiveEmergency ? 'check-circle' : 'radio-button-unchecked'}
                size={16}
                color={hasActiveEmergency ? '#10B981' : '#94A3B8'}
              />
              <ThemedText
                style={[
                  styles.statusText,
                  hasActiveEmergency && { color: '#10B981', fontWeight: '700' },
                ]}>
                {hasActiveEmergency ? 'Emergency Active' : 'No Active Emergency'}
              </ThemedText>
            </View>
          </View>

          {hasActiveEmergency ? (
            // Active Emergency View
            <>
              <ThemedText style={styles.title}>Active Emergency</ThemedText>
              <ThemedText style={styles.subtitle}>
                Your emergency request is in progress
              </ThemedText>

              <View style={styles.infoCard}>
                <MaterialIcons name="info" size={20} color="#0EA5E9" />
                <ThemedText style={styles.infoText}>
                  A dispatcher has received your call and is locating the nearest ambulance.
                </ThemedText>
              </View>

              <AppButton
                label="View Status"
                onPress={() =>
                  router.push(`/patient-emergency-tracking?emergencyId=${activeEmergencyId}`)
                }
                variant="primary"
                fullWidth
              />

              <AppButton
                label="Call Dispatcher"
                onPress={() =>
                  Alert.alert('Dispatcher', 'Calling dispatch center...')
                }
                variant="secondary"
                fullWidth
                style={styles.secondaryBtn}
              />
            </>
          ) : (
            // No Emergency View
            <>
              <ThemedText style={styles.title}>Request Emergency Service</ThemedText>
              <ThemedText style={styles.subtitle}>
                Your location: {location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : 'Loading...'}
              </ThemedText>

              {/* Severity Selection */}
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Emergency Severity</ThemedText>
                <View style={styles.severityGrid}>
                  <SeverityButton level="low" label="Low" color="#3B82F6" />
                  <SeverityButton level="medium" label="Medium" color="#F59E0B" />
                  <SeverityButton level="high" label="High" color="#EF4444" />
                  <SeverityButton level="critical" label="Critical" color="#DC2626" />
                </View>
              </View>

              {/* Description */}
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Emergency Details</ThemedText>

                <ThemedText style={styles.label}>Description (optional)</ThemedText>
                <TextInput
                  style={[styles.input, isDark ? styles.inputDark : null]}
                  placeholder="Describe your emergency..."
                  placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                />

                <ThemedText style={styles.label}>Your Condition (optional)</ThemedText>
                <TextInput
                  style={[styles.input, isDark ? styles.inputDark : null]}
                  placeholder="Describe your current condition..."
                  placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                  value={patientCondition}
                  onChangeText={setPatientCondition}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* SOS Button */}
              <Animated.View
                style={[styles.sosButtonContainer, { transform: [{ scale: scaleAnim }] }]}>
                <Pressable
                  onPress={() => {
                    handlePulseAnimation();
                    handleSOS();
                  }}
                  style={({ pressed }) => [
                    styles.sosButton,
                    pressed && { opacity: 0.9 },
                  ]}>
                  <MaterialIcons name="phone" size={32} color="white" />
                  <ThemedText style={styles.sosButtonText}>SOS - Call Ambulance</ThemedText>
                </Pressable>
              </Animated.View>

              <ThemedText style={styles.disclaimerText}>
                For life-threatening emergencies, also call your local emergency number (911, 112, etc.)
              </ThemedText>
            </>
          )}
        </ThemedView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EEF2F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  statusContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  activeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#10B981',
  },
  inactiveBadge: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderColor: '#94A3B8',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#94A3B8',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    fontFamily: Fonts.sans,
    fontWeight: '500',
    marginBottom: 16,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(14, 165, 233, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    color: '#0284C7',
    flex: 1,
    lineHeight: 18,
  },
  section: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    marginBottom: 12,
  },
  severityGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  severityButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  severityLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#64748B',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 0.8,
    borderColor: '#E6ECF2',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    fontSize: 14,
    color: '#11181C',
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
  inputDark: {
    backgroundColor: '#0B1220',
    borderColor: '#2E3236',
    color: '#ECEDEE',
  },
  sosButtonContainer: {
    marginVertical: 20,
  },
  sosButton: {
    backgroundColor: '#DC2626',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  sosButtonText: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    color: 'white',
  },
  disclaimerText: {
    fontSize: 12,
    color: '#EF4444',
    fontFamily: Fonts.sans,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 12,
    lineHeight: 16,
  },
  secondaryBtn: {
    marginTop: 10,
  },
});
