import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';

import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ImageBackground, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useAppState } from '@/components/app-state';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, user } = useAppState();
  const colorScheme = useColorScheme();
  const isDark = (colorScheme ?? 'light') === 'dark';
  const redirected = useRef(false);
  const { width: winW } = useWindowDimensions();
  const isWide = winW >= 768;

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

  /* ---- Colours ---- */
  const cardBg = isDark ? '#0F172A' : '#FFFFFF';
  const textPrimary = isDark ? '#F1F5F9' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const featureBg = isDark ? '#1E293B' : '#F8FAFC';
  const featureBorder = isDark ? '#334155' : '#E2E8F0';

  /* ---- Feature cards data ---- */
  const features = [
    { icon: 'access-time' as const, title: '24/7 Service', desc: 'Round-the-clock emergency response' },
    { icon: 'gps-fixed' as const, title: 'GPS Tracking', desc: 'Real-time ambulance tracking' },
    { icon: 'medical-services' as const, title: 'First Aid', desc: 'Guided first-aid while you wait' },
  ];

  const heroContent = (
    <View style={styles.heroOverlay}>
      <LinearGradient
        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.8)']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <View style={styles.heroContent}>
        <View style={styles.heroTopRow}>
          <View style={styles.brandIcon}>
            <MaterialIcons name="local-hospital" size={18} color="#fff" />
          </View>
          <ThemedText style={styles.brandText}>ErdAtaye</ThemedText>
        </View>
        <View style={styles.heroBottom}>
          <ThemedText style={styles.heroTitle}>
            Saving Lives{'\n'}Across Ethiopia
          </ThemedText>
          <ThemedText style={styles.heroSub}>
            Fast, reliable ambulance dispatch powered by real-time GPS technology.
          </ThemedText>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: isDark ? '#020617' : '#F0F4FA' }]}>
      {isWide ? (
        /* ===== DESKTOP: side-by-side ===== */
        <View style={styles.splitRow}>
          {/* Left: Hero image */}
          <ImageBackground
            source={require('@/assets/images/ambulance-hero.jpg')}
            style={styles.splitImage}
            resizeMode="cover">
            {heroContent}
          </ImageBackground>

          {/* Right: Content card */}
          <ScrollView
            style={styles.splitRight}
            contentContainerStyle={styles.splitRightContent}
            showsVerticalScrollIndicator={false}>
            <View style={[styles.card, { backgroundColor: cardBg }]}>
              {/* Header */}
              <View style={styles.cardHeader}>
                <ThemedText
                  style={[
                    styles.amharicTitle,
                    { color: textPrimary, fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded },
                  ]}>
                  እርዳታዬ
                </ThemedText>
                <ThemedText style={[styles.cardSubtitle, { color: textSecondary }]}>
                  Emergency Ambulance Service
                </ThemedText>
              </View>

              {/* Features */}
              <View style={styles.featuresRow}>
                {features.map((f) => (
                  <View key={f.title} style={[styles.featureCard, { backgroundColor: featureBg, borderColor: featureBorder }]}>
                    <MaterialIcons name={f.icon} size={22} color="#DC2626" />
                    <ThemedText style={[styles.featureTitle, { color: textPrimary }]}>{f.title}</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: textSecondary }]}>{f.desc}</ThemedText>
                  </View>
                ))}
              </View>

              {/* CTA */}
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
                    styles.ctaOutline,
                    { borderColor: featureBorder, backgroundColor: featureBg },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                  ]}>
                  <MaterialIcons name="person-add" size={20} color="#DC2626" />
                  <ThemedText style={[styles.ctaOutlineText, { color: textPrimary }]}>Create Account</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={[styles.footerText, { color: textSecondary }]}>
                Designed for Ethiopian emergency response
              </ThemedText>
            </View>
          </ScrollView>
        </View>
      ) : (
        /* ===== MOBILE: stacked ===== */
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}>
          {/* Hero image section */}
          <ImageBackground
            source={require('@/assets/images/ambulance-hero.jpg')}
            style={styles.mobileHero}
            resizeMode="cover">
            {heroContent}
          </ImageBackground>

          {/* Content below */}
          <View style={[styles.mobileContent, { backgroundColor: cardBg }]}>
            {/* Header */}
            <View style={styles.mobileHeader}>
              <ThemedText
                style={[
                  styles.amharicTitle,
                  { color: textPrimary, fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded },
                ]}>
                እርዳታዬ
              </ThemedText>
              <ThemedText style={[styles.cardSubtitle, { color: textSecondary }]}>
                Emergency Ambulance Service
              </ThemedText>
            </View>

            {/* Features */}
            <View style={styles.featuresCol}>
              {features.map((f) => (
                <View key={f.title} style={[styles.featureRow, { backgroundColor: featureBg, borderColor: featureBorder }]}>
                  <View style={styles.featureIconWrap}>
                    <MaterialIcons name={f.icon} size={20} color="#DC2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.featureTitle, { color: textPrimary }]}>{f.title}</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: textSecondary }]}>{f.desc}</ThemedText>
                  </View>
                </View>
              ))}
            </View>

            {/* CTA */}
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
                  styles.ctaOutline,
                  { borderColor: featureBorder, backgroundColor: featureBg },
                  pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                ]}>
                <MaterialIcons name="person-add" size={20} color="#DC2626" />
                <ThemedText style={[styles.ctaOutlineText, { color: textPrimary }]}>Create Account</ThemedText>
              </Pressable>
            </View>

            <ThemedText style={[styles.footerText, { color: textSecondary }]}>
              Designed for Ethiopian emergency response
            </ThemedText>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },

  /* ===== SPLIT (desktop) ===== */
  splitRow: {
    flex: 1,
    flexDirection: 'row',
  },
  splitImage: {
    flex: 1,
    minHeight: '100%' as any,
  },
  splitRight: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },
  splitRightContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },

  /* ===== HERO OVERLAY (shared) ===== */
  heroOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 24,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: Platform.OS === 'web' ? 8 : 40,
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
  heroBottom: {
    gap: 8,
    paddingBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    fontFamily: Fonts.sans,
    letterSpacing: -1,
    lineHeight: 34,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroSub: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  /* ===== MOBILE ===== */
  mobileHero: {
    height: 280,
  },
  mobileContent: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 20,
  },
  mobileHeader: {
    alignItems: 'center',
    gap: 4,
  },

  /* ===== CARD (desktop) ===== */
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    padding: 32,
    gap: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 6,
  },
  cardHeader: {
    alignItems: 'center',
    gap: 4,
  },
  amharicTitle: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1.5,
    textAlign: 'center',
  } as any,
  cardSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },

  /* ===== FEATURES ===== */
  featuresRow: {
    flexDirection: 'row',
    gap: 10,
  },
  featureCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  featureTitle: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  featureDesc: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 15,
  },
  featuresCol: {
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  featureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(220,38,38,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ===== CTA ===== */
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
    height: 50,
    borderRadius: 14,
  },
  ctaPrimary: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  ctaOutline: {
    borderWidth: 1.5,
  },
  ctaOutlineText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },

  /* Footer */
  footerText: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
});
