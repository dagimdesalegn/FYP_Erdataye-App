import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
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
            <View style={styles.cardTopRow}>
              <Pressable
                onPress={() => router.replace('/')}
                style={({ pressed }) => [
                  styles.iconBtn,
                  isDark ? styles.closeBtnDark : styles.closeBtnLight,
                  pressed ? { opacity: 0.9, transform: [{ scale: 0.98 }] } : null,
                ]}>
                <MaterialIcons name="close" size={18} color={isDark ? '#ECEDEE' : '#0F172A'} />
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
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  closeBtnLight: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#EEF2F6',
  },
  closeBtnDark: {
    backgroundColor: 'rgba(11,18,32,0.72)',
    borderColor: '#2E3236',
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
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 14,
  },
  form: {
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E6ECF2',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    fontSize: 15,
    color: '#11181C',
  },
  inputDark: {
    backgroundColor: '#0B1220',
    borderColor: '#2E3236',
    color: '#ECEDEE',
  },
  primaryBtn: {
    marginTop: 8,
  },
  footerRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  footerText: {
    fontSize: 14,
    color: '#64748B',
  },
});
