import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getPatientInfo } from '@/utils/driver';

interface MedicalProfile {
  blood_type?: string;
  allergies?: string;
  medical_conditions?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
}

interface PatientData {
  id: string;
  full_name: string;
  phone: string;
  medical_profiles?: MedicalProfile[];
}

/**
 * Driver Patient Information Screen - View Patient Medical Data
 */
export default function DriverPatientInfoScreen() {
  useColorScheme();
  const { patientId } = useLocalSearchParams();

  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) return;

    const loadPatientInfo = async () => {
      try {
        setLoading(true);
        const { info, error } = await getPatientInfo(patientId as string);

        if (error && error.message) {
          Alert.alert('Error', 'Failed to load patient information');
          return;
        }

        if (info) {
          setPatientData(info);
        }
      } catch (error) {
        console.error('Error loading patient info:', error);
        Alert.alert('Error', 'Failed to load patient information');
      } finally {
        setLoading(false);
      }
    };

    loadPatientInfo();
  }, [patientId]);

  if (loading) {
    return <LoadingModal visible={true} colorScheme={colorScheme} message="Loading patient info..." />;
  }

  if (!patientData) {
    return (
      <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
        <View style={styles.emptyContainer}>
          <MaterialIcons name="person-off" size={48} color="#9CA3AF" />
          <ThemedText style={styles.emptyText}>Patient information unavailable</ThemedText>
        </View>
      </View>
    );
  }

  const medical = patientData.medical_profiles?.[0];

  return (
    <View style={[styles.container, { backgroundColor: Colors[colorScheme].background }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Patient Header */}
        <ThemedView style={styles.headerCard}>
          <View style={styles.avatarContainer}>
            <MaterialIcons name="person" size={40} color="#0EA5E9" />
          </View>
          <View style={{ marginLeft: 12, flex: 1 }}>
            <ThemedText style={styles.patientName}>{patientData.full_name}</ThemedText>
            <ThemedText style={styles.patientPhone}>{patientData.phone}</ThemedText>
          </View>
        </ThemedView>

        {/* Contact Information */}
        <ThemedView style={styles.card}>
          <ThemedText style={styles.cardTitle}>Contact Information</ThemedText>

          <View style={styles.infoRow}>
            <MaterialIcons name="phone" size={20} color="#0EA5E9" />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={styles.infoLabel}>Primary Phone</ThemedText>
              <ThemedText style={styles.infoValue}>{patientData.phone}</ThemedText>
            </View>
          </View>

          {medical?.emergency_contact_phone && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <MaterialIcons name="contacts" size={20} color="#10B981" />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <ThemedText style={styles.infoLabel}>Emergency Contact</ThemedText>
                  <ThemedText style={styles.infoValue}>
                    {medical.emergency_contact_name}
                  </ThemedText>
                  <ThemedText style={styles.infoValue}>{medical.emergency_contact_phone}</ThemedText>
                </View>
              </View>
            </>
          )}
        </ThemedView>

        {/* Medical Information */}
        {medical && (
          <ThemedView style={styles.card}>
            <ThemedText style={styles.cardTitle}>Medical Information</ThemedText>

            {medical.blood_type && (
              <>
                <View style={styles.infoRow}>
                  <MaterialIcons name="bloodtype" size={20} color="#DC2626" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <ThemedText style={styles.infoLabel}>Blood Type</ThemedText>
                    <ThemedText style={[styles.infoValue, { fontWeight: '700' }]}>
                      {medical.blood_type}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.divider} />
              </>
            )}

            {medical.allergies && (
              <>
                <View style={styles.infoRow}>
                  <MaterialIcons name="warning" size={20} color="#F59E0B" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <ThemedText style={styles.infoLabel}>Allergies</ThemedText>
                    <ThemedText style={styles.infoValue}>{medical.allergies}</ThemedText>
                  </View>
                </View>
                <View style={styles.divider} />
              </>
            )}

            {medical.medical_conditions && (
              <View style={styles.infoRow}>
                <MaterialIcons name="local-hospital" size={20} color="#0EA5E9" />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <ThemedText style={styles.infoLabel}>Medical Conditions</ThemedText>
                  <ThemedText style={styles.infoValue}>{medical.medical_conditions}</ThemedText>
                </View>
              </View>
            )}
          </ThemedView>
        )}

        {/* Privacy Notice */}
        <ThemedView style={styles.noticeCard}>
          <MaterialIcons name="privacy-tip" size={20} color="#0EA5E9" />
          <ThemedText style={styles.noticeText}>
            This information is confidential and only accessible during active assignments.
          </ThemedText>
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
    fontFamily: Fonts.sans,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  avatarContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(6, 165, 225, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  patientName: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  patientPhone: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
    fontFamily: Fonts.sans,
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
    fontFamily: Fonts.sans,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 12,
    opacity: 0.6,
    fontFamily: Fonts.sans,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: Fonts.sans,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginVertical: 12,
  },
  noticeCard: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: 'rgba(6, 165, 225, 0.1)',
    borderRadius: 12,
    alignItems: 'center',
  },
  noticeText: {
    fontSize: 12,
    marginLeft: 12,
    flex: 1,
    fontFamily: Fonts.sans,
  },
});
