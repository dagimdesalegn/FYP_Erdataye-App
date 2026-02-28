import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    acceptEmergency,
    declineEmergency,
    getDriverAssignment,
    getPatientInfo,
} from '@/utils/driver';
import { parsePostGISPoint } from '@/utils/emergency';
import { useRouter } from 'expo-router';

interface PatientInfo {
  id: string;
  full_name: string;
  phone: string;
}

/**
 * Driver Emergency Assignment Screen - Accept/Decline Emergency
 */
export default function DriverEmergencyScreen() {
  const router = useRouter();
  useColorScheme();
  const { user } = useAppState();

  const [assignment, setAssignment] = useState<any>(null);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Load assignment details
  useEffect(() => {
    if (!user) return;

    const loadAssignment = async () => {
      try {
        setLoading(true);
        const { assignment, error } = await getDriverAssignment(user.id);

        if (error) {
          Alert.alert('Error', 'Failed to load assignment');
          router.back();
          return;
        }

        if (assignment) {
          setAssignment(assignment);

          // Load patient info
          const { info, error: patientError } = await getPatientInfo(
            assignment.emergency_requests?.patient_id || ''
          );
          if (!patientError && info) {
            setPatientInfo(info);
          }
        }
      } catch (error) {
        console.error('Error loading assignment:', error);
        Alert.alert('Error', 'Failed to load assignment details');
      } finally {
        setLoading(false);
      }
    };

    loadAssignment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAccept = async () => {
    if (!assignment || !user) return;

    try {
      setProcessing(true);
      const { error } = await acceptEmergency(assignment.id, assignment.emergency_id);

      if (error) {
        Alert.alert('Error', error.message || 'Failed to accept emergency');
        return;
      }

      // Navigate to emergency tracking
      router.replace({
        pathname: '/driver-emergency-tracking' as any,
        params: { emergencyId: assignment.emergency_id },
      });
    } catch (error) {
      console.error('Error accepting emergency:', error);
      Alert.alert('Error', 'Failed to accept emergency');
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!assignment || !user) return;

    Alert.alert(
      'Decline Emergency?',
      'Are you sure you want to decline this assignment?',
      [
        {
          text: 'Cancel',
          onPress: () => {},
          style: 'cancel',
        },
        {
          text: 'Decline',
          onPress: async () => {
            try {
              setProcessing(true);
              const { error } = await declineEmergency(assignment.id);

              if (error) {
                Alert.alert('Error', error.message || 'Failed to decline assignment');
                return;
              }

              // Go back to home
              router.replace('/driver-home' as any);
              Alert.alert('Success', 'Assignment declined');
            } catch (error) {
              console.error('Error declining emergency:', error);
              Alert.alert('Error', 'Failed to decline assignment');
            } finally {
              setProcessing(false);
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return '#DC2626';
      case 'high':
        return '#F59E0B';
      case 'medium':
        return '#0EA5E9';
      case 'low':
        return '#10B981';
      default:
        return '#6B7280';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'priority-high';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      default:
        return 'check-circle';
    }
  };

  if (loading) {
    return <LoadingModal visible={true} colorScheme={colorScheme} message="Loading assignment..." />;
  }

  if (!assignment) {
    return (
      <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
        <View style={styles.emptyContainer}>
          <MaterialIcons name="assignment-late" size={48} color="#9CA3AF" />
          <ThemedText style={styles.emptyText}>No assignments available</ThemedText>
        </View>
      </View>
    );
  }

  const emergency = assignment.emergency_requests;
  const emergencyCoords = parsePostGISPoint(emergency.patient_location);
  const severityColor = getSeverityColor(emergency.emergency_type);
  const severityIcon = getSeverityIcon(emergency.emergency_type);

  return (
    <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={processing} colorScheme={colorScheme} message="Processing..." />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Severity Header */}
        <ThemedView
          style={[
            styles.severityHeader,
            { backgroundColor: severityColor, opacity: 0.1 },
          ]}>
          <MaterialIcons name={severityIcon} size={48} color={severityColor} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <ThemedText style={[styles.severity, { color: severityColor }]}>
              {emergency.emergency_type?.toUpperCase() || 'UNKNOWN'} SEVERITY
            </ThemedText>
            <ThemedText style={styles.emergencyType}>Emergency Request</ThemedText>
          </View>
        </ThemedView>

        {/* Emergency Details */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Emergency Details</ThemedText>

          <View style={styles.detailRow}>
            <MaterialIcons name="location-on" size={20} color="#0EA5E9" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.detailLabel}>Location</ThemedText>
              <ThemedText style={styles.detailValue}>
                {Number(emergencyCoords?.latitude ?? 0).toFixed(4)}, {Number(emergencyCoords?.longitude ?? 0).toFixed(4)}
              </ThemedText>
            </View>
          </View>

          <View style={styles.detailRow}>
            <MaterialIcons name="description" size={20} color="#0EA5E9" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.detailLabel}>Description</ThemedText>
              <ThemedText style={styles.detailValue}>{emergency.description}</ThemedText>
            </View>
          </View>

          <View style={styles.detailRow}>
            <MaterialIcons name="access-time" size={20} color="#0EA5E9" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.detailLabel}>Status</ThemedText>
              <ThemedText style={styles.detailValue}>
                {emergency.status?.replace(/_/g, ' ').toUpperCase()}
              </ThemedText>
            </View>
          </View>
        </ThemedView>

        {/* Patient Information */}
        {patientInfo && (
          <ThemedView style={styles.card}>
            <ThemedText style={styles.cardTitle}>Patient Information</ThemedText>

            <View style={styles.detailRow}>
              <MaterialIcons name="person" size={20} color="#10B981" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <ThemedText style={styles.detailLabel}>Name</ThemedText>
                <ThemedText style={styles.detailValue}>{patientInfo.full_name}</ThemedText>
              </View>
            </View>

            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={20} color="#10B981" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <ThemedText style={styles.detailLabel}>Contact</ThemedText>
                <ThemedText style={styles.detailValue}>{patientInfo.phone}</ThemedText>
              </View>
            </View>

            <AppButton
              label="View Medical Profile"
              onPress={() =>
                router.push({
                  pathname: '/driver-patient-info' as any,
                  params: { patientId: emergency.patient_id },
                })
              }
              variant="secondary"
              fullWidth
              style={{ marginTop: 12 }}
            />
          </ThemedView>
        )}

        {/* Additional Info */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Important</ThemedText>
          <View style={styles.infoBox}>
            <MaterialIcons name="info" size={20} color="#0EA5E9" />
            <ThemedText style={styles.infoText}>
              By accepting this emergency, you acknowledge that you will provide assistance to the patient
              and will be tracked in real-time.
            </ThemedText>
          </View>
        </ThemedView>
      </ScrollView>

      {/* Action Buttons */}
      <View style={[styles.buttonContainer, { backgroundColor: Colors[colorScheme].background }]}>
        <AppButton
          label="Decline"
          onPress={handleDecline}
          variant="secondary"
          fullWidth
          disabled={processing}
          style={{ marginRight: 12 }}
        />
        <AppButton
          label="Accept"
          onPress={handleAccept}
          variant="primary"
          fullWidth
          disabled={processing}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: 16,
    paddingBottom: 120,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
    fontFamily: 'Monospace',
  },
  severityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  severity: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Monospace',
  },
  emergencyType: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
    fontFamily: 'Monospace',
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    fontFamily: 'Monospace',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 12,
    opacity: 0.6,
    fontFamily: 'Monospace',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Monospace',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: 'rgba(6, 165, 225, 0.1)',
    borderRadius: 12,
  },
  infoText: {
    fontSize: 13,
    marginLeft: 12,
    flex: 1,
    fontFamily: 'Monospace',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
});
