import { AppHeader } from '@/components/app-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { EmergencyRequest, normalizeEmergency } from '@/utils/emergency';
import { getMedicalProfile, MedicalProfile, UserProfile } from '@/utils/profile';
import { supabase } from '@/utils/supabase';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

interface EmergencyWithPatient extends EmergencyRequest {
  patient_profile?: UserProfile;
  patient_medical?: MedicalProfile;
}

export default function HospitalDashboard() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';

  const [emergencies, setEmergencies] = useState<EmergencyWithPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmergency, setSelectedEmergency] = useState<EmergencyWithPatient | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const cardBg = isDark ? '#0B1220' : '#FFFFFF';
  const cardBorder = isDark ? '#2E3236' : '#EEF2F6';
  const textColor = Colors[theme].text;
  const subText = isDark ? '#B7BDC3' : '#475569';
  const accentColor = Colors[theme].tint;

  // Fetch emergency requests with patient data
  const fetchEmergencies = async () => {
    try {
      const { data: emergencyData, error: emergencyError } = await supabase
        .from('emergency_requests')
        .select('*')
        .in('status', ['pending', 'assigned', 'en_route', 'arrived', 'at_hospital'])
        .order('created_at', { ascending: false });

      if (emergencyError) throw emergencyError;

      if (!emergencyData || emergencyData.length === 0) {
        setEmergencies([]);
        return;
      }

      // Enrich with patient profiles and medical info
      const enriched = await Promise.all(
        emergencyData.map(async (raw) => {
          const emergency = normalizeEmergency(raw);

          // Get patient profile
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', emergency.patient_id)
            .single();

          // Get medical profile
          const { profile: medical } = await getMedicalProfile(emergency.patient_id);

          return {
            ...emergency,
            patient_profile: profile as UserProfile | undefined,
            patient_medical: medical ?? undefined,
          } as EmergencyWithPatient;
        })
      );

      setEmergencies(enriched);
    } catch (error) {
      console.error('Error fetching emergencies:', error);
      Alert.alert('Error', 'Failed to load emergency requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Update emergency status
  const updateStatus = async (emergencyId: string, newStatus: EmergencyRequest['status']) => {
    try {
      const { error } = await supabase
        .from('emergency_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', emergencyId);

      if (error) throw error;
      Alert.alert('Success', `Status updated to ${newStatus}`);
      fetchEmergencies();
      setModalVisible(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const viewPatientDetails = (emergency: EmergencyWithPatient) => {
    setSelectedEmergency(emergency);
    setModalVisible(true);
  };

  useEffect(() => {
    fetchEmergencies();

    // Real-time subscription
    const subscription = supabase
      .channel('hospital_emergency_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_requests' },
        () => fetchEmergencies()
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchEmergencies();
  };

  const getStatusColor = (status: string) => {
    const map: Record<string, string> = {
      pending: '#F59E0B',
      assigned: '#3B82F6',
      en_route: '#8B5CF6',
      arrived: '#10B981',
      at_hospital: '#06B6D4',
      completed: '#6B7280',
      cancelled: '#EF4444',
    };
    return map[status] || '#6B7280';
  };

  const getTypeColor = (type: string) => {
    const map: Record<string, string> = {
      accident: '#DC2626',
      cardiac: '#EF4444',
      medical: '#3B82F6',
      maternity: '#EC4899',
      fire: '#F97316',
      other: '#6B7280',
    };
    return map[type] || '#6B7280';
  };

  const renderEmergencyCard = ({ item }: { item: EmergencyWithPatient }) => (
    <Pressable
      style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
      onPress={() => viewPatientDetails(item)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
          <ThemedText style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status.replace('_', ' ').toUpperCase()}
          </ThemedText>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: getTypeColor(item.emergency_type) + '20' }]}>
          <ThemedText style={[styles.typeText, { color: getTypeColor(item.emergency_type) }]}>
            {(item.emergency_type || 'medical').toUpperCase()}
          </ThemedText>
        </View>
      </View>

      <View style={styles.patientInfo}>
        <MaterialIcons name="person" size={20} color={textColor} />
        <ThemedText style={[styles.patientName, { color: textColor }]}>
          {item.patient_profile?.full_name || 'Unknown Patient'}
        </ThemedText>
      </View>

      {item.patient_profile?.phone ? (
        <View style={styles.infoRow}>
          <MaterialIcons name="phone" size={16} color={subText} />
          <ThemedText style={[styles.infoText, { color: subText }]}>
            {item.patient_profile.phone}
          </ThemedText>
        </View>
      ) : null}

      {(item.latitude !== 0 || item.longitude !== 0) && (
        <View style={styles.infoRow}>
          <MaterialIcons name="location-on" size={16} color={subText} />
          <ThemedText style={[styles.infoText, { color: subText }]}>
            {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
          </ThemedText>
        </View>
      )}

      <View style={styles.infoRow}>
        <MaterialIcons name="access-time" size={16} color={subText} />
        <ThemedText style={[styles.infoText, { color: subText }]}>
          {new Date(item.created_at).toLocaleString()}
        </ThemedText>
      </View>

      {item.description ? (
        <ThemedText style={[styles.description, { color: subText }]}>{item.description}</ThemedText>
      ) : null}
    </Pressable>
  );

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={accentColor} />
          <ThemedText style={{ marginTop: 12, color: subText }}>Loading emergencies…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <AppHeader title="Erdataya" />

      <View style={styles.headerSection}>
        <ThemedText type="title" style={[styles.pageTitle, { color: textColor }]}>
          🏥 Hospital Dashboard
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: subText }]}>
          Active Emergencies: {emergencies.length}
        </ThemedText>
      </View>

      <FlatList
        data={emergencies}
        renderItem={renderEmergencyCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialIcons name="check-circle" size={64} color={subText} />
            <ThemedText style={[styles.emptyText, { color: subText }]}>
              No active emergencies
            </ThemedText>
            <ThemedText style={[styles.emptySubText, { color: subText }]}>
              Pull down to refresh
            </ThemedText>
          </View>
        }
      />

      {/* Patient Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: isDark ? '#111827' : '#FFFFFF' }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <ThemedText type="subtitle" style={[styles.modalTitle, { color: textColor }]}>
                  Patient Medical Information
                </ThemedText>
                <Pressable onPress={() => setModalVisible(false)} style={styles.closeButton}>
                  <MaterialIcons name="close" size={24} color={textColor} />
                </Pressable>
              </View>

              {selectedEmergency && (
                <>
                  {/* Patient Details */}
                  <View style={[styles.section, { borderColor: cardBorder }]}>
                    <View style={styles.sectionHeader}>
                      <MaterialIcons name="person" size={20} color={accentColor} />
                      <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
                        Patient Details
                      </ThemedText>
                    </View>
                    <InfoRow label="Name" value={selectedEmergency.patient_profile?.full_name} color={textColor} subColor={subText} />
                    <InfoRow label="Phone" value={selectedEmergency.patient_profile?.phone} color={textColor} subColor={subText} />
                    <InfoRow label="Role" value={selectedEmergency.patient_profile?.role} color={textColor} subColor={subText} />
                  </View>

                  {/* Medical Information */}
                  {selectedEmergency.patient_medical && (
                    <View style={[styles.section, { borderColor: cardBorder }]}>
                      <View style={styles.sectionHeader}>
                        <MaterialIcons name="medical-services" size={20} color="#DC2626" />
                        <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
                          Medical Information
                        </ThemedText>
                      </View>
                      <InfoRow label="Blood Type" value={selectedEmergency.patient_medical.blood_type} color={textColor} subColor={subText} highlight />
                      <InfoRow label="Allergies" value={selectedEmergency.patient_medical.allergies || 'None'} color={textColor} subColor={subText} />
                      <InfoRow label="Medical Conditions" value={selectedEmergency.patient_medical.medical_conditions || 'None'} color={textColor} subColor={subText} />
                      <InfoRow label="Emergency Contact" value={selectedEmergency.patient_medical.emergency_contact_name} color={textColor} subColor={subText} />
                      <InfoRow label="Emergency Phone" value={selectedEmergency.patient_medical.emergency_contact_phone} color={textColor} subColor={subText} />
                    </View>
                  )}

                  {/* Emergency Details */}
                  <View style={[styles.section, { borderColor: cardBorder }]}>
                    <View style={styles.sectionHeader}>
                      <MaterialIcons name="warning" size={20} color="#F59E0B" />
                      <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
                        Emergency Details
                      </ThemedText>
                    </View>
                    <InfoRow label="Type" value={selectedEmergency.emergency_type} color={textColor} subColor={subText} />
                    <InfoRow label="Description" value={selectedEmergency.description} color={textColor} subColor={subText} />
                    <InfoRow
                      label="Location"
                      value={
                        selectedEmergency.latitude !== 0
                          ? `${selectedEmergency.latitude.toFixed(6)}, ${selectedEmergency.longitude.toFixed(6)}`
                          : 'Unknown'
                      }
                      color={textColor}
                      subColor={subText}
                    />
                    <InfoRow label="Status" value={selectedEmergency.status.replace('_', ' ')} color={textColor} subColor={subText} />
                    <InfoRow label="Created" value={new Date(selectedEmergency.created_at).toLocaleString()} color={textColor} subColor={subText} />
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actionButtons}>
                    {selectedEmergency.status !== 'at_hospital' && (
                      <Pressable
                        style={[styles.actionButton, { backgroundColor: '#06B6D4' }]}
                        onPress={() => updateStatus(selectedEmergency.id, 'at_hospital')}
                      >
                        <MaterialIcons name="local-hospital" size={18} color="#fff" />
                        <ThemedText style={styles.actionButtonText}>Mark at Hospital</ThemedText>
                      </Pressable>
                    )}
                    <Pressable
                      style={[styles.actionButton, { backgroundColor: '#10B981' }]}
                      onPress={() => updateStatus(selectedEmergency.id, 'completed')}
                    >
                      <MaterialIcons name="check-circle" size={18} color="#fff" />
                      <ThemedText style={styles.actionButtonText}>Mark Completed</ThemedText>
                    </Pressable>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

/** Reusable info row component */
function InfoRow({
  label,
  value,
  color,
  subColor,
  highlight,
}: {
  label: string;
  value?: string;
  color: string;
  subColor: string;
  highlight?: boolean;
}) {
  return (
    <View style={infoStyles.row}>
      <ThemedText style={[infoStyles.label, { color: subColor }]}>{label}</ThemedText>
      <ThemedText
        style={[
          infoStyles.value,
          { color },
          highlight && infoStyles.highlight,
        ]}
      >
        {value || 'N/A'}
      </ThemedText>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: { marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 2, fontFamily: Fonts.sans },
  value: { fontSize: 15, fontFamily: Fonts.sans },
  highlight: {
    fontSize: 18,
    fontWeight: '700',
    color: '#DC2626',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  pageTitle: {
    fontSize: 24,
    fontFamily: Fonts.sans,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    fontFamily: Fonts.sans,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  patientInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  patientName: {
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 8,
    fontFamily: Fonts.sans,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    marginLeft: 6,
    fontFamily: Fonts.sans,
  },
  description: {
    marginTop: 8,
    fontSize: 13,
    fontStyle: 'italic',
    fontFamily: Fonts.sans,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    fontFamily: Fonts.sans,
  },
  emptySubText: {
    fontSize: 14,
    marginTop: 4,
    fontFamily: Fonts.sans,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '92%',
    maxHeight: '85%',
    borderRadius: 20,
    padding: 20,
    ...(Platform.OS === 'web'
      ? { maxWidth: 500 }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 24, elevation: 16 }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    flex: 1,
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
  section: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
});
