import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useAppState } from '@/components/app-state';
import { Fonts } from '@/constants/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, user } = useAppState();
  const redirected = useRef(false);

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
    <View style={styles.root}>
      <View style={styles.center}>
        {/* Logo */}
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <MaterialIcons name="local-hospital" size={22} color="#fff" />
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
        <View style={styles.featuresRow}>
          {features.map((f) => (
            <View key={f.title} style={styles.featureChip}>
              <View style={styles.featureIconCircle}>
                <MaterialIcons name={f.icon} size={18} color="#DC2626" />
              </View>
              <ThemedText style={styles.featureTitle}>{f.title}</ThemedText>
              <ThemedText style={styles.featureDesc}>{f.desc}</ThemedText>
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
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },
  center: {
    width: '100%',
    maxWidth: 400,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
  },

  /* Logo */
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  logoIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1E293B',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
  },

  /* Titles */
  titleAmharic: {
    fontSize: 48,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -1.5,
    textAlign: 'center',
  } as any,
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: -4,
  },
  desc: {
    fontSize: 14,
    fontWeight: '400',
    color: '#64748B',
    fontFamily: Fonts.sans,
    lineHeight: 21,
    textAlign: 'center',
  },

  /* Features */
  featuresRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    width: '100%',
  },
  featureChip: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  featureIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  featureDesc: {
    fontSize: 10,
    fontWeight: '500',
    color: '#64748B',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 14,
  },

  /* CTA */
  ctaGroup: {
    gap: 10,
    marginTop: 12,
    width: '100%',
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
    marginTop: 8,
  },
});
