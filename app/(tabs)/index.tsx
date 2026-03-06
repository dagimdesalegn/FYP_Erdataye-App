import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Image,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    View,
} from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
  useAppState();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'dark'];

  // Animations
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = 'Erdataya Ambulance';
    }
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 800, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}> 
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <LinearGradient
        colors={[colors.background, colors.surfaceAlt, colors.background]}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Decorative circles */}
      <View style={styles.decorCircle1} />
      <View style={styles.decorCircle2} />
      <View style={styles.decorCircle3} />

      {/* Hero content - centered */}
      <View style={styles.center}>
        <Animated.View style={[styles.heroSection, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
          {/* Animated SOS ring */}
          <View style={styles.logoWrapper}>
            <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }], borderColor: colors.primary + '40' }]} />
            <Animated.View style={[styles.logoBg, { transform: [{ scale: logoScale }], backgroundColor: 'transparent' }]}> 
              <Image
                source={require('@/assets/images/ambulance-favicon.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </Animated.View>
          </View>

          <ThemedText style={styles.titleAmharic}>እርዳታዬ</ThemedText>

          <ThemedText style={styles.subtitle}>Emergency Ambulance Service</ThemedText>

          <ThemedText style={styles.desc}>
            Saving lives across Ethiopia with fast, reliable ambulance dispatch powered by real-time GPS.
          </ThemedText>
        </Animated.View>
      </View>

      {/* Bottom section - buttons pinned at bottom */}
      <Animated.View style={[styles.bottomSection, { opacity: fadeIn }]}>
        <Pressable
          onPress={() => router.push('/login')}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}>
          <LinearGradient
            colors={[colors.primary, '#B91C1C']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.btnGradient}>
            <MaterialIcons name="login" size={20} color="#FFF" />
            <ThemedText style={styles.btnPrimaryText}>Sign In</ThemedText>
          </LinearGradient>
        </Pressable>

        <Pressable
          onPress={() => router.push('/register')}
          style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && styles.btnPressed]}>
          <MaterialIcons name="person-add" size={20} color={colors.text} />
          <ThemedText style={[styles.btnOutlineText, { color: colors.text }]}>Create Account</ThemedText>
        </Pressable>

        <ThemedText style={styles.footerNote}>
          Designed for Ethiopian emergency response
        </ThemedText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F172A',
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },
  decorCircle1: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
  },
  decorCircle2: {
    position: 'absolute',
    bottom: 80,
    left: -100,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(220, 38, 38, 0.05)',
  },
  decorCircle3: {
    position: 'absolute',
    top: '40%' as any,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 28,
    zIndex: 1,
  },
  heroSection: {
    alignItems: 'center',
  },
  logoWrapper: {
    marginBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  logoBg: {
    width: 96,
    height: 96,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  logoImage: {
    width: 64,
    height: 64,
  },
  titleAmharic: {
    fontSize: 40,
    fontWeight: '900',
    color: '#F1F5F9',
    letterSpacing: 0,
    textAlign: 'center',
    fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded,
    textShadowColor: 'rgba(220, 38, 38, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
    marginBottom: 14,
    paddingHorizontal: 20,
    paddingVertical: 6,
    lineHeight: 56,
    includeFontPadding: true,
  } as any,
  subtitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#CBD5E1',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 14,
  },
  desc: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748B',
    fontFamily: Fonts.sans,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  bottomSection: {
    width: '100%',
    paddingHorizontal: 28,
    paddingBottom: Platform.OS === 'android' ? 32 : 40,
    gap: 12,
    zIndex: 1,
  },
  btn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  btnPrimary: {
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  btnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 54,
    borderRadius: 16,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.3,
  },
  btnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  btnOutlineText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: 0.3,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  footerNote: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.3,
  },
});
