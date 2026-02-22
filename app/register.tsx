import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getCurrentUserWithRole, signUp, UserRole } from '@/utils/auth';
import { upsertMedicalProfile } from '@/utils/profile';
import { useRouter } from 'expo-router';

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setRegistered, setUser } = useAppState();
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('patient');
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    bloodType: '',
    contact: '',
    allergies: '',
  });

  const handleChange = (key: string, value: string) => {
    setForm({ ...form, [key]: value });
  };

  const handleSubmit = async () => {
    console.log('handleSubmit called');
    
    // Validate form
    if (!form.email || !form.password || !form.fullName) {
      console.log('Validation failed:', { email: !!form.email, password: !!form.password, fullName: !!form.fullName });
      Alert.alert('Error', 'Please fill in all required fields (email, password, name)');
      return;
    }

    if (form.password.length < 6) {
      console.log('Password too short');
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    // Contact is recommended but not required
    if (!form.contact) {
      Alert.alert('Warning', 'Contact number is recommended for emergency purposes. Continue anyway?', [
        { text: 'Go Back', onPress: () => {}, style: 'cancel' },
        { text: 'Continue', onPress: () => performSignup() },
      ]);
      return;
    }

    performSignup();
  };

  const performSignup = async () => {
    console.log('performSignup called');
    setLoading(true);
    try {
      console.log('Starting signup with:', { 
        email: form.email, 
        fullName: form.fullName,
        role: userRole 
      });
      
      // Sign up user with role
      const { user, error } = await signUp(
        form.email,
        form.password,
        userRole,
        form.fullName,
        form.contact
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
            allergies: form.allergies ? form.allergies.split(',').map(a => a.trim()) : [],
            emergency_contact_name: form.fullName,
            emergency_contact_phone: form.contact,
            medical_conditions: [],
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

      setUser(user);
      setRegistered(true);
      
      // Redirect based on role after successful registration
      setTimeout(async () => {
        console.log('Redirecting based on role:', user.role);
        
        // Fetch full user info including verified role from database
        const fullUser = await getCurrentUserWithRole();
        if (fullUser) {
          console.log('Full user info from database:', { id: fullUser.id, role: fullUser.role });
          setUser(fullUser);
        }
        
        setLoading(false);
        
        // Route based on user role
        const route = (fullUser?.role || user.role) === 'driver' ? '/driver-home' : '/(tabs)';
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

  return (
    <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Creating your account..." />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <ThemedView style={styles.card}>
            <View style={styles.navBar}>
              <Pressable
                onPress={() => !loading && router.replace('/')}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.backButton,
                  isDark ? styles.backButtonDark : styles.backButtonLight,
                  pressed ? { opacity: 0.85, transform: [{ scale: 0.95 }] } : null,
                ]}>
                <MaterialIcons name="arrow-back" size={20} color={isDark ? '#ECEDEE' : '#0F172A'} />
                <ThemedText style={[styles.backText, { color: isDark ? '#ECEDEE' : '#0F172A' }]}>Back</ThemedText>
              </Pressable>
            </View>
            
            <ThemedText style={styles.title}>Create Account</ThemedText>
            <ThemedText style={styles.subtitle}>
              Register to get emergency ambulance assistance quickly and safely.
            </ThemedText>

            {/* Role Selection */}
            <View style={styles.roleSection}>
              <ThemedText style={styles.roleLabel}>I am a:</ThemedText>
              <View style={styles.roleButtons}>
                <RoleButton role="patient" label="Patient" icon="favorite" />
                <RoleButton role="driver" label="Driver" icon="local-shipping" />
              </View>
            </View>

            <View style={styles.form}>
              <ThemedText style={styles.label}>Email *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Email Address"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="email-address"
                value={form.email}
                onChangeText={(text) => handleChange('email', text)}
                editable={!loading}
              />

              <ThemedText style={styles.label}>Password *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Password (min 6 characters)"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                secureTextEntry
                value={form.password}
                onChangeText={(text) => handleChange('password', text)}
                editable={!loading}
              />

              <ThemedText style={styles.label}>Full name *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Full Name"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.fullName}
                onChangeText={(text) => handleChange('fullName', text)}
                editable={!loading}
              />

              <ThemedText style={styles.label}>Contact number *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Contact Number"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="phone-pad"
                value={form.contact}
                onChangeText={(text) => handleChange('contact', text)}
                editable={!loading}
              />

              {/* Patient-specific fields */}
              {userRole === 'patient' && (
                <>
                  <ThemedText style={styles.label}>Blood type</ThemedText>
                  <TextInput
                    style={[styles.input, isDark ? styles.inputDark : null]}
                    placeholder="Blood Type (e.g. A+, O-)"
                    placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                    value={form.bloodType}
                    onChangeText={(text) => handleChange('bloodType', text)}
                    editable={!loading}
                  />

                  <ThemedText style={styles.label}>Allergies (optional)</ThemedText>
                  <TextInput
                    style={[styles.input, isDark ? styles.inputDark : null]}
                    placeholder="Allergies (comma-separated)"
                    placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                    value={form.allergies}
                    onChangeText={(text) => handleChange('allergies', text)}
                    editable={!loading}
                  />
                </>
              )}

              <View style={styles.buttonContainer}>
                <AppButton 
                  label={loading ? "Creating Account..." : "Create Account"} 
                  onPress={handleSubmit} 
                  variant="primary" 
                  fullWidth 
                  style={styles.primaryBtn}
                  disabled={loading}
                />
              </View>
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
  navBar: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
    gap: 8,
  },
  backButtonLight: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderColor: '#E6ECF2',
  },
  backButtonDark: {
    backgroundColor: 'rgba(11,18,32,0.85)',
    borderColor: '#2E3236',
  },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
    fontFamily: Fonts.sans,
  },
  scroll: {
    flexGrow: 1,
    padding: 14,
    justifyContent: 'center',
    paddingBottom: 28,
  },
  card: {
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EEF2F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 16,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    lineHeight: 20,
  },
  roleSection: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECF2',
  },
  roleLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
    marginBottom: 10,
  },
  roleButtons: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  roleButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
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
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#6B7280',
  },
  roleButtonLabelSelected: {
    color: '#0EA5E9',
    fontWeight: '700',
  },
  form: {
    gap: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
    marginBottom: 4,
  },
  input: {
    borderWidth: 0.8,
    borderColor: '#E6ECF2',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    fontSize: 15,
    color: '#11181C',
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
  inputDark: {
    backgroundColor: '#0B1220',
    borderColor: '#2E3236',
    color: '#ECEDEE',
  },
  primaryBtn: {
    marginTop: 10,
  },
  buttonContainer: {
    marginTop: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
