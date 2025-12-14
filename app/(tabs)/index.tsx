import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { Animated, Dimensions, ScrollView, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, isSirenMuted } = useAppState();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const screenWidth = Dimensions.get('window').width;
  const isSmall = screenWidth < 380;

  const pageBg = Colors[theme].background;
  const titleColor = Colors[theme].text;
  const subText = isDark ? '#B7BDC3' : '#475569';
  const cardBg = isDark ? '#0B1220' : '#FFFFFF';
  const cardBorder = isDark ? '#2E3236' : '#EEF2F6';
  const logoBg = isDark ? '#0F172A' : '#F8FAFC';

  const ride = useRef(new Animated.Value(0)).current;
  const sirenRef = useRef<any>(null);

  const sceneWidth = Math.min(620, screenWidth - 32);
  const patientX = 18;
  const hospitalX = Math.max(patientX, sceneWidth - 8 - 170 + 34);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const playSiren = async () => {
        try {
          if (isSirenMuted) return;
          const { sound } = await Audio.Sound.createAsync(
            {
              uri: 'https://archive.org/download/GOLD_TAPE_44_Sirens/G44-04-Ambulance%20Siren.mp3',
            },
            { shouldPlay: false, isLooping: true, volume: 0.8 }
          );

          if (!isActive) {
            await sound.unloadAsync();
            return;
          }

          sirenRef.current = sound;
          await sound.playAsync();
        } catch {
          // ignore
        }
      };

      const stopSiren = async () => {
        try {
          const s = sirenRef.current;
          sirenRef.current = null;
          if (s) {
            await s.stopAsync();
            await s.unloadAsync();
          }
        } catch {
          // ignore
        }
      };

      ride.stopAnimation(() => {
        ride.setValue(0);
      });

      const anim = Animated.loop(
        Animated.sequence([
          Animated.delay(700),
          // Hospital -> Patient
          Animated.timing(ride, {
            toValue: 1,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.delay(700),
          // Patient -> Hospital
          Animated.timing(ride, {
            toValue: 2,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.delay(900),
          // Reset back to parked
          Animated.timing(ride, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );

      anim.start();
      void playSiren();

      return () => {
        isActive = false;
        anim.stop();
        void stopSiren();
      };
    }, [ride, isSirenMuted])
  );

  return (
    <View style={[styles.bg, { backgroundColor: pageBg }]}>
      <AppHeader
        title="ErdAtaye"
        announcementHref="/modal"
      />

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.pageContent}>
          <View style={styles.heroTop}>
            <ThemedText
              style={[
                styles.title,
                {
                  color: titleColor,
                  fontSize: isSmall ? 32 : 36,
                  fontFamily: Fonts.rounded,
                },
              ]}>
              እርዳታዬ
            </ThemedText>
            <ThemedText
              style={[
                styles.subtitle,
                {
                  color: subText,
                  fontSize: isSmall ? 14 : 15,
                  fontFamily: Fonts.sans,
                },
              ]}>
              Emergency Ambulance Service for Ethiopia
            </ThemedText>
            <ThemedText
              style={[
                styles.description,
                {
                  color: subText,
                  fontSize: isSmall ? 13 : 14,
                  fontFamily: Fonts.sans,
                },
              ]}>
              Quick ambulance request, verified access, and first-aid support designed for Ethiopia.
            </ThemedText>
          </View>

          <View style={styles.midLogoRow}>
            <View style={[styles.scene, { backgroundColor: logoBg, borderColor: cardBorder }]}
            >
              <View style={[styles.road, { backgroundColor: isDark ? 'rgba(15,23,42,0.55)' : 'rgba(15,23,42,0.22)' }]} />
              <View style={[styles.roadEdge, { backgroundColor: isDark ? 'rgba(226,232,240,0.10)' : 'rgba(15,23,42,0.10)' }]} />
              <View style={[styles.roadEdge2, { backgroundColor: isDark ? 'rgba(226,232,240,0.08)' : 'rgba(15,23,42,0.08)' }]} />
              <View style={styles.roadMarks}>
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
              </View>

              <View style={styles.patientWrap}>
                <Animated.View
                  style={{
                    opacity: ride.interpolate({
                      inputRange: [0, 0.7, 1, 1.15, 1.85, 2],
                      outputRange: [1, 1, 0.1, 0, 0, 1],
                      extrapolate: 'clamp',
                    }),
                  }}>
                  <View style={styles.patientIconWrap}>
                    <Image
                      source={{ uri: 'https://img.icons8.com/color/96/person-male.png' }}
                      style={styles.patientIcon}
                      contentFit="contain"
                    />
                    <Image
                      source={{ uri: 'https://img.icons8.com/color/48/marker.png' }}
                      style={styles.patientPin}
                      contentFit="contain"
                    />
                  </View>
                  <ThemedText style={[styles.patientText, { color: titleColor }]}>Patient</ThemedText>
                </Animated.View>
              </View>

              <Animated.View
                style={{
                  ...styles.ambulanceMotion,
                  transform: [
                    {
                      translateX: ride.interpolate({
                        inputRange: [0, 1, 2],
                        outputRange: [hospitalX, patientX, hospitalX],
                        extrapolate: 'clamp',
                      }),
                    },
                    {
                      scaleX: ride.interpolate({
                        inputRange: [0, 1, 1.01, 2],
                        outputRange: [-1, -1, 1, 1],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                  opacity: 1,
                }}>
                <Image
                  source={{ uri: 'https://img.icons8.com/color/256/ambulance.png' }}
                  style={styles.ambulance}
                  contentFit="contain"
                />
              </Animated.View>

              <View style={styles.hospitalWrap}>
                <View
                  style={[
                    styles.hospitalBadge,
                    {
                      borderColor: cardBorder,
                      backgroundColor: isDark ? 'rgba(11,18,32,0.72)' : 'rgba(255,255,255,0.92)',
                    },
                  ]}>
                  <ThemedText style={[styles.fenceText, { color: titleColor }]} numberOfLines={1}>
                    ErdAtaye Hospital
                  </ThemedText>
                </View>
                <Image
                  source={require('../../assets/images/hospital.jpg')}
                  style={styles.hospital}
                  contentFit="cover"
                />
              </View>
            </View>
          </View>

          <ThemedView style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <ThemedText style={[styles.cardTitle, { color: titleColor }]}>
              {isRegistered ? 'Emergency services' : 'Activate services'}
            </ThemedText>
            <ThemedText style={[styles.cardBody, { color: subText }]}>
              {isRegistered
                ? 'You are registered. Continue to request assistance.'
                : 'Register your medical profile to unlock emergency actions and first-aid support.'}
            </ThemedText>

            {isRegistered ? (
              <View style={styles.buttonRow}>
                <AppButton
                  label="Continue"
                  onPress={() => router.push('/help')}
                  variant="primary"
                  fullWidth
                  style={styles.primaryCta}
                />
              </View>
            ) : (
            <View style={styles.ctaStack}>
              <View style={styles.buttonRow}>
                <AppButton
                  label="Register"
                  onPress={() => router.push('/register')}
                  variant="primary"
                  fullWidth
                  style={styles.primaryCta}
                />
              </View>
              <View style={styles.secondaryRow}>
                <AppButton
                  label="I already have an account"
                  onPress={() => router.push('/explore')}
                  variant="secondary"
                  fullWidth
                />
              </View>
            </View>
            )}
          </ThemedView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 34,
    justifyContent: 'space-between',
  },
  pageContent: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 14,
  },
  heroTop: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 14,
  },
  midLogoRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 14,
    gap: 10,
  },
  logoWrap: {
    width: 148,
    height: 148,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EEF2F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 6,
  },
  logo: {
    width: 112,
    height: 112,
  },
  scene: {
    width: '100%',
    maxWidth: 620,
    height: 240,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 6,
  },
  road: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 46,
    height: 28,
  },
  roadEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 74,
    height: 3,
  },
  roadEdge2: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 46,
    height: 3,
  },
  roadMarks: {
    position: 'absolute',
    left: 190,
    right: 18,
    bottom: 58,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roadDash: {
    width: 48,
    height: 4,
    borderRadius: 999,
  },
  patientWrap: {
    position: 'absolute',
    left: 10,
    bottom: 92,
    alignItems: 'center',
    justifyContent: 'center',
    width: 84,
    zIndex: 3,
  },
  patientIconWrap: {
    width: 48,
    height: 48,
    alignSelf: 'center',
  },
  patientIcon: {
    width: 44,
    height: 44,
    alignSelf: 'center',
  },
  patientPin: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 22,
    height: 22,
  },
  patientText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  ambulanceMotion: {
    position: 'absolute',
    left: 0,
    bottom: 52,
    zIndex: 1,
  },
  ambulance: {
    width: 90,
    height: 90,
  },
  hospitalWrap: {
    position: 'absolute',
    right: 8,
    bottom: 46,
    alignItems: 'center',
    zIndex: 2,
  },
  hospitalBadge: {
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 180,
  },
  hospital: {
    width: 170,
    height: 110,
    borderRadius: 14,
  },
  fenceText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  title: {
    fontWeight: '900',
    marginTop: 12,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 10,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 20,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 360,
  },
  card: {
    width: '100%',
    alignSelf: 'center',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EEF2F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  buttonRow: {
    marginTop: 12,
  },
  ctaStack: {
    marginTop: 12,
    gap: 12,
  },
  primaryCta: {
    paddingVertical: 16,
    borderRadius: 999,
  },
  secondaryRow: {
    marginTop: 0,
  },
});
