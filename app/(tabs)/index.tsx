import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
  useAppState();
  useColorScheme();
  // Theme is always light for landing page

  // Set browser tab title on web
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = 'Erdataya Ambulance';
    }
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: '#fff' }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.logoIcon}>
            <MaterialIcons name="local-hospital" size={16} color="#fff" />
          </View>
          <ThemedText style={[styles.logoText, { color: '#111' }]}>Erdataya Ambulance</ThemedText>
        </View>
        <View style={styles.topBarRight}>
          <Pressable style={styles.iconBtn}>
            <MaterialIcons name="campaign" size={22} color="#DC2626" />
          </Pressable>
        </View>
      </View>
      {/* Center content */}
      <View style={styles.center}>
        <View style={[styles.card, { backgroundColor: '#fff', borderColor: '#eee', shadowColor: '#DC2626' }]}> 
          {/* Title */}
          <ThemedText
            style={[
              styles.titleAmharic,
              { fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded, color: '#111' },
              styles.titleAmharicShadow,
            ]}>
            እርዳታዬ
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: '#111', fontWeight: 'bold' }]}>Emergency Ambulance Service</ThemedText>
          <ThemedText style={[styles.desc, { color: '#222', fontWeight: '500' }]}>Saving lives across Ethiopia with fast, reliable{"\n"}ambulance dispatch powered by real-time GPS.</ThemedText>
          {/* CTA */}
          <View style={styles.ctaGroup}>
            <Pressable
              onPress={() => router.push('/login')}
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed, { borderWidth: 2, borderColor: '#fff' }]}
            >
              <MaterialIcons name="login" size={20} color="#FFF" />
              <ThemedText style={[styles.btnPrimaryText, { color: '#FFF', textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }]}>Sign In</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => router.push('/register')}
              style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && styles.btnPressed, { borderWidth: 2, borderColor: '#DC2626', backgroundColor: '#fff' }]}
            >
              <MaterialIcons name="person-add" size={20} color="#DC2626" />
              <ThemedText style={[styles.btnOutlineText, { color: '#DC2626', textShadowColor: '#fff', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }]}>Create Account</ThemedText>
            </Pressable>
          </View>
          <ThemedText style={[styles.footerNote, styles.footerNoteCard, { color: '#DC2626' }]}>Designed for Ethiopian emergency response</ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 32,
      paddingBottom: 16,
      width: '100%',
      zIndex: 2,
    },
    topBarLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    topBarRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    logoIcon: {
      backgroundColor: '#DC2626',
      borderRadius: 8,
      padding: 4,
      marginRight: 6,
    },
    logoText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 18,
      letterSpacing: 1.2,
      fontFamily: Fonts.sans,
    },
    iconBtn: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: 'transparent',
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      paddingHorizontal: 16,
      zIndex: 1,
    },
  root: {
    flex: 1,
    ...(Platform.OS === 'web' ? { minHeight: '100vh' as any } : {}),
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: -1,
  },
  card: {
    paddingHorizontal: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
    marginBottom: 24,
    marginTop: 12,
    width: '100%',
    maxWidth: 420,
    gap: 16,
  },
  titleAmharicShadow: {
    textShadowColor: '#F87171',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
    marginBottom: 8,
    marginTop: 0,
  },
  titleAmharic: {
    fontSize: 48,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -1.5,
    textAlign: 'center',
  } as any,
  subtitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 0,
    marginBottom: 4,
  },
  desc: {
    fontSize: 15,
    fontWeight: '500',
    color: '#E5E7EB',
    fontFamily: Fonts.sans,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 12,
  },
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
  footerNote: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: 8,
  },
  footerNoteCard: {
    marginTop: 18,
    marginBottom: 2,
    fontWeight: 'bold',
    fontSize: 13,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    letterSpacing: 0.2
  }
});
