import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Dimensions,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    View
} from 'react-native';

import { AppHeader } from '@/components/app-header';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getEmergencyDetails } from '@/utils/patient';

export default function PatientEmergencyTrackingScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { emergencyId } = useLocalSearchParams();
  const screenWidth = Dimensions.get('window').width;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [emergency, setEmergency] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [ambulance, setAmbulance] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEmergencyDetails();
  }, [emergencyId]);

  const loadEmergencyDetails = async () => {
    if (!emergencyId || typeof emergencyId !== 'string') {
      setError('Invalid emergency ID');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { emergency: emerg, assignment: assign, ambulance: amb, error: err } =
        await getEmergencyDetails(emergencyId);

      if (err) {
        setError(err.message);
      } else {
        setEmergency(emerg);
        setAssignment(assign);
        setAmbulance(amb);
      }
    } catch (err) {
      setError('Failed to load emergency details');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEmergencyDetails();
    setRefreshing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#F59E0B';
      case 'assigned':
        return '#0EA5E9';
      case 'en_route':
        return '#06B6D4';
      case 'arrived':
        return '#10B981';
      case 'at_hospital':
        return '#8B5CF6';
      case 'completed':
        return '#10B981';
      case 'cancelled':
        return '#EF4444';
      default:
        return '#64748B';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low':
        return '#3B82F6';
      case 'medium':
        return '#F59E0B';
      case 'high':
        return '#EF4444';
      case 'critical':
        return '#DC2626';
      default:
        return '#64748B';
    }
  };

  const getSeverityLabel = (severity: string) => {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  };

  const getStatusLabel = (status: string) => {
    const labels: { [key: string]: string } = {
      pending: 'Pending - Finding Ambulance',
      assigned: 'Assigned - Ambulance Dispatched',
      en_route: 'En Route - Ambulance Coming',
      arrived: 'Arrived - Ambulance Here',
      at_hospital: 'At Hospital - Treatment Started',
      completed: 'Completed',
      cancelled: 'Cancelled',
    };
    return labels[status] || status;
  };

  const StatusTimeline = () => (
    <View style={styles.timeline}>
      {['pending', 'assigned', 'en_route', 'arrived', 'at_hospital', 'completed'].map(
        (step, index) => {
          const isCompleted = emergency?.status === step || 
            ['at_hospital', 'completed'].includes(emergency?.status);
          const isCurrent = emergency?.status === step;
          
          return (
            <View key={step} style={styles.timelineItem}>
              <View
                style={[
                  styles.timelineCircle,
                  isCurrent && styles.timelineCircleCurrent,
                  isCompleted && styles.timelineCircleCompleted,
                ]}>
                {isCompleted && !isCurrent ? (
                  <MaterialIcons name="check" size={16} color="white" />
                ) : (
                  <View
                    style={[
                      styles.timelineInner,
                      isCurrent && styles.timelineInnerCurrent,
                    ]}
                  />
                )}
              </View>
              {index < 5 && (
                <View
                  style={[
                    styles.timelineLine,
                    isCompleted && styles.timelineLineCompleted,
                  ]}
                />
              )}
            </View>
          );
        }
      )}
    </View>
  );

  if (loading) {
    return <LoadingModal visible={true} colorScheme={colorScheme} message="Loading emergency..." />;
  }

  if (error) {
    return (
      <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
        <AppHeader title="Emergency Status" />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#EF4444" />
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        </View>
      </View>
    );
  }

  if (!emergency) {
    return (
      <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
        <AppHeader title="Emergency Status" />
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>Emergency not found</ThemedText>
        </View>
      </View>
    );
  }

  const statusColor = getStatusColor(emergency.status);
  const severityColor = getSeverityColor(emergency.severity);

  return (
    <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
      <AppHeader title="Emergency Status" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}>
        <ThemedView style={styles.card}>
          {/* Current Status */}
          <View style={styles.statusSection}>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20`, borderColor: statusColor }]}>
              <MaterialIcons name="radio-button-checked" size={20} color={statusColor} />
              <ThemedText style={[styles.statusLabel, { color: statusColor }]}>
                {getStatusLabel(emergency.status)}
              </ThemedText>
            </View>

            <ThemedText style={styles.title}>Your Emergency</ThemedText>
            <ThemedText style={styles.timestamp}>
              Called at {new Date(emergency.created_at).toLocaleTimeString()}
            </ThemedText>
          </View>

          {/* Severity Badge */}
          <View style={styles.severityContainer}>
            <View style={[styles.severityBadge, { backgroundColor: `${severityColor}20` }]}>
              <MaterialIcons name="warning" size={18} color={severityColor} />
              <ThemedText style={[styles.severityText, { color: severityColor }]}>
                {getSeverityLabel(emergency.severity)} Severity
              </ThemedText>
            </View>
          </View>

          {/* Timeline */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Progress</ThemedText>
            <StatusTimeline />
          </View>

          {/* Emergency Details */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Details</ThemedText>

            <View style={styles.detailRow}>
              <MaterialIcons name="location-on" size={18} color="#0EA5E9" />
              <View style={styles.detailContent}>
                <ThemedText style={styles.detailLabel}>Location</ThemedText>
                <ThemedText style={styles.detailValue}>
                  {emergency.latitude.toFixed(4)}, {emergency.longitude.toFixed(4)}
                </ThemedText>
              </View>
            </View>

            {emergency.description && (
              <View style={styles.detailRow}>
                <MaterialIcons name="description" size={18} color="#0EA5E9" />
                <View style={styles.detailContent}>
                  <ThemedText style={styles.detailLabel}>Description</ThemedText>
                  <ThemedText style={styles.detailValue}>{emergency.description}</ThemedText>
                </View>
              </View>
            )}

            {emergency.patient_condition && (
              <View style={styles.detailRow}>
                <MaterialIcons name="health-and-safety" size={18} color="#0EA5E9" />
                <View style={styles.detailContent}>
                  <ThemedText style={styles.detailLabel}>Your Condition</ThemedText>
                  <ThemedText style={styles.detailValue}>{emergency.patient_condition}</ThemedText>
                </View>
              </View>
            )}
          </View>

          {/* Ambulance Information */}
          {ambulance && (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                <MaterialIcons name="local-shipping" size={16} /> Ambulance En Route
              </ThemedText>

              <View style={[styles.ambulanceCard, isDark && styles.ambulanceCardDark]}>
                <View style={styles.ambulanceHeader}>
                  <ThemedText style={styles.ambulanceNumber}>
                    {ambulance.vehicle_number}
                  </ThemedText>
                  <View style={styles.statusDot} />
                </View>

                {assignment?.pickup_eta_minutes && (
                  <View style={styles.etaContainer}>
                    <MaterialIcons name="schedule" size={16} color="#0EA5E9" />
                    <ThemedText style={styles.etaText}>
                      Arriving in {assignment.pickup_eta_minutes} minutes
                    </ThemedText>
                  </View>
                )}

                <View style={styles.driverInfo}>
                  <View style={styles.driverIcon}>
                    <MaterialIcons name="person" size={20} color="#0EA5E9" />
                  </View>
                  <ThemedText style={styles.driverText}>Driver En Route</ThemedText>
                </View>
              </View>
            </View>
          )}

          {/* Support */}
          <View style={[styles.section, styles.supportSection]}>
            <ThemedText style={styles.sectionTitle}>
              <MaterialIcons name="phone" size={16} /> Need Help?
            </ThemedText>

            <Pressable style={styles.supportButton}>
              <MaterialIcons name="phone" size={20} color="#0EA5E9" />
              <ThemedText style={styles.supportButtonText}>Call Dispatcher</ThemedText>
              <MaterialIcons name="chevron-right" size={20} color="#0EA5E9" />
            </Pressable>

            <Pressable style={styles.supportButton}>
              <MaterialIcons name="message" size={20} color="#0EA5E9" />
              <ThemedText style={styles.supportButtonText}>Message Support</ThemedText>
              <MaterialIcons name="chevron-right" size={20} color="#0EA5E9" />
            </Pressable>
          </View>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    fontFamily: Fonts.sans,
    color: '#EF4444',
    textAlign: 'center',
  },
  statusSection: {
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  statusBadge: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 8,
    marginBottom: 12,
    alignSelf: 'center',
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: Fonts.sans,
  },
  timestamp: {
    fontSize: 12,
    color: '#64748B',
    fontFamily: Fonts.sans,
    marginTop: 4,
  },
  severityContainer: {
    marginBottom: 20,
  },
  severityBadge: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
    alignItems: 'center',
  },
  severityText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
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
    color: '#0EA5E9',
  },
  timeline: {
    flexDirection: 'row',
    gap: 0,
  },
  timelineItem: {
    flex: 1,
    alignItems: 'center',
  },
  timelineCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  timelineCircleCurrent: {
    borderColor: '#0EA5E9',
    backgroundColor: '#E0F2FE',
  },
  timelineCircleCompleted: {
    borderColor: '#10B981',
    backgroundColor: '#D1FAE5',
  },
  timelineInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CBD5E1',
  },
  timelineInnerCurrent: {
    backgroundColor: '#0EA5E9',
  },
  timelineLine: {
    position: 'absolute',
    width: 2,
    height: 40,
    backgroundColor: '#E2E8F0',
    top: 32,
    left: '50%',
    marginLeft: -1,
  },
  timelineLineCompleted: {
    backgroundColor: '#10B981',
  },
  detailRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    fontFamily: Fonts.sans,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
  ambulanceCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E6ECF2',
    gap: 10,
  },
  ambulanceCardDark: {
    backgroundColor: '#0B1220',
    borderColor: '#2E3236',
  },
  ambulanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ambulanceNumber: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
  },
  etaContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(14, 165, 233, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
  },
  etaText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#0EA5E9',
  },
  driverInfo: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  driverIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
  supportSection: {
    borderBottomWidth: 0,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
    borderRadius: 10,
    marginBottom: 10,
    gap: 12,
  },
  supportButtonText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#0EA5E9',
  },
});
