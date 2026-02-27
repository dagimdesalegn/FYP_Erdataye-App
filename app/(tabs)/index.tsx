import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';

import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, user } = useAppState();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const redirected = useRef(false);

  const pageBg = Colors[theme].background;
  const titleColor = Colors[theme].text;
  const subText = isDark ? '#94A3B8' : '#64748B';
  const cardBorder = isDark ? '#1F2937' : '#E2E8F0';

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
    <View style={[styles.bg, { backgroundColor: pageBg }]}>
      <AppHeader title="ErdAtaye" announcementHref="/modal" />

      <View style={styles.container}>
        <View style={styles.content}>

          {/* Hero */}
          <View style={styles.hero}>
            <View style={[styles.logoBadge, { backgroundColor: isDark ? 'rgba(220,38,38,0.12)' : 'rgba(220,38,38,0.08)' }]}>
              <MaterialIcons name="local-hospital" size={28} color="#DC2626" />
            </View>
            <ThemedText
              style={[
                styles.title,
                { color: titleColor, fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded },
              ]}>
              እርዳታዬ
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: titleColor }]}>
              Ambulance Service for Ethiopia
            </ThemedText>
            <ThemedText style={[styles.description, { color: subText }]}>
              Quick ambulance request, verified access, and first-aid support designed for Ethiopia.
            </ThemedText>
          </View>

          {/* CTA Buttons */}
          <View style={styles.ctaSection}>
            <Pressable
              onPress={() => router.push('/login')}
              style={({ pressed }) => [styles.ctaButton, styles.ctaPrimary, pressed && { opacity: 0.92 }]}>
              <MaterialIcons name="login" size={20} color="#FFF" />
              <ThemedText style={styles.ctaPrimaryText}>Sign In</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/register')}
              style={({ pressed }) => [
                styles.ctaButton,
                styles.ctaSecondary,
                { borderColor: cardBorder, backgroundColor: isDark ? '#1F2937' : '#F8FAFC' },
                pressed && { opacity: 0.92 },
              ]}>
              <MaterialIcons name="person-add" size={20} color="#DC2626" />
              <ThemedText style={[styles.ctaSecondaryText, { color: titleColor }]}>Create Account</ThemedText>
            </Pressable>
          </View>

        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    ...(Platform.OS === 'web' ? { minHeight: '85vh' as any } : {}),
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    gap: 28,
  },

  /* Hero */
  hero: {
    alignItems: 'center',
    gap: 6,
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 38,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -1.5,
  } as any,
  subtitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.2,
    fontFamily: Fonts.sans,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 340,
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },

  /* CTA */
  ctaSection: {
    width: '100%',
    gap: 10,
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
    boxShadow: '0px 8px 20px rgba(220, 38, 38, 0.35)',
    elevation: 8,
  } as any,
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: -0.1,
  },
  ctaSecondary: {
    borderWidth: 1.5,
  },
  ctaSecondaryText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    letterSpacing: -0.1,
  },
});
