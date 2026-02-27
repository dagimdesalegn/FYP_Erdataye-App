import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View
} from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getMedicalProfile, getUserProfile, updateUserProfile, upsertMedicalProfile } from '@/utils/profile';
import { useRouter } from 'expo-router';

interface PatientProfileForm {
  fullName: string;
  phone: string;
  bloodType: string;
  allergies: string;
  medicalConditions: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  medications: string;
  notes: string;
}

/**
 * Parse allergies from DB into a comma-separated display string.
 * Handles: JS array, PostgreSQL text-array literal "{a,b}", plain string, null.
 */
const parseAllergiesToString = (raw: unknown): string => {
  if (!raw) return '';
  if (Array.isArray(raw)) return raw.filter(Boolean).join(', ');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // PostgreSQL array literal: {val1,val2}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
        .join(', ');
    }
    return trimmed;
  }
  return String(raw);
};

/**
 * Convert a comma-separated allergies string into a proper JS array for DB storage.
 */
const parseAllergiesToArray = (text: string): string[] => {
  if (!text || !text.trim()) return [];
  return text
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
};

export default function PatientProfileScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { user, setUser } = useAppState();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const successAnim = useRef(new Animated.Value(0)).current;
  const [form, setForm] = useState<PatientProfileForm>({
    fullName: '',
    phone: '',
    bloodType: '',
    allergies: '',
    medicalConditions: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    medications: '',
    notes: '',
  });

  useEffect(() => {
    loadPatientData();
  }, [user?.id]);

  const loadPatientData = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      // Get profile
      const { profile } = await getUserProfile(user.id);
      if (profile) {
        setForm((prev) => ({
          ...prev,
          fullName: profile.full_name || '',
          phone: profile.phone || '',
        }));
      }

      // Get medical profile
      const { profile: medicalProfile } = await getMedicalProfile(user.id);
      if (medicalProfile) {
        setForm((prev) => ({
          ...prev,
          bloodType: medicalProfile.blood_type || '',
          allergies: parseAllergiesToString(medicalProfile.allergies),
          medicalConditions: medicalProfile.medical_conditions || '',
          emergencyContactName: medicalProfile.emergency_contact_name || '',
          emergencyContactPhone: medicalProfile.emergency_contact_phone || '',
          medications: '',
          notes: '',
        }));
      }
    } catch (error) {
      console.error('Error loading patient data:', error);
      Alert.alert('Error', 'Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key: keyof PatientProfileForm, value: string) => {
    // Phone fields: strip non-numeric except leading +
    if (key === 'phone' || key === 'emergencyContactPhone') {
      const cleaned = value.replace(/[^0-9+]/g, '');
      setForm((prev) => ({ ...prev, [key]: cleaned }));
      return;
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validatePhone = (phone: string): boolean => {
    if (!phone) return false;
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length === 10 && digits.startsWith('0')) return true;
    if (digits.length === 9 && digits.startsWith('9')) return true;
    if (digits.length === 12 && digits.startsWith('251')) return true;
    return false;
  };

  const formatPhoneForDB = (phone: string): string => {
    if (!phone) return '';
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0') && digits.length === 10) digits = '251' + digits.substring(1);
    if (digits.length === 9 && digits.startsWith('9')) digits = '251' + digits;
    return '+' + digits;
  };

  const handleSave = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    if (!form.fullName.trim() || form.fullName.trim().length < 2) {
      Alert.alert('Error', 'Please enter a valid full name (at least 2 characters)');
      return;
    }

    if (!validatePhone(form.phone)) {
      Alert.alert('Invalid Phone', 'Enter a valid Ethiopian phone number starting with 09 or +251.\nExample: 0912345678');
      return;
    }

    if (form.emergencyContactPhone && !validatePhone(form.emergencyContactPhone)) {
      Alert.alert('Invalid Phone', 'Emergency contact phone must be a valid Ethiopian number.\nExample: 0912345678');
      return;
    }

    setSaving(true);
    try {
      // 1. Update profiles table (full_name, phone)
      const { success: profileSuccess, error: profileError } = await updateUserProfile(user.id, {
        full_name: form.fullName.trim(),
        phone: formatPhoneForDB(form.phone),
      });
      if (!profileSuccess) {
        throw profileError || new Error('Failed to update profile');
      }

      // 2. Update medical_profiles table
      const { success, error } = await upsertMedicalProfile(user.id, {
        blood_type: form.bloodType || 'Unknown',
        allergies: parseAllergiesToArray(form.allergies),
        medical_conditions: form.medicalConditions || '',
        emergency_contact_name: form.emergencyContactName.trim(),
        emergency_contact_phone: form.emergencyContactPhone
          ? formatPhoneForDB(form.emergencyContactPhone)
          : '',
      });

      if (!success) {
        throw error || new Error('Failed to save medical profile');
      }

      // 3. Update app state so name reflects everywhere
      setUser({ ...user, fullName: form.fullName.trim(), phone: formatPhoneForDB(form.phone) });

      // 4. Show success banner
      setSuccessVisible(true);
      Animated.sequence([
        Animated.timing(successAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(2200),
        Animated.timing(successAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start(() => setSuccessVisible(false));
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', `Failed to save profile: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingModal visible={true} colorScheme={colorScheme} message="Loading profile..." />;
  }

  return (
    <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={saving} colorScheme={colorScheme} message="Saving profile..." />

      {/* Success Banner */}
      {successVisible && (
        <Animated.View
          style={[
            styles.successBanner,
            {
              opacity: successAnim,
              transform: [{ translateY: successAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
            },
          ]}
        >
          <MaterialIcons name="check-circle" size={22} color="#FFFFFF" />
          <ThemedText style={styles.successText}>Profile updated successfully!</ThemedText>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.card}>
            {/* Close / Back button – top-right of the card */}
            <Pressable
              onPress={() => router.back()}
              style={[
                styles.closeBtn,
                {
                  backgroundColor: isDark ? '#1E2028' : '#FFFFFF',
                  borderColor: isDark ? '#2E3236' : '#E6ECF2',
                },
              ]}
            >
              <MaterialIcons name="close" size={20} color={isDark ? '#E6E9EC' : '#11181C'} />
            </Pressable>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.avatarContainer}>
                <View style={[styles.avatar, isDark ? styles.avatarDark : styles.avatarLight]}>
                  <MaterialIcons name="person" size={40} color={isDark ? '#0EA5E9' : '#0284C7'} />
                </View>
              </View>
              <ThemedText style={styles.headerTitle}>Patient Profile</ThemedText>
              <ThemedText style={styles.headerSubtitle}>
                Keep your medical information up to date
              </ThemedText>
            </View>

            {/* Personal Information Section */}
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                <MaterialIcons name="person" size={16} /> Personal Information
              </ThemedText>

              <ThemedText style={styles.label}>Full Name *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Enter your full name"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                autoCapitalize="words"
                value={form.fullName}
                onChangeText={(text) => handleChange('fullName', text)}
                editable={!saving}
              />

              <ThemedText style={styles.label}>Phone Number *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="+2519XXXXXXXX"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="phone-pad"
                maxLength={13}
                value={form.phone}
                onChangeText={(text) => handleChange('phone', text)}
                editable={!saving}
              />
            </View>

            {/* Medical Information Section */}
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                <MaterialIcons name="health-and-safety" size={16} /> Medical Information
              </ThemedText>

              <ThemedText style={styles.label}>Blood Type</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="e.g. A+, O-, B-"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.bloodType}
                onChangeText={(text) => handleChange('bloodType', text)}
                editable={!saving}
              />

              <ThemedText style={styles.label}>Allergies (comma-separated)</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="e.g. Penicillin, Nuts, Dairy"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.allergies}
                onChangeText={(text) => handleChange('allergies', text)}
                multiline
                numberOfLines={2}
                editable={!saving}
              />

              <ThemedText style={styles.label}>Medical Conditions (comma-separated)</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="e.g. Asthma, Diabetes, Hypertension"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.medicalConditions}
                onChangeText={(text) => handleChange('medicalConditions', text)}
                multiline
                numberOfLines={2}
                editable={!saving}
              />

              <ThemedText style={styles.label}>Current Medications (comma-separated)</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="e.g. Aspirin, Insulin, Lisinopril"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.medications}
                onChangeText={(text) => handleChange('medications', text)}
                multiline
                numberOfLines={2}
                editable={!saving}
              />

              <ThemedText style={styles.label}>Additional Notes</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Any other medical information..."
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.notes}
                onChangeText={(text) => handleChange('notes', text)}
                multiline
                numberOfLines={3}
                editable={!saving}
              />
            </View>

            {/* Emergency Contact Section */}
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>
                <MaterialIcons name="phone" size={16} /> Emergency Contact
              </ThemedText>

              <ThemedText style={styles.label}>Contact Name</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Emergency contact name"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                autoCapitalize="words"
                value={form.emergencyContactName}
                onChangeText={(text) => handleChange('emergencyContactName', text)}
                editable={!saving}
              />

              <ThemedText style={styles.label}>Contact Phone</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="+2519XXXXXXXX"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="phone-pad"
                maxLength={13}
                value={form.emergencyContactPhone}
                onChangeText={(text) => handleChange('emergencyContactPhone', text)}
                editable={!saving}
              />
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <AppButton
                label={saving ? 'Saving...' : 'Save Profile'}
                onPress={handleSave}
                variant="primary"
                fullWidth
                disabled={saving}
              />
              <AppButton
                label="Cancel"
                onPress={() => router.back()}
                variant="secondary"
                fullWidth
                style={styles.cancelButton}
                disabled={saving}
              />
            </View>
          </ThemedView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
  },
  flex: {
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
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLight: {
    backgroundColor: '#F0F9FF',
  },
  avatarDark: {
    backgroundColor: '#0C1F3A',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
  section: {
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    marginBottom: 12,
    color: '#0EA5E9',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
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
  buttonContainer: {
    gap: 10,
    marginTop: 8,
  },
  cancelButton: {
    marginTop: 0,
  },
  closeBtn: {
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  successBanner: {
    position: 'absolute',
    top: 24,
    left: 20,
    right: 60,
    zIndex: 200,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  successText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
});
