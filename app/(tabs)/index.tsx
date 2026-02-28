import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Appearance, Platform, Pressable, StyleSheet, View } from 'react-native';
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

  const toggleTheme = () => {
    Appearance.setColorScheme(isDark ? 'light' : 'dark');
  };

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
    <View style={[styles.root, { backgroundColor: isDark ? '#0B0F1A' : '#F0F4FA' }]}>
      {/* Top red gradient like login page */}
      <LinearGradient
        colors={['#DC2626', '#EF4444', isDark ? '#0B0F1A' : '#F0F4FA']}
        style={styles.topGradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.logoIcon}>
            <MaterialIcons name="local-hospital" size={16} color="#fff" />
          </View>
          <ThemedText style={styles.logoText}>ErdAtaye</ThemedText>
        </View>
        <View style={styles.topBarRight}>
          <Pressable style={styles.iconBtn}>
            <MaterialIcons name="campaign" size={22} color="#FFFFFF" />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={toggleTheme}>
            <MaterialIcons name={isDark ? 'light-mode' : 'dark-mode'} size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Center content */}
      <View style={styles.center}>
        {/* Title */}
        <ThemedText
          style={[styles.titleAmharic, { fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded }]}>
          እርዳታዬ
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: isDark ? '#94A3B8' : '#475569' }]}>Emergency Ambulance Service</ThemedText>
        <ThemedText style={[styles.desc, { color: isDark ? '#64748B' : '#64748B' }]}>
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
            <MaterialIcons name="person-add" size={20} color="#DC2626" />
            <ThemedText style={styles.btnOutlineText}>Create Account</ThemedText>
          </Pressable>
        </View>

        <ThemedText style={[styles.footerNote, { color: isDark ? '#64748B' : '#94A3B8' }]}>Designed for Ethiopian emergency response</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
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

  /* Top bar */
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 48,
    paddingBottom: 8,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Center content */
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
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

  /* CTA */
  ctaGroup: {
    gap: 10,
    marginTop: 16,
    width: '100%',
    maxWidth: 400,
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
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
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
