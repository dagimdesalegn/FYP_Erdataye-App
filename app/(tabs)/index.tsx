import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const router = useRouter();
  const { isRegistered, isSirenMuted, toggleSirenMuted } = useAppState();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;
  const isSmall = screenWidth < 380;
  const isShort = screenHeight < 740;

  const pageBg = Colors[theme].background;
  const titleColor = Colors[theme].text;
  const subText = isDark ? '#B7BDC3' : '#475569';
  const cardBg = isDark ? '#0B1220' : '#FFFFFF';
  const cardBorder = isDark ? '#2E3236' : '#EEF2F6';
  const logoBg = isDark ? '#0F172A' : '#F8FAFC';
  const sceneCtrlBg = isDark ? 'rgba(2,6,23,0.72)' : 'rgba(255,255,255,0.92)';
  const sceneCtrlBorder = isDark ? 'rgba(226,232,240,0.18)' : 'rgba(2,6,23,0.14)';
  const sceneCtrlIcon = isDark ? '#E6E9EC' : '#0F172A';

  const ride = useRef(new Animated.Value(0)).current;
  const wobble = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const roadShift = useRef(new Animated.Value(0)).current;
  const sirenRef = useRef<any>(null);
  const sirenOpRef = useRef(0);
  const rideValueRef = useRef(0);
  const rideListenerIdRef = useRef<string | null>(null);
  const rideAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const wobbleAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const roadAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const isFocusedRef = useRef(false);

  const sceneWidth = Math.min(620, screenWidth - 32);
  const patientX = 18;
  const hospitalX = Math.max(patientX, sceneWidth - 8 - 170 + 34);

  const scenePalette = useMemo(() => {
    const accent = Colors[theme].tint;
    return {
      accent,
      hospitalBase: isDark ? '#0A1020' : '#F7FAFF',
      hospitalEdge: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(2,6,23,0.10)',
      windowOn: isDark ? 'rgba(59,130,246,0.55)' : 'rgba(37,99,235,0.25)',
      windowOff: isDark ? 'rgba(226,232,240,0.12)' : 'rgba(2,6,23,0.08)',
      crossBg: isDark ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.12)',
      cross: isDark ? '#FCA5A5' : '#DC2626',
    };
  }, [isDark, theme]);

  useEffect(() => {
    // Set browser title for web
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.title = 'ErdAtaye Ambulance';
    }
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    // Track ride progress in JS so pause/resume can continue from the exact position.
    rideListenerIdRef.current = ride.addListener(({ value }) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        rideValueRef.current = value;
      }
    });

    return () => {
      const id = rideListenerIdRef.current;
      if (id) {
        ride.removeListener(id);
      }
      rideListenerIdRef.current = null;
    };
  }, [ride]);

  const stopSiren = useCallback(async () => {
    // Cancel any in-flight play request.
    sirenOpRef.current += 1;
    try {
      const s = sirenRef.current;
      sirenRef.current = null;
      if (s) {
        try {
          await s.setVolumeAsync(0);
        } catch {
          // ignore
        }
        await s.stopAsync();
        await s.unloadAsync();
      }
    } catch {
      // ignore
    }
  }, []);

  const playSiren = useCallback(async () => {
    const opId = (sirenOpRef.current += 1);
    try {
      if (isSirenMuted) return;

      // Ensure there is never more than one siren instance alive.
      const existing = sirenRef.current;
      if (existing) {
        try {
          await existing.stopAsync();
          await existing.unloadAsync();
        } catch {
          // ignore
        }
        sirenRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/images/medical-ambulance-siren.mp3'),
        { shouldPlay: false, isLooping: true, volume: 0.8 }
      );

      // If something changed (mute toggled / screen unfocused / pause), cancel this instance.
      if (sirenOpRef.current !== opId || isSirenMuted) {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore
        }
        return;
      }

      sirenRef.current = sound;
      await sound.playAsync();
    } catch {
      // ignore
    }
  }, [isSirenMuted]);

  const startMotion = useCallback((resume?: boolean) => {
    rideAnimRef.current?.stop();
    wobbleAnimRef.current?.stop();
    pulseAnimRef.current?.stop();
    roadAnimRef.current?.stop();

    const clamped = Math.max(0, Math.min(2, Number.isFinite(rideValueRef.current) ? rideValueRef.current : 0));

    if (!resume) {
      ride.setValue(0);
      wobble.setValue(0);
      pulse.setValue(0);
      roadShift.setValue(0);
    }

    const LEG_MS = 2400;
    const RESET_MS = 1;
    const LOOP_GAP_MS = 16;
    const at = resume ? clamped : 0;

    // Continue from the current position.
    const toHospitalMs = at < 1 ? Math.max(120, (1 - at) * LEG_MS) : 0;
    const toPatientMs = at >= 1 && at < 2 ? Math.max(120, (2 - at) * LEG_MS) : 0;

    const rideSequence =
      at < 1
        ? [
            Animated.delay(resume ? 0 : 500),
            Animated.timing(ride, {
              toValue: 1,
              duration: toHospitalMs,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.delay(650),
            Animated.timing(ride, {
              toValue: 2,
              duration: LEG_MS,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.delay(850),
            Animated.timing(ride, {
              toValue: 0,
              duration: RESET_MS,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
            Animated.delay(LOOP_GAP_MS),
          ]
        : at < 2
          ? [
              Animated.delay(0),
              Animated.timing(ride, {
                toValue: 2,
                duration: toPatientMs,
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.delay(850),
              Animated.timing(ride, {
                toValue: 0,
                duration: RESET_MS,
                easing: Easing.linear,
                useNativeDriver: true,
              }),
              Animated.delay(LOOP_GAP_MS),
            ]
          : [
              Animated.delay(LOOP_GAP_MS),
              Animated.timing(ride, {
                toValue: 0,
                duration: RESET_MS,
                easing: Easing.linear,
                useNativeDriver: true,
              }),
              Animated.delay(LOOP_GAP_MS),
            ];

    const rideAnim = Animated.loop(Animated.sequence(rideSequence));

    const wobbleAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(wobble, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wobble, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );

    const roadAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(roadShift, { toValue: 1, duration: 950, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(roadShift, { toValue: 0, duration: RESET_MS, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(LOOP_GAP_MS),
      ])
    );

    rideAnimRef.current = rideAnim;
    wobbleAnimRef.current = wobbleAnim;
    pulseAnimRef.current = pulseAnim;
    roadAnimRef.current = roadAnim;

    rideAnim.start();
    wobbleAnim.start();
    pulseAnim.start();
    roadAnim.start();
  }, [pulse, ride, roadShift, wobble]);

  const pauseMotion = useCallback(() => {
    rideAnimRef.current?.stop();
    wobbleAnimRef.current?.stop();
    pulseAnimRef.current?.stop();
    roadAnimRef.current?.stop();

    // Capture the exact stop position for resume.
    ride.stopAnimation((v: number) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        rideValueRef.current = v;
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;

      // Only start motion when entering focus AND currently playing.
      if (isPlayingRef.current) {
        startMotion(true);
        wasPlayingRef.current = true;
      } else {
        wasPlayingRef.current = false;
      }

      return () => {
        isFocusedRef.current = false;
        wasPlayingRef.current = false;
        pauseMotion();
        void stopSiren();
      };
    }, [pauseMotion, startMotion, stopSiren])
  );

  // Motion should only start/stop when the user toggles play/pause (while focused).
  useEffect(() => {
    if (!isFocusedRef.current) return;

    if (isPlaying && !wasPlayingRef.current) {
      startMotion(true);
      wasPlayingRef.current = true;
      return;
    }

    if (!isPlaying && wasPlayingRef.current) {
      pauseMotion();
      wasPlayingRef.current = false;
    }
  }, [isPlaying, pauseMotion, startMotion]);

  // Sound should never affect motion; it only starts/stops the siren.
  useEffect(() => {
    if (!isFocusedRef.current) return;
    if (!isPlaying) {
      void stopSiren();
      return;
    }
    if (isSirenMuted) {
      void stopSiren();
      return;
    }

    void stopSiren().then(() => playSiren());
  }, [isPlaying, isSirenMuted, playSiren, stopSiren]);

  return (
    <View style={[styles.bg, { backgroundColor: pageBg }]}>
      <AppHeader
        title="ErdAtaye"
        announcementHref="/modal"
      />

      <View style={styles.scrollContainer}>
        <View style={styles.pageContent}>
          <View style={styles.heroTop}>
            <ThemedText
              style={[
                styles.title,
                {
                  color: titleColor,
                  fontSize: isSmall ? 32 : 36,
                  lineHeight: isSmall ? 44 : 48,
                  paddingBottom: isSmall ? 8 : 6,
                  marginBottom: isSmall ? 18 : 10,
                  fontFamily: Platform.OS === 'android' ? 'sans-serif' : Fonts.rounded,
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
                  marginTop: isSmall ? 2 : 0,
                  marginBottom: isSmall ? 12 : 10,
                  lineHeight: isSmall ? 20 : 22,
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
                  lineHeight: isSmall ? 20 : 22,
                  fontFamily: Fonts.sans,
                },
              ]}>
              Quick ambulance request, verified access, and first-aid support designed for Ethiopia.
            </ThemedText>
          </View>

          <View style={styles.midLogoRow}>
            <View
              style={[
                styles.scene,
                {
                  backgroundColor: logoBg,
                  borderColor: cardBorder,
                  height: isSmall || isShort ? 220 : 260,
                },
              ]}
            >
              <View style={styles.sceneOverlayTop} />
              <Animated.View
                style={[
                  styles.sceneGlow,
                  {
                    backgroundColor: scenePalette.accent,
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.32] }),
                  },
                ]}
              />
              <View style={styles.road} />
              <View style={styles.roadEdge} />
              <View style={styles.roadEdge2} />
              <Animated.View
                style={[
                  styles.roadMarks,
                  {
                    transform: [
                      {
                        translateX: roadShift.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -58],
                        }),
                      },
                    ],
                    opacity: isPlaying ? 1 : 0.6,
                  },
                ]}>
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
                <View style={[styles.roadDash, { backgroundColor: isDark ? 'rgba(226,232,240,0.55)' : 'rgba(255,255,255,0.9)' }]} />
              </Animated.View>

              <View style={styles.sceneControlOverlay}>
                <Pressable
                  onPress={() => setIsPlaying((p) => !p)}
                  style={({ pressed }) => [
                    styles.sceneCtlIconBtn,
                    {
                      backgroundColor: sceneCtrlBg,
                      borderColor: sceneCtrlBorder,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}>
                  <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={18} color={sceneCtrlIcon} />
                </Pressable>

                <Pressable
                  onPress={toggleSirenMuted}
                  style={({ pressed }) => [
                    styles.sceneSoundBtn,
                    {
                      backgroundColor: sceneCtrlBg,
                      borderColor: sceneCtrlBorder,
                    },
                    pressed ? { opacity: 0.9 } : null,
                  ]}>
                  <MaterialIcons
                    name={isSirenMuted ? 'volume-off' : 'volume-up'}
                    size={18}
                    color={isSirenMuted ? sceneCtrlIcon : scenePalette.accent}
                  />
                </Pressable>
              </View>

              <View style={styles.patientWrap}>
                <Animated.View
                  style={{
                    opacity: ride.interpolate({
                      inputRange: [0, 0.12, 0.25, 1, 1.85, 2],
                      outputRange: [1, 0.2, 0, 0, 0.35, 1],
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
                        outputRange: [patientX, hospitalX, patientX],
                        extrapolate: 'clamp',
                      }),
                    },
                    {
                      translateY: wobble.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -2.5],
                      }),
                    },
                    {
                      scaleX: ride.interpolate({
                        inputRange: [0, 1, 1.01, 2],
                        outputRange: [1, 1, -1, -1],
                        extrapolate: 'clamp',
                      }),
                    },
                    {
                      rotate: wobble.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '0.6deg'],
                      }),
                    },
                  ],
                  opacity: 1,
                }}>
                <Animated.View
                  style={{
                    ...styles.sirenBlink,
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.55] }),
                    backgroundColor: scenePalette.accent,
                  }}
                />
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
                <View
                  style={[
                    styles.hospitalIllustration,
                    {
                      backgroundColor: scenePalette.hospitalBase,
                      borderColor: scenePalette.hospitalEdge,
                    },
                  ]}>
                  <View style={styles.hospitalRoof} />
                  <View style={styles.hospitalTopRow}>
                    <View
                      style={[
                        styles.hospitalCrossWrap,
                        {
                          backgroundColor: scenePalette.crossBg,
                          borderColor: scenePalette.hospitalEdge,
                        },
                      ]}>
                      <View style={[styles.hospitalCrossV, { backgroundColor: scenePalette.cross }]} />
                      <View style={[styles.hospitalCrossH, { backgroundColor: scenePalette.cross }]} />
                    </View>
                  </View>
                  <View style={styles.hospitalBody}>
                    <View style={styles.hospitalWindowCol}>
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOn }]} />
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOff }]} />
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOff }]} />
                    </View>
                    <View style={styles.hospitalWindowCol}>
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOff }]} />
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOn }]} />
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOff }]} />
                    </View>
                    <View style={styles.hospitalWindowCol}>
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOff }]} />
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOff }]} />
                      <View style={[styles.hospitalWindow, { backgroundColor: scenePalette.windowOn }]} />
                    </View>
                    <View style={styles.hospitalDoorWrap}>
                      <View style={[styles.hospitalDoor, { backgroundColor: isDark ? 'rgba(226,232,240,0.16)' : 'rgba(2,6,23,0.08)' }]} />
                      <View style={[styles.hospitalDoorLine, { backgroundColor: isDark ? 'rgba(226,232,240,0.22)' : 'rgba(2,6,23,0.10)' }]} />
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.ctaSection}>
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
              <View style={styles.primaryButtonContainer}>
                <AppButton
                  label="Register"
                  onPress={() => router.push('/register')}
                  variant="primary"
                  fullWidth
                  style={styles.primaryCta}
                />
              </View>
              <View style={styles.dividerContainer}>
                <View style={[styles.dividerLine, { backgroundColor: isDark ? '#2E3236' : '#E6ECF2' }]} />
                <ThemedText style={[styles.dividerText, { color: isDark ? '#6B7280' : '#64748B' }]}>OR</ThemedText>
                <View style={[styles.dividerLine, { backgroundColor: isDark ? '#2E3236' : '#E6ECF2' }]} />
              </View>
              <View style={styles.secondaryButtonContainer}>
                <AppButton
                  label="I already have an account"
                  onPress={() => router.push('/explore')}
                  variant="secondary"
                  fullWidth
                  style={styles.secondaryCta}
                />
              </View>
            </View>
            )}
            </ThemedView>
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
  scrollContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    justifyContent: 'flex-start',
  },
  pageContent: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: 14,
  },
  heroTop: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  midLogoRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 10,
    gap: 10,
  },
  ctaSection: {
    marginTop: 0,
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
    height: 280,
    borderRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 2,
    borderBottomColor: '#0B0B0B',
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
    bottom: 0,
    height: 28,
    backgroundColor: '#0B0B0B',
  },
  roadEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  roadEdge2: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  roadMarks: {
    position: 'absolute',
    left: 190,
    right: 18,
    bottom: 12,
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
    bottom: 46,
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
    bottom: 6,
    zIndex: 1,
  },
  sirenBlink: {
    position: 'absolute',
    left: 26,
    top: 16,
    width: 12,
    height: 6,
    borderRadius: 999,
  },
  ambulance: {
    width: 90,
    height: 90,
  },
  hospitalWrap: {
    position: 'absolute',
    right: 8,
    bottom: 0,
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
  hospitalIllustration: {
    width: 170,
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
  },
  hospitalRoof: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: -10,
    height: 28,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.10)',
    transform: [{ rotate: '0deg' }],
  },
  hospitalTopRow: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hospitalCrossWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  hospitalCrossV: {
    width: 6,
    height: 20,
    borderRadius: 999,
  },
  hospitalCrossH: {
    position: 'absolute',
    width: 20,
    height: 6,
    borderRadius: 999,
  },
  hospitalBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  hospitalWindowCol: {
    width: 22,
    gap: 7,
    paddingBottom: 18,
  },
  hospitalWindow: {
    width: 22,
    height: 12,
    borderRadius: 4,
  },
  hospitalDoorWrap: {
    width: 34,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  hospitalDoor: {
    width: 28,
    height: 44,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  hospitalDoorLine: {
    position: 'absolute',
    width: 2,
    height: 38,
    bottom: 4,
    borderRadius: 999,
  },
  fenceText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  sceneOverlayTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 120,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  sceneGlow: {
    position: 'absolute',
    left: -60,
    right: -60,
    top: -60,
    height: 200,
    borderRadius: 999,
  },
  sceneControlOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 6,
  },
  sceneCtlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  sceneCtlIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  sceneSoundBtn: {
    marginLeft: 'auto',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  title: {
    fontWeight: '900',
    marginTop: 12,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 10,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 360,
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
  card: {
    width: '100%',
    alignSelf: 'center',
    borderRadius: 20,
    padding: 16,
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
    fontWeight: '800',
    marginBottom: 6,
    fontFamily: Fonts.sans,
    letterSpacing: -0.2,
  },
  cardBody: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
    fontFamily: Fonts.sans,
    fontWeight: '500',
  },
  primaryButtonContainer: {
    marginBottom: 6,
  },
  secondaryButtonContainer: {
    marginTop: 6,
    marginBottom: 0,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 16,
    fontFamily: Fonts.sans,
    letterSpacing: 1,
  },
  buttonRow: {
    marginTop: 12,
  },
  ctaStack: {
    marginTop: 20,
    gap: 8,
  },
  primaryCta: {
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  secondaryCta: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  secondaryRow: {
    marginTop: 0,
  },
});
