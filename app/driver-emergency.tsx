import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

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
import { buildMapHtml, formatCoords, parsePostGISPoint } from '@/utils/emergency';
import { useRouter } from 'expo-router';

interface MedicalProfile {
  blood_type?: string;
  allergies?: string;
  medical_conditions?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

interface PatientInfo {
  id: string;
  full_name: string;
  phone: string;
  medical_profiles?: MedicalProfile[];
}

/**
 * Driver Emergency Assignment Screen - Accept/Decline Emergency
 */
export default function DriverEmergencyScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
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
                {formatCoords(Number(emergencyCoords?.latitude ?? 0), Number(emergencyCoords?.longitude ?? 0))}
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
                <Pressable onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}>
                  <ThemedText style={[styles.detailValue, { color: '#0EA5E9', textDecorationLine: 'underline' }]}>{patientInfo.phone}</ThemedText>
                </Pressable>
              </View>
            </View>
          </ThemedView>
        )}

        {/* Patient Medical Profile - Inline */}
        {patientInfo?.medical_profiles && patientInfo.medical_profiles.length > 0 && (() => {
          const med = patientInfo.medical_profiles![0];
          return (
            <ThemedView style={styles.card}>
              <ThemedText style={styles.cardTitle}>Medical Profile</ThemedText>

              {med.blood_type ? (
                <View style={styles.detailRow}>
                  <MaterialIcons name="bloodtype" size={20} color="#DC2626" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <ThemedText style={styles.detailLabel}>Blood Type</ThemedText>
                    <ThemedText style={[styles.detailValue, { fontWeight: '700', color: '#DC2626' }]}>{med.blood_type}</ThemedText>
                  </View>
                </View>
              ) : null}

              {med.allergies ? (
                <View style={styles.detailRow}>
                  <MaterialIcons name="warning" size={20} color="#F59E0B" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <ThemedText style={styles.detailLabel}>Allergies</ThemedText>
                    <ThemedText style={[styles.detailValue, { color: '#F59E0B' }]}>{med.allergies}</ThemedText>
                  </View>
                </View>
              ) : null}

              {med.medical_conditions ? (
                <View style={styles.detailRow}>
                  <MaterialIcons name="local-hospital" size={20} color="#0EA5E9" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <ThemedText style={styles.detailLabel}>Medical Conditions</ThemedText>
                    <ThemedText style={styles.detailValue}>{med.medical_conditions}</ThemedText>
                  </View>
                </View>
              ) : null}

              {med.emergency_contact_name ? (
                <View style={styles.detailRow}>
                  <MaterialIcons name="contacts" size={20} color="#10B981" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <ThemedText style={styles.detailLabel}>Emergency Contact</ThemedText>
                    <ThemedText style={styles.detailValue}>{med.emergency_contact_name}</ThemedText>
                    {med.emergency_contact_phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${med.emergency_contact_phone}`)}>
                        <ThemedText style={[styles.detailValue, { color: '#0EA5E9', textDecorationLine: 'underline', marginTop: 2 }]}>{med.emergency_contact_phone}</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </ThemedView>
          );
        })()}

        {/* Real Location - Live Map + Navigate */}
        {emergencyCoords && (
          <ThemedView style={styles.card}>
            <ThemedText style={styles.cardTitle}>Patient Location</ThemedText>
            <View style={styles.detailRow}>
              <MaterialIcons name="my-location" size={20} color="#DC2626" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <ThemedText style={styles.detailLabel}>Coordinates</ThemedText>
                <ThemedText style={styles.detailValue}>
                  {formatCoords(emergencyCoords.latitude, emergencyCoords.longitude)}
                </ThemedText>
              </View>
            </View>

            {/* Embedded Map */}
            {Platform.OS === 'web' ? (
              <View style={styles.mapContainer}>
                <iframe
                  src={buildMapHtml(emergencyCoords.latitude, emergencyCoords.longitude, 15)}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12 } as any}
                  title="Patient Location Map"
                />
              </View>
            ) : (
              <View style={styles.mapContainer}>
                <ThemedText style={[styles.detailLabel, { textAlign: 'center', marginTop: 60 }]}>Map preview available on web</ThemedText>
              </View>
            )}

            <Pressable
              onPress={() => {
                const url = Platform.select({
                  ios: `maps:0,0?q=${emergencyCoords.latitude},${emergencyCoords.longitude}`,
                  android: `geo:${emergencyCoords.latitude},${emergencyCoords.longitude}?q=${emergencyCoords.latitude},${emergencyCoords.longitude}`,
                  default: `https://www.google.com/maps?q=${emergencyCoords.latitude},${emergencyCoords.longitude}`,
                });
                Linking.openURL(url);
              }}
              style={styles.navigateBtn}
            >
              <MaterialIcons name="navigation" size={20} color="#FFFFFF" />
              <ThemedText style={styles.navigateBtnText}>Navigate to Patient</ThemedText>
            </Pressable>
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
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0EA5E9',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 8,
    gap: 8,
  },
  navigateBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
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
