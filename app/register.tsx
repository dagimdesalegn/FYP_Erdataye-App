import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRouter } from 'expo-router';

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setRegistered } = useAppState();
  const [form, setForm] = useState({
    fullName: '',
    age: '',
    bloodType: '',
    contact: '',
    allergies: '',
  });

  const handleChange = (key: string, value: string) => {
    setForm({ ...form, [key]: value });
  };

  const handleSubmit = () => {
    setRegistered(true);
    alert('Registration submitted!');
    router.replace('/help');
  };

  return (
    <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
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
            <ThemedText style={styles.title}>Register medical profile</ThemedText>
            <ThemedText style={styles.subtitle}>
              This helps responders and the app provide faster, safer assistance.
            </ThemedText>

            <View style={styles.form}>
              <ThemedText style={styles.label}>Full name</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Full Name"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.fullName}
                onChangeText={(text) => handleChange('fullName', text)}
              />

              <ThemedText style={styles.label}>Age</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Age"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="numeric"
                value={form.age}
                onChangeText={(text) => handleChange('age', text)}
              />

              <ThemedText style={styles.label}>Blood type</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Blood Type (e.g. A+, O-)"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.bloodType}
                onChangeText={(text) => handleChange('bloodType', text)}
              />

              <ThemedText style={styles.label}>Contact number</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Contact Number"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="phone-pad"
                value={form.contact}
                onChangeText={(text) => handleChange('contact', text)}
              />

              <ThemedText style={styles.label}>Allergies (optional)</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Allergies (if any)"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                value={form.allergies}
                onChangeText={(text) => handleChange('allergies', text)}
              />

              <AppButton label="Submit" onPress={handleSubmit} variant="primary" fullWidth style={styles.primaryBtn} />
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
    padding: 16,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  card: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EEF2F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    marginBottom: 20,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    lineHeight: 22,
  },
  form: {
    gap: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  input: {
    borderWidth: 0.8,
    borderColor: '#E6ECF2',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    fontSize: 16,
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
    marginTop: 12,
  },
});
