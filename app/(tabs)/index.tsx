import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppState } from '@/components/app-state';
import { Fonts } from '@/constants/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, user } = useAppState();
  const redirected = useRef(false);
  const { width: winW } = useWindowDimensions();
  const isWide = winW >= 768;

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.title = 'ErdAtaye Ambulance';
    }
  }, []);

  useEffect(() => {
    if (isRegistered && user && !redirected.current) {
      redirected.current = true;
      const route = user.role === 'admin' ? '/admin' : user.role === 'driver' ? '/driver-home' : '/help';
      router.replace(route as any);
    }
  }, [isRegistered, user, router]);

  const features = [
    { icon: 'access-time' as const, title: '24/7 Service', desc: 'Round-the-clock emergency response' },
    { icon: 'gps-fixed' as const, title: 'GPS Tracking', desc: 'Real-time ambulance tracking' },
    { icon: 'medical-services' as const, title: 'First Aid', desc: 'Guided first-aid while you wait' },
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.rootContent}
      showsVerticalScrollIndicator={false}>
      {isWide ? (
        /* ===== DESKTOP: side-by-side ===== */
        <View style={styles.desktopRow}>
          {/* Left: Hero image */}
          <View style={styles.desktopImageWrap}>
            <Image
              source={require('@/assets/images/ambulance-hero.jpg')}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.12)']}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            />
          </View>

          {/* Right: Content */}
          <View style={styles.desktopContent}>
            <View style={styles.desktopInner}>
              {/* Logo */}
              <View style={styles.logoRow}>
                <View style={styles.logoIcon}>
                  <MaterialIcons name="local-hospital" size={18} color="#fff" />
                </View>
                <ThemedText style={styles.logoText}>ErdAtaye</ThemedText>
              </View>

              {/* Title */}
              <ThemedText
                style={[styles.titleAmharic, { fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded }]}>
                እርዳታዬ
              </ThemedText>
              <ThemedText style={styles.subtitle}>Emergency Ambulance Service</ThemedText>
              <ThemedText style={styles.desc}>
                Saving lives across Ethiopia with fast, reliable{'\n'}ambulance dispatch powered by real-time GPS.
              </ThemedText>

              {/* Features */}
              <View style={styles.featuresGridDesktop}>
                {features.map((f) => (
                  <View key={f.title} style={styles.featureCardDesktop}>
                    <View style={styles.featureIconCircle}>
                      <MaterialIcons name={f.icon} size={20} color="#DC2626" />
                    </View>
                    <ThemedText style={styles.featureCardTitle}>{f.title}</ThemedText>
                    <ThemedText style={styles.featureCardDesc}>{f.desc}</ThemedText>
                  </View>
                ))}
              </View>

              {/* CTA */}
              <View style={styles.ctaGroup}>
                <Pressable
                  onPress={() => router.push('/login')}
                  style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}>
                  <MaterialIcons name="login" size={20} color="#FFF" />
                  <ThemedText style={styles.btnPrimaryText}>Sign In</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => router.push('/register')}
                  style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && styles.btnPressed]}>
                  <MaterialIcons name="person-add" size={20} color="#DC2626" />
                  <ThemedText style={styles.btnOutlineText}>Create Account</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={styles.footerNote}>Designed for Ethiopian emergency response</ThemedText>
            </View>
          </View>
        </View>
      ) : (
        /* ===== MOBILE: stacked ===== */
        <>
          {/* Hero image with gradient fade to white */}
          <View style={styles.mobileImageWrap}>
            <Image
              source={require('@/assets/images/ambulance-hero.jpg')}
              style={styles.mobileImage}
              resizeMode="cover"
            />
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.7)', '#FFFFFF']}
              style={styles.mobileGradient}
              start={{ x: 0.5, y: 0.15 }}
              end={{ x: 0.5, y: 1 }}
            />
            <View style={styles.mobileBrandOverlay}>
              <View style={styles.logoIconSmall}>
                <MaterialIcons name="local-hospital" size={14} color="#fff" />
              </View>
              <ThemedText style={styles.mobileBrandText}>ErdAtaye</ThemedText>
            </View>
          </View>

          {/* Content */}
          <View style={styles.mobileContent}>
            <ThemedText
              style={[styles.titleAmharicMobile, { fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded }]}>
              እርዳታዬ
            </ThemedText>
            <ThemedText style={styles.subtitleMobile}>Emergency Ambulance Service</ThemedText>
            <ThemedText style={styles.descMobile}>
              Fast, reliable ambulance dispatch powered by real-time GPS technology.
            </ThemedText>

            {/* Features */}
            <View style={styles.featuresList}>
              {features.map((f) => (
                <View key={f.title} style={styles.featureRowMobile}>
                  <View style={styles.featureIconCircleMobile}>
                    <MaterialIcons name={f.icon} size={18} color="#DC2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.featureRowTitle}>{f.title}</ThemedText>
                    <ThemedText style={styles.featureRowDesc}>{f.desc}</ThemedText>
                  </View>
                </View>
              ))}
            </View>

            {/* CTA */}
            <View style={styles.ctaGroup}>
              <Pressable
                onPress={() => router.push('/login')}
                style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}>
                <MaterialIcons name="login" size={20} color="#FFF" />
                <ThemedText style={styles.btnPrimaryText}>Sign In</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push('/register')}
                style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && styles.btnPressed]}>
                <MaterialIcons name="person-add" size={20} color="#DC2626" />
                <ThemedText style={styles.btnOutlineText}>Create Account</ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.footerNoteMobile}>Designed for Ethiopian emergency response</ThemedText>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },
  rootContent: {
    flexGrow: 1,
  },

  /* ===== DESKTOP ===== */
  desktopRow: {
    flex: 1,
    flexDirection: 'row',
    minHeight: Platform.OS === 'web' ? ('100vh' as any) : undefined,
  },
  desktopImageWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  desktopContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#FFFFFF',
  },
  desktopInner: {
    width: '100%',
    maxWidth: 420,
    gap: 14,
  },

  /* Logo */
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  logoIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E293B',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
  },

  /* Titles */
  titleAmharic: {
    fontSize: 46,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -1.5,
  } as any,
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
    fontFamily: Fonts.sans,
    marginTop: -6,
  },
  desc: {
    fontSize: 15,
    fontWeight: '400',
    color: '#64748B',
    fontFamily: Fonts.sans,
    lineHeight: 22,
  },

  /* Features desktop */
  featuresGridDesktop: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  featureCardDesktop: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  featureIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  featureCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  featureCardDesc: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 15,
  },

  /* CTA */
  ctaGroup: {
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 50,
    borderRadius: 14,
  },
  btnPrimary: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  btnOutlineText: {
    color: '#DC2626',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  btnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

  /* Footer */
  footerNote: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 4,
  },

  /* ===== MOBILE ===== */
  mobileImageWrap: {
    height: 260,
    position: 'relative',
  },
  mobileImage: {
    width: '100%',
    height: '100%',
  },
  mobileGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
  },
  mobileBrandOverlay: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 48,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoIconSmall: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileBrandText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Fonts.sans,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  mobileContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
    marginTop: -16,
    backgroundColor: '#FFFFFF',
  },
  titleAmharicMobile: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -1,
    textAlign: 'center',
  } as any,
  subtitleMobile: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: -4,
  },
  descMobile: {
    fontSize: 14,
    fontWeight: '400',
    color: '#64748B',
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
  },
  featuresList: {
    gap: 10,
    marginTop: 4,
  },
  featureRowMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  featureIconCircleMobile: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureRowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    fontFamily: Fonts.sans,
  },
  featureRowDesc: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    fontFamily: Fonts.sans,
  },
  footerNoteMobile: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 4,
  },
});
