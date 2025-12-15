import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';


export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setRegistered } = useAppState();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      setRegistered(true);
      alert('Logged in (demo)!');
      router.replace('/help');
    } finally {
      setLoading(false);
    }
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
                style={({ pressed }) => [
                  styles.backButton,
                  isDark ? styles.backButtonDark : styles.backButtonLight,
                  pressed ? { opacity: 0.85, transform: [{ scale: 0.95 }] } : null,
                ]}>
                <MaterialIcons name="arrow-back" size={20} color={isDark ? '#ECEDEE' : '#0F172A'} />
                <ThemedText style={[styles.backText, { color: isDark ? '#ECEDEE' : '#0F172A' }]}>Back</ThemedText>
              </Pressable>
            </View>
            <ThemedText style={styles.title}>Welcome back</ThemedText>
            <ThemedText style={styles.subtitle}>Sign in to continue</ThemedText>

            <View style={styles.form}>
              <ThemedText style={styles.label}>Email</ThemedText>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                autoCapitalize="none"
                keyboardType="email-address"
                style={[styles.input, isDark ? styles.inputDark : null]}
              />

              <ThemedText style={styles.label}>Password</ThemedText>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                secureTextEntry
                style={[styles.input, isDark ? styles.inputDark : null]}
              />

              <AppButton
                label={loading ? 'Signing in…' : 'Sign in'}
                onPress={onLogin}
                loading={loading}
                fullWidth
                variant="primary"
                style={styles.primaryBtn}
              />

              <View style={styles.footerRow}>
                <ThemedText style={styles.footerText}>No account?</ThemedText>
                <AppButton label="Create one" onPress={() => router.push('/register')} variant="ghost" />
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
  footerRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 15,
    color: '#64748B',
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
});
