import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';

import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signIn } from '@/utils/auth';
import { useRouter } from 'expo-router';

const CARD_MAX_W = 440;

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setUser, setRegistered } = useAppState();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '' });
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isSmallScreen = windowWidth < 480;

  const handleChange = (key: string, value: string) => {
    // For phone field – strip non-numeric except leading +
    if (key === 'email') {
      // Allow digits and leading +
      const cleaned = value.replace(/[^0-9+]/g, '');
      setForm({ ...form, [key]: cleaned });
      return;
    }
    setForm({ ...form, [key]: value });
  };

  /** Normalise an Ethiopian phone to the email-like identifier used by auth. */
  const phoneToAuthEmail = (phone: string): string => {
    let digits = phone.replace(/[^0-9]/g, '');
    // 09XXXXXXXX → 2519XXXXXXXX
    if (digits.startsWith('0') && digits.length === 10) {
      digits = '251' + digits.substring(1);
    }
    // 9XXXXXXXX → 2519XXXXXXXX
    if (digits.length === 9 && digits.startsWith('9')) {
      digits = '251' + digits;
    }
    return digits + '@phone.erdataye.app';
  };

  const validatePhone = (phone: string): boolean => {
    const digits = phone.replace(/[^0-9]/g, '');
    // Accept: 09XXXXXXXX (10), 9XXXXXXXX (9), 2519XXXXXXXX (12)
    if (digits.length === 10 && digits.startsWith('0')) return true;
    if (digits.length === 9 && digits.startsWith('9')) return true;
    if (digits.length === 12 && digits.startsWith('251')) return true;
    return false;
  };

  const handleLogin = async () => {
    if (!form.email || !form.password) {
      Alert.alert('Error', 'Please enter both phone number and password');
      return;
    }
    if (!validatePhone(form.email)) {
      Alert.alert('Invalid Phone', 'Enter a valid Ethiopian phone number starting with 09 or +251. Example: 0912345678');
      return;
    }
    setLoading(true);
    try {
      const authEmail = phoneToAuthEmail(form.email);
      const { user, error } = await signIn(authEmail, form.password);
      if (error || !user) {
        setLoading(false);
        Alert.alert('Login Failed', error?.message || 'Failed to sign in');
        return;
      }
      setUser(user);
      setRegistered(true);
      const route = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver-home' : '/help';
      setTimeout(() => {
        setLoading(false);
        router.replace(route as any);
      }, 500);
    } catch (err) {
      setLoading(false);
      Alert.alert('Error', `Login failed: ${String(err)}`);
    }
  };

  const handleForgotPassword = () => {
    Alert.alert('Password Reset', 'Please use the Supabase dashboard to reset your password or contact support.');
  };

  /* ---- colours ---- */
  const bg = isDark ? '#0B0F1A' : '#F0F4FA';
  const cardBg = isDark ? '#151C2C' : '#FFFFFF';
  const cardBorder = isDark ? '#1E293B' : '#E2E8F0';
  const inputBg = isDark ? '#0F172A' : '#F8FAFC';
  const inputBorder = isDark ? '#1E293B' : '#E2E8F0';
  const inputFocusBorder = '#DC2626';
  const textPrimary = isDark ? '#F1F5F9' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const placeholderColor = isDark ? '#475569' : '#94A3B8';

  return (
    <View style={[styles.root, { backgroundColor: bg }, Platform.OS === 'web' && { minHeight: '100vh' as any }]}>
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Signing in..." />

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
            isSmallScreen && { paddingHorizontal: 8, paddingVertical: 12 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* Card */}
          <View style={[
            styles.card,
            { backgroundColor: cardBg, borderColor: cardBorder },
            isSmallScreen && { paddingHorizontal: 16, paddingVertical: 20, borderRadius: 14 },
          ]}>

            {/* Logo / Header area */}
            <View style={styles.headerArea}>
              <View style={styles.logoBadge}>
                <MaterialIcons name="local-hospital" size={28} color="#fff" />
              </View>
              <ThemedText style={[styles.brand, { color: textPrimary }]}>ErdAtaye</ThemedText>
              <ThemedText style={[styles.tagline, { color: textSecondary }]}>
                Emergency Ambulance Service
              </ThemedText>
            </View>

            {/* Title */}
            <ThemedText style={[styles.title, { color: textPrimary }]}>Welcome Back</ThemedText>
            <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
              Sign in to access emergency services.
            </ThemedText>

            {/* Form */}
            <View style={styles.form}>
              {/* Phone Number */}
              <View style={styles.fieldGroup}>
                <ThemedText style={[styles.label, { color: textPrimary }]}>Phone Number</ThemedText>
                <View style={[
                  styles.inputWrap,
                  { backgroundColor: inputBg, borderColor: focusedField === 'email' ? inputFocusBorder : inputBorder },
                ]}>
                  <MaterialIcons name="phone" size={18} color={focusedField === 'email' ? '#DC2626' : textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: textPrimary }]}
                    placeholder="+2519XXXXXXXX"
                    placeholderTextColor={placeholderColor}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    maxLength={13}
                    value={form.email}
                    onChangeText={(t) => handleChange('email', t)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.fieldGroup}>
                <View style={styles.labelRow}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>Password</ThemedText>
                  <Pressable onPress={handleForgotPassword} disabled={loading} hitSlop={8}>
                    <ThemedText style={styles.forgotLink}>Forgot?</ThemedText>
                  </Pressable>
                </View>
                <View style={[
                  styles.inputWrap,
                  { backgroundColor: inputBg, borderColor: focusedField === 'password' ? inputFocusBorder : inputBorder },
                ]}>
                  <MaterialIcons name="lock-outline" size={18} color={focusedField === 'password' ? '#DC2626' : textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: textPrimary }]}
                    placeholder="Enter your password"
                    placeholderTextColor={placeholderColor}
                    secureTextEntry={!showPassword}
                    value={form.password}
                    onChangeText={(t) => handleChange('password', t)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                  <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
                    <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={20} color={textSecondary} />
                  </Pressable>
                </View>
              </View>

              {/* Sign In button */}
              <Pressable
                onPress={handleLogin}
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
                  {loading ? (
                    <ThemedText style={styles.primaryBtnText}>Signing In...</ThemedText>
                  ) : (
                    <>
                      <MaterialIcons name="login" size={20} color="#fff" />
                      <ThemedText style={styles.primaryBtnText}>Sign In</ThemedText>
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </View>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: cardBorder }]} />
              <ThemedText style={[styles.dividerText, { color: textSecondary }]}>or</ThemedText>
              <View style={[styles.dividerLine, { backgroundColor: cardBorder }]} />
            </View>

            {/* Create Account */}
            <Pressable
              onPress={() => !loading && router.push('/register')}
              disabled={loading}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: isDark ? '#1E293B' : '#E2E8F0', backgroundColor: isDark ? '#0F172A' : '#F8FAFC' },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}>
              <MaterialIcons name="person-add" size={20} color="#DC2626" />
              <ThemedText style={[styles.secondaryBtnText, { color: textPrimary }]}>Create Account</ThemedText>
            </Pressable>
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
  /* ---- Card ---- */
  card: {
    width: '100%',
    maxWidth: CARD_MAX_W,
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  /* ---- Header ---- */
  headerArea: { alignItems: 'center', marginBottom: 14 },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  brand: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    marginTop: 1,
  },
  /* ---- Title / Subtitle ---- */
  title: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    lineHeight: 18,
    marginBottom: 14,
  },
  /* ---- Form ---- */
  form: { gap: 12 },
  fieldGroup: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 12,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    height: '100%',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  forgotLink: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    color: '#DC2626',
  },
  /* ---- Primary button ---- */
  primaryBtn: { marginTop: 2, borderRadius: 12, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    gap: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.3,
  },
  /* ---- Divider ---- */
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 10,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '600', fontFamily: Fonts.sans },
  /* ---- Secondary button ---- */
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.2,
  },
});
