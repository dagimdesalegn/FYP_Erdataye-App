import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';

import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signIn } from '@/utils/auth';
import { useRouter } from 'expo-router';

const CARD_MAX_W = 440;

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const { setUser, setRegistered } = useAppState();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ phone: '', password: '' });
  const { width: windowWidth } = useWindowDimensions();
  const isSmallScreen = windowWidth < 480;

  // Entrance animation
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (key: string, value: string) => {
    // Clear error for this field when user types
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    // For phone field – digits only
    if (key === 'phone') {
      const cleaned = value.replace(/[^0-9]/g, '');
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
    return digits + '@phone.erdataya.app';
  };

  const validatePhone = (phone: string): boolean => {
    const digits = phone.replace(/[^0-9]/g, '');
    // Accept: 09XXXXXXXX (10), 9XXXXXXXX (9),2519XXXXXX XX (12)
    if (digits.length === 10 && digits.startsWith('0')) return true;
    if (digits.length === 9 && digits.startsWith('9')) return true;
    if (digits.length === 12 && digits.startsWith('251')) return true;
    return false;
  };

  const handleLogin = async () => {
    const errors: Record<string, string> = {};
    if (!form.phone) {
      errors.phone = 'Please enter your phone number';
    } else if (!validatePhone(form.phone)) {
      errors.phone = 'Invalid phone number (e.g. 0912345678)';
    }
    if (!form.password) {
      errors.password = 'Please enter your password';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      const authEmail = phoneToAuthEmail(form.phone);
      const { user, error } = await signIn(authEmail, form.password);
      if (error || !user) {
        setLoading(false);
        if (Platform.OS === 'web') {
          window.alert(error?.message || 'Failed to sign in');
        } else {
          Alert.alert('Login Failed', error?.message || 'Failed to sign in');
        }
        return;
      }
      setUser(user);
      setRegistered(true);
      let route: string;
      switch (user.role) {
        case 'driver':
          route = '/driver-home';
          break;
        case 'admin':
          route = '/admin';
          break;
        case 'hospital':
          route = '/hospital';
          break;
        default:
          route = '/help';
          break;
      }
      setTimeout(() => {
        setLoading(false);
        router.replace(route as any);
      }, 500);
    } catch (err) {
      setLoading(false);
      if (Platform.OS === 'web') {
        window.alert(`Login failed: ${String(err)}`);
      } else {
        Alert.alert('Error', `Login failed: ${String(err)}`);
      }
    }
  };

  /* ---- colours ---- */
  const bg = colors.background;
  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const inputBg = colors.surfaceMuted;
  const inputBorder = colors.border;
  const inputFocusBorder = colors.primary;
  const textPrimary = colors.text;
  const textSecondary = colors.textMuted;
  const placeholderColor = isDark ? '#64748B' : '#94A3B8';

  return (
    <View style={[styles.root, { backgroundColor: bg }, Platform.OS === 'web' && { minHeight: '100vh' as any }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />
      <LoadingModal visible={loading} colorScheme={colorScheme} message="Signing in..." />

      {/* Top accent gradient */}
      <LinearGradient
        colors={[colors.primary, '#EF4444', bg]}
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
          <Animated.View style={[
            styles.card,
            { backgroundColor: cardBg, borderColor: cardBorder, opacity: fadeIn, transform: [{ translateY: slideUp }] },
            isSmallScreen && { paddingHorizontal: 20, paddingVertical: 24, borderRadius: 18 },
          ]}>

            {/* Logo / Header area */}
            <View style={styles.headerArea}>
              <View style={styles.logoContainer}>
                <Image
                  source={require('@/assets/images/ambulance-favicon.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
            </View>

            {/* Title */}
            <ThemedText style={[styles.title, { color: textPrimary }]}>Welcome Back</ThemedText>
            <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
              Sign in to access emergency services
            </ThemedText>

            {/* Form */}
            <View style={styles.form}>
              {/* Phone Number */}
              <View style={styles.fieldGroup}>
                <ThemedText style={[styles.label, { color: textPrimary }]}>Phone Number</ThemedText>
                <View style={[
                  styles.inputWrap,
                  { backgroundColor: inputBg, borderColor: fieldErrors.phone ? '#DC2626' : (focusedField === 'phone' ? inputFocusBorder : inputBorder) },
                ]}>
                  <MaterialIcons name="phone" size={18} color={fieldErrors.phone ? '#DC2626' : (focusedField === 'phone' ? '#DC2626' : textSecondary)} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: textPrimary }]}
                    placeholder="09XXXXXXXX"
                    placeholderTextColor={placeholderColor}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    maxLength={10}
                    value={form.phone}
                    onChangeText={(t) => handleChange('phone', t)}
                    onFocus={() => setFocusedField('phone')}
                    onBlur={() => setFocusedField(null)}
                    editable={!loading}
                  />
                </View>
                {fieldErrors.phone ? <ThemedText style={styles.fieldError}>{fieldErrors.phone}</ThemedText> : null}
              </View>

              {/* Password */}
              <View style={styles.fieldGroup}>
                <ThemedText style={[styles.label, { color: textPrimary }]}>Password</ThemedText>
                <View style={[
                  styles.inputWrap,
                  { backgroundColor: inputBg, borderColor: fieldErrors.password ? '#DC2626' : (focusedField === 'password' ? inputFocusBorder : inputBorder) },
                ]}>
                  <MaterialIcons name="lock-outline" size={18} color={fieldErrors.password ? '#DC2626' : (focusedField === 'password' ? '#DC2626' : textSecondary)} style={styles.inputIcon} />
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
                {fieldErrors.password ? <ThemedText style={styles.fieldError}>{fieldErrors.password}</ThemedText> : null}
              </View>

              <Pressable
                onPress={handleLogin}
                disabled={loading}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.98 }] },
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
          </Animated.View>
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
    height: 300,
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
    paddingHorizontal: 28,
    paddingVertical: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 12,
  },
  /* ---- Header ---- */
  headerArea: { alignItems: 'center', marginBottom: 24 },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.12)',
  },
  logoImage: {
    width: 60,
    height: 60,
  },
  /* ---- Title / Subtitle ---- */
  title: {
    fontSize: 24,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  /* ---- Form ---- */
  form: { gap: 16 },
  fieldGroup: { gap: 6 },
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
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 14,
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
  fieldError: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: '600',
    color: '#DC2626',
    marginTop: 2,
    marginLeft: 2,
  },
  /* ---- Primary button ---- */
  primaryBtn: { marginTop: 4, borderRadius: 14, overflow: 'hidden' },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    gap: 8,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
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
    marginVertical: 14,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '600', fontFamily: Fonts.sans },
  /* ---- Secondary button ---- */
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
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
