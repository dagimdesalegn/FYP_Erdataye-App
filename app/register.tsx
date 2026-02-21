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
import { signUp } from '@/utils/auth';
import { upsertMedicalProfile } from '@/utils/profile';
import { useRouter } from 'expo-router';

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setRegistered, setUser } = useAppState();
  const [loading, setLoading] = useState(false);
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
    // Validate form
    if (!form.email || !form.password || !form.fullName || !form.contact) {
      Alert.alert('Error', 'Please fill in all required fields (email, password, name, contact)');
      return;
    }

    if (form.password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      // Sign up user
      const { user, error } = await signUp(form.email, form.password, {
        full_name: form.fullName,
        phone: form.contact,
        role: 'patient',
      });

      if (error || !user) {
        Alert.alert('Registration Failed', error?.message || 'Failed to create account');
        setLoading(false);
        return;
      }

      // Create medical profile
      const { success: medicalSuccess, error: medicalError } = await upsertMedicalProfile(user.id, {
        blood_type: form.bloodType || 'Unknown',
        allergies: form.allergies ? form.allergies.split(',').map(a => a.trim()) : [],
        emergency_contact_name: form.fullName,
        emergency_contact_phone: form.contact,
        medical_conditions: [],
      });

      if (!medicalSuccess && medicalError) {
        console.warn('Medical profile creation warning:', medicalError.message);
      }

      // Medical profile is optional - continue regardless
      setUser(user);
      setRegistered(true);
      
      // Smooth redirect after 2.5 seconds (let loading animation play)
      setTimeout(() => {
        setLoading(false);
        router.replace('/(tabs)');
      }, 2500);
    } catch (error) {
      console.error('Registration exception:', error);
      Alert.alert('Error', `Registration failed: ${error}`);
      setLoading(false);
    }
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
                onPress={() => router.replace('/')}
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

              <ThemedText style={styles.label}>Blood type</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Blood Type (e.g. A+, O-)"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.bloodType}
                onChangeText={(text) => handleChange('bloodType', text)}
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

              <ThemedText style={styles.label}>Allergies (optional)</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Allergies (comma-separated)"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.allergies}
                onChangeText={(text) => handleChange('allergies', text)}
                editable={!loading}
              />

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
