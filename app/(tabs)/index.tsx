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
            <MaterialIcons name="person-add" size={20} color="#0EA5E9" />
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
    backgroundColor: '#0EA5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0C4A6E',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
  },

  /* Titles */
  titleAmharic: {
    fontSize: 48,
    fontWeight: '900',
    color: '#0C4A6E',
    letterSpacing: -1.5,
    textAlign: 'center',
  } as any,
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0284C7',
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

  /* CTA */
  ctaGroup: {
    gap: 10,
    marginTop: 16,
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
    backgroundColor: '#0EA5E9',
    shadowColor: '#0EA5E9',
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
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
  },
  btnOutlineText: {
    color: '#0EA5E9',
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
