import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signUp, UserRole } from '@/utils/auth';
import { upsertDriverAmbulance } from '@/utils/driver';
import { upsertMedicalProfile } from '@/utils/profile';
import { useRouter } from 'expo-router';

const CARD_MAX_W = 440;

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setRegistered, setUser } = useAppState();
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('patient');
  const { width: windowWidth } = useWindowDimensions();
  const isSmallScreen = windowWidth < 480;
  const [form, setForm] = useState({
    phone: '',
    password: '',
    fullName: '',
    bloodType: '',
    contact: '',
    allergies: '',
    plateNumber: '',
    registrationNumber: '',
  });

  /** Normalise an Ethiopian phone to the email-like identifier used by auth. */
  const phoneToAuthEmail = (phone: string): string => {
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0') && digits.length === 10) digits = '251' + digits.substring(1);
    if (digits.length === 9 && digits.startsWith('9')) digits = '251' + digits;
    return digits + '@phone.erdataye.app';
  };

  const validatePhone = (phone: string): boolean => {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length === 10 && digits.startsWith('0')) return true;
    if (digits.length === 9 && digits.startsWith('9')) return true;
    if (digits.length === 12 && digits.startsWith('251')) return true;
    return false;
  };

  const formatPhoneForDB = (phone: string): string => {
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0') && digits.length === 10) digits = '251' + digits.substring(1);
    if (digits.length === 9 && digits.startsWith('9')) digits = '251' + digits;
    return '+' + digits;
  };

  const handleChange = (key: string, value: string) => {
    // Phone fields: digits only
    if (key === 'phone' || key === 'contact') {
      const cleaned = value.replace(/[^0-9]/g, '');
      setForm({ ...form, [key]: cleaned });
      return;
    }
    setForm({ ...form, [key]: value });
  };

  const handleSubmit = async () => {
    console.log('handleSubmit called');
    
    // Validate form — field-specific errors
    if (!form.fullName.trim()) {
      Alert.alert('Full Name Required', 'Please enter your full name.');
      return;
    }
    if (form.fullName.trim().length < 2) {
      Alert.alert('Invalid Name', 'Full name must be at least 2 characters.');
      return;
    }

    if (!form.phone) {
      Alert.alert('Phone Required', 'Please enter your phone number.');
      return;
    }
    if (!validatePhone(form.phone)) {
      Alert.alert('Invalid Phone', 'Enter a valid Ethiopian phone number.\nExample: 0912345678');
      return;
    }

    if (!form.password) {
      Alert.alert('Password Required', 'Please enter a password.');
      return;
    }
    if (form.password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    // Contact is recommended but not required
    if (!form.contact && userRole === 'patient') {
      Alert.alert('Warning', 'Emergency contact number is recommended. Continue anyway?', [
        { text: 'Go Back', onPress: () => {}, style: 'cancel' },
        { text: 'Continue', onPress: () => performSignup() },
      ]);
      return;
    }

    // Validate emergency contact phone format if provided
    if (form.contact && !validatePhone(form.contact)) {
      Alert.alert('Invalid Contact', 'Emergency contact must be a valid Ethiopian phone number.\nExample: 0912345678');
      return;
    }

    // Driver-specific validation
    if (userRole === 'driver') {
      if (!form.plateNumber) {
        Alert.alert('Plate Number Required', 'Please enter the ambulance plate number.');
        return;
      }
      if (!form.registrationNumber) {
        Alert.alert('Registration Required', 'Please enter the ambulance registration number.');
        return;
      }
    }

    performSignup();
  };

  const performSignup = async () => {
    console.log('performSignup called');
    setLoading(true);
    try {
      const authEmail = phoneToAuthEmail(form.phone);
      const dbPhone = formatPhoneForDB(form.phone);
      const emergencyContactPhone = form.contact ? formatPhoneForDB(form.contact) : '';

      console.log('Starting signup with:', { 
        authEmail, 
        fullName: form.fullName,
        role: userRole 
      });
      
      // Sign up user with role
      const { user, error } = await signUp(
        authEmail,
        form.password,
        userRole,
        form.fullName.trim(),
        dbPhone
      );

      console.log('Signup result:', { user, error });

      if (error || !user) {
        console.error('Signup error:', error);
        Alert.alert('Registration Failed', error?.message || 'Failed to create account');
        setLoading(false);
        return;
      }

      console.log('User created:', user.id);

      // For patient role, create medical profile
      if (userRole === 'patient') {
        try {
          const { success: medicalSuccess, error: medicalError } = await upsertMedicalProfile(user.id, {
            blood_type: form.bloodType || 'Unknown',
            allergies: form.allergies ? form.allergies.split(',').map(a => a.trim()).filter(Boolean) : [],
            emergency_contact_name: form.fullName.trim(),
            emergency_contact_phone: emergencyContactPhone,
            medical_conditions: '',
          });

          console.log('Medical profile result:', { medicalSuccess, medicalError });

          if (!medicalSuccess) {
            console.warn('Warning: Medical profile creation failed:', medicalError?.message);
            Alert.alert('Warning', 'Account created but medical profile could not be saved. You can update it later in your profile.');
          } else {
            console.log('Medical profile created successfully');
          }
        } catch (err) {
          console.warn('Exception creating medical profile:', err);
          Alert.alert('Warning', 'Account created but medical profile could not be saved. You can update it later in your profile.');
        }
      }

      // For driver role, create ambulance row
      if (userRole === 'driver' && form.plateNumber) {
        try {
          const { ambulanceId, error: ambError } = await upsertDriverAmbulance(
            user.id,
            form.plateNumber,
            form.registrationNumber
          );

          if (ambError) {
            console.warn('Warning: Ambulance creation failed:', ambError.message);
            Alert.alert('Warning', 'Account created but ambulance could not be linked. Contact admin.');
          } else {
            console.log('Ambulance linked to driver:', ambulanceId);
          }
        } catch (err) {
          console.warn('Exception creating ambulance:', err);
        }
      }

      setUser(user);
      setRegistered(true);
      
      // Redirect based on role after successful registration
      setTimeout(() => {
        console.log('Redirecting based on role:', user.role);
        setLoading(false);

        const route = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver-home' : '/help';
        console.log('Navigating to route:', route);
        router.replace(route as any);
      }, 600);
    } catch (error) {
      console.error('Registration exception:', error);
      Alert.alert('Error', `Registration failed: ${error}`);
      setLoading(false);
    }
  };

  const RoleButton = ({ role, label, icon }: { role: UserRole; label: string; icon: string }) => {
    const isSelected = userRole === role;
    return (
      <Pressable
        onPress={() => !loading && setUserRole(role)}
        style={({ pressed }) => [
          styles.roleButton,
          isSelected 
            ? isDark 
              ? styles.roleButtonSelectedDark 
              : styles.roleButtonSelectedLight
            : isDark 
              ? styles.roleButtonDark 
              : styles.roleButtonLight,
          pressed && { opacity: 0.8 },
        ]}>
        <MaterialIcons 
          name={icon as any} 
          size={24} 
          color={isSelected ? '#0EA5E9' : isDark ? '#9CA3AF' : '#6B7280'} 
        />
        <ThemedText style={[
          styles.roleButtonLabel,
          isSelected && styles.roleButtonLabelSelected
        ]}>
          {label}
        </ThemedText>
      </Pressable>
    );
  };

  /* ---- colours ---- */
  const bg = isDark ? '#0B0F1A' : '#F0F4FA';
  const cardBg = isDark ? '#151C2C' : '#FFFFFF';
  const cardBorder = isDark ? '#1E293B' : '#E2E8F0';
  const inputBg = isDark ? '#0F172A' : '#F8FAFC';
  const inputBorder = isDark ? '#1E293B' : '#E2E8F0';
  const textPrimary = isDark ? '#F1F5F9' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const placeholderColor = isDark ? '#475569' : '#94A3B8';

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Creating your account..." />

      {/* Top accent gradient */}
      <LinearGradient
        colors={['#DC2626', '#EF4444', isDark ? '#0B0F1A' : '#F0F4FA']}
        style={styles.topGradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
      />

      <KeyboardAvoidingView
        style={[styles.flex, Platform.OS === 'web' && { minHeight: '100vh' as any }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            Platform.OS === 'web' && { minHeight: '100vh' as any },
            isSmallScreen && { paddingHorizontal: 8, paddingVertical: 8 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* Card */}
          <View style={[
            styles.card,
            { backgroundColor: cardBg, borderColor: cardBorder },
            isSmallScreen && { paddingHorizontal: 16, paddingVertical: 16 },
          ]}>

            {/* Back button */}
            <Pressable
              onPress={() => !loading && router.replace('/login')}
              style={({ pressed }) => [
                styles.backBtn,
                { borderColor: cardBorder, backgroundColor: inputBg },
                pressed && { opacity: 0.8 },
              ]}>
              <MaterialIcons name="arrow-back" size={16} color={textPrimary} />
              <ThemedText style={[styles.backText, { color: textPrimary }]}>Back</ThemedText>
            </Pressable>

            {/* Header */}
            <ThemedText style={[styles.title, { color: textPrimary }]}>Create Account</ThemedText>
            <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
              Register for emergency ambulance assistance.
            </ThemedText>

            {/* Role Selection */}
            <View style={styles.roleSection}>
              <ThemedText style={[styles.roleLabel, { color: textPrimary }]}>I am a:</ThemedText>
              <View style={styles.roleButtons}>
                <RoleButton role="patient" label="Patient" icon="favorite" />
                <RoleButton role="driver" label="Driver" icon="local-shipping" />
              </View>
            </View>

            {/* Form - two columns for wider screens */}
            <View style={styles.form}>
              <View style={styles.row}>
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>Phone Number *</ThemedText>
                  <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                    <MaterialIcons name="phone" size={16} color={textSecondary} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder="09XXXXXXXX"
                      placeholderTextColor={placeholderColor}
                      keyboardType="phone-pad"
                      autoCapitalize="none"
                      maxLength={10}
                      value={form.phone}
                      onChangeText={(t) => handleChange('phone', t)}
                      editable={!loading}
                    />
                  </View>
                </View>
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>Password *</ThemedText>
                  <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                    <MaterialIcons name="lock-outline" size={16} color={textSecondary} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder="Min 6 chars"
                      placeholderTextColor={placeholderColor}
                      secureTextEntry
                      value={form.password}
                      onChangeText={(t) => handleChange('password', t)}
                      editable={!loading}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>Full Name *</ThemedText>
                  <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                    <MaterialIcons name="person-outline" size={16} color={textSecondary} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder="Enter your full name"
                      placeholderTextColor={placeholderColor}
                      autoCapitalize="words"
                      value={form.fullName}
                      onChangeText={(t) => handleChange('fullName', t)}
                      editable={!loading}
                    />
                  </View>
                </View>
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>Emergency Contact</ThemedText>
                  <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                    <MaterialIcons name="contact-phone" size={16} color={textSecondary} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder="09XXXXXXXX"
                      placeholderTextColor={placeholderColor}
                      keyboardType="phone-pad"
                      maxLength={10}
                      value={form.contact}
                      onChangeText={(t) => handleChange('contact', t)}
                      editable={!loading}
                    />
                  </View>
                </View>
              </View>

              {/* Patient-specific fields */}
              {userRole === 'patient' && (
                <View style={styles.row}>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>Blood Type</ThemedText>
                    <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                      <MaterialIcons name="bloodtype" size={16} color={textSecondary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: textPrimary }]}
                        placeholder="e.g. A+, O-"
                        placeholderTextColor={placeholderColor}
                        value={form.bloodType}
                        onChangeText={(t) => handleChange('bloodType', t)}
                        editable={!loading}
                      />
                    </View>
                  </View>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>Allergies</ThemedText>
                    <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                      <MaterialIcons name="warning-amber" size={16} color={textSecondary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: textPrimary }]}
                        placeholder="Comma-separated"
                        placeholderTextColor={placeholderColor}
                        value={form.allergies}
                        onChangeText={(t) => handleChange('allergies', t)}
                        editable={!loading}
                      />
                    </View>
                  </View>
                </View>
              )}

              {/* Driver-specific fields */}
              {userRole === 'driver' && (
                <View style={styles.row}>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>Plate Number *</ThemedText>
                    <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                      <MaterialIcons name="directions-car" size={16} color={textSecondary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: textPrimary }]}
                        placeholder="e.g. AA-12345"
                        placeholderTextColor={placeholderColor}
                        autoCapitalize="characters"
                        value={form.plateNumber}
                        onChangeText={(t) => handleChange('plateNumber', t)}
                        editable={!loading}
                      />
                    </View>
                  </View>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>Registration No. *</ThemedText>
                    <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                      <MaterialIcons name="assignment" size={16} color={textSecondary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: textPrimary }]}
                        placeholder="Reg. number"
                        placeholderTextColor={placeholderColor}
                        autoCapitalize="characters"
                        value={form.registrationNumber}
                        onChangeText={(t) => handleChange('registrationNumber', t)}
                        editable={!loading}
                      />
                    </View>
                  </View>
                </View>
              )}

              {/* Submit */}
              <Pressable
                onPress={handleSubmit}
                disabled={loading}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                  loading && { opacity: 0.7 },
                ]}>
                <LinearGradient
                  colors={['#DC2626', '#B91C1C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryBtnGradient}>
                  <MaterialIcons name="person-add" size={18} color="#fff" />
                  <ThemedText style={styles.primaryBtnText}>
                    {loading ? 'Creating...' : 'Create Account'}
                  </ThemedText>
                </LinearGradient>
              </Pressable>
            </View>

            {/* Already have account */}
            <View style={styles.footer}>
              <ThemedText style={[styles.footerText, { color: textSecondary }]}>Already have an account?</ThemedText>
              <Pressable onPress={() => !loading && router.replace('/login')} hitSlop={8}>
                <ThemedText style={styles.footerLink}>Sign In</ThemedText>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any, overflow: 'auto' as any } : {}),
  },
  flex: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_W,
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    marginBottom: 10,
  },
  backText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    lineHeight: 16,
    marginBottom: 10,
  },
  roleSection: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECF2',
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  roleButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  roleButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 4,
  },
  roleButtonLight: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E6ECF2',
  },
  roleButtonDark: {
    backgroundColor: '#0B1220',
    borderColor: '#2E3236',
  },
  roleButtonSelectedLight: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0EA5E9',
  },
  roleButtonSelectedDark: {
    backgroundColor: 'rgba(14, 165, 233, 0.1)',
    borderColor: '#0EA5E9',
  },
  roleButtonLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#6B7280',
  },
  roleButtonLabelSelected: {
    color: '#0EA5E9',
    fontWeight: '700',
  },
  form: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldHalf: {
    flex: 1,
    gap: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    height: 38,
    paddingHorizontal: 10,
  },
  inputIcon: { marginRight: 6 },
  input: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    height: '100%',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  primaryBtn: {
    marginTop: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 10,
    gap: 6,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.3,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  footerText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
  footerLink: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    color: '#DC2626',
  },
});
