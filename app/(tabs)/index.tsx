import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';

import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Dimensions, ImageBackground, Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useAppState } from '@/components/app-state';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width: SCREEN_W } = Dimensions.get('window');

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, user } = useAppState();
  const colorScheme = useColorScheme();
  const isDark = (colorScheme ?? 'light') === 'dark';
  const redirected = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.title = 'ErdAtaye Ambulance';
    }
  }, []);

  // Auto-redirect logged-in users to their role-specific page
  useEffect(() => {
    if (isRegistered && user && !redirected.current) {
      redirected.current = true;
      const route = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver-home' : '/help';
      router.replace(route as any);
    }
  }, [isRegistered, user, router]);

  return (
    <ImageBackground
      source={require('@/assets/images/ambulance-hero.jpg')}
      style={styles.bg}
      resizeMode="cover">
      {/* Dark overlay for readability */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Top brand bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}>
            <MaterialIcons name="local-hospital" size={20} color="#fff" />
          </View>
          <ThemedText style={styles.brandText}>ErdAtaye</ThemedText>
        </View>
      </View>

      {/* Content */}
      <View style={styles.container}>
        <View style={styles.content}>

          {/* Badge */}
          <View style={styles.badge}>
            <MaterialIcons name="verified" size={14} color="#22C55E" />
            <ThemedText style={styles.badgeText}>Ethiopia's Emergency Service</ThemedText>
          </View>

          {/* Hero text */}
          <ThemedText
            style={[
              styles.title,
              { fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded },
            ]}>
            እርዳታዬ
          </ThemedText>
          <ThemedText style={styles.subtitle}>
            Emergency Ambulance{'\n'}at Your Fingertips
          </ThemedText>
          <ThemedText style={styles.description}>
            Request an ambulance in seconds. Track in real-time. Get first-aid guidance while you wait.
          </ThemedText>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <ThemedText style={styles.statNumber}>24/7</ThemedText>
              <ThemedText style={styles.statLabel}>Available</ThemedText>
            </View>
            <View style={[styles.statDivider]} />
            <View style={styles.stat}>
              <ThemedText style={styles.statNumber}>&lt;3min</ThemedText>
              <ThemedText style={styles.statLabel}>Response</ThemedText>
            </View>
            <View style={[styles.statDivider]} />
            <View style={styles.stat}>
              <ThemedText style={styles.statNumber}>GPS</ThemedText>
              <ThemedText style={styles.statLabel}>Tracking</ThemedText>
            </View>
          </View>

          {/* CTA Buttons */}
          <View style={styles.ctaSection}>
            <Pressable
              onPress={() => router.push('/login')}
              style={({ pressed }) => [styles.ctaButton, styles.ctaPrimary, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}>
              <MaterialIcons name="login" size={20} color="#FFF" />
              <ThemedText style={styles.ctaPrimaryText}>Sign In</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/register')}
              style={({ pressed }) => [
                styles.ctaButton,
                styles.ctaSecondary,
                pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
              ]}>
              <MaterialIcons name="person-add" size={20} color="#fff" />
              <ThemedText style={styles.ctaSecondaryText}>Create Account</ThemedText>
            </Pressable>
          </View>

          {/* Footer */}
          <ThemedText style={styles.footerText}>
            Designed for Ethiopian emergency response
          </ThemedText>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },

  /* Top brand bar */
  topBar: {
    paddingTop: Platform.OS === 'web' ? 20 : 54,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
  },

  /* Container */
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'web' ? 40 : 44,
  },
  content: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: 16,
  },

  /* Badge */
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
    fontFamily: Fonts.sans,
  },

  /* Hero text */
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -2,
    lineHeight: 52,
  } as any,
  subtitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    fontFamily: Fonts.sans,
    lineHeight: 30,
  },
  description: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 22,
    fontFamily: Fonts.sans,
    fontWeight: '500',
    maxWidth: 380,
  },

  /* Stats */
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Fonts.sans,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    fontFamily: Fonts.sans,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },

  /* CTA */
  ctaSection: {
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    height: 52,
    borderRadius: 14,
  },
  ctaPrimary: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: -0.1,
  },
  ctaSecondary: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ctaSecondaryText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: -0.1,
    color: '#FFFFFF',
  },

  /* Footer */
  footerText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 4,
  },
});
