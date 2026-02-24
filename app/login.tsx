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
import { signIn } from '@/utils/auth';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setUser, setRegistered } = useAppState();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
  });

  const handleChange = (key: string, value: string) => {
    setForm({ ...form, [key]: value });
  };

  const handleLogin = async () => {
    // Validate form
    if (!form.email || !form.password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      console.log('Signing in with:', { email: form.email });
      
      const { user, error } = await signIn(form.email, form.password);

      console.log('Sign in result:', { user, error });

      if (error || !user) {
        console.error('Sign in error:', error);
        setLoading(false);
        Alert.alert('Login Failed', error?.message || 'Failed to sign in');
        return;
      }

      console.log('User signed in:', { id: user.id, role: user.role });
      setUser(user);
      setRegistered(true);

      // Route based on user role (admin users also route to patient tabs)
      const route = user.role === 'driver' ? '/driver-home' : '/(tabs)';
      console.log('Navigating to route:', route);

      // Redirect after a brief delay for smooth transition
      setTimeout(() => {
        setLoading(false);
        router.replace(route as any);
      }, 600);
    } catch (error) {
      console.error('Login exception:', error);
      setLoading(false);
      Alert.alert('Error', `Login failed: ${String(error)}`);
    }
  };

  const handleForgotPassword = () => {
    Alert.alert('Password Reset', 'Please use the Supabase dashboard to reset your password or contact support.');
  };

  return (
    <View style={[styles.bg, { backgroundColor: Colors[colorScheme].background }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Signing in..." />
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
            
            <ThemedText style={styles.title}>Welcome Back</ThemedText>
            <ThemedText style={styles.subtitle}>
              Sign in to access emergency services and manage your medical profile.
            </ThemedText>

            <View style={styles.form}>
              <ThemedText style={styles.label}>Email *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Enter your email"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                keyboardType="email-address"
                autoCapitalize="none"
                value={form.email}
                onChangeText={(text) => handleChange('email', text)}
                editable={!loading}
              />

              <ThemedText style={styles.label}>Password *</ThemedText>
              <TextInput
                style={[styles.input, isDark ? styles.inputDark : null]}
                placeholder="Enter your password"
                placeholderTextColor={isDark ? '#6B7280' : '#94A3B8'}
                secureTextEntry
                value={form.password}
                onChangeText={(text) => handleChange('password', text)}
                editable={!loading}
              />

              <Pressable 
                onPress={handleForgotPassword}
                disabled={loading}>
                <ThemedText style={styles.forgotPassword}>Forgot password?</ThemedText>
              </Pressable>

              <View style={styles.buttonContainer}>
                <AppButton 
                  label={loading ? "Signing In..." : "Sign In"} 
                  onPress={handleLogin} 
                  variant="primary" 
                  fullWidth 
                  style={styles.primaryBtn}
                  disabled={loading}
                />
              </View>

              <View style={styles.divider}>
                <View style={[styles.dividerLine, isDark && styles.dividerLineDark]} />
                <ThemedText style={styles.dividerText}>New user?</ThemedText>
                <View style={[styles.dividerLine, isDark && styles.dividerLineDark]} />
              </View>

              <AppButton 
                label="Create Account" 
                onPress={() => !loading && router.push('/register')} 
                variant="secondary" 
                fullWidth
                disabled={loading}
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
    marginBottom: 20,
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
  forgotPassword: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#0EA5E9',
    textAlign: 'right',
    marginTop: 4,
  },
  primaryBtn: {
    marginTop: 6,
  },
  buttonContainer: {
    marginTop: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E6ECF2',
  },
  dividerLineDark: {
    backgroundColor: '#2E3236',
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#64748B',
  },
});
