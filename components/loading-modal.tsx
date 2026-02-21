import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Modal, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';

interface LoadingModalProps {
  visible: boolean;
  message?: string;
  colorScheme?: 'light' | 'dark';
}

export const LoadingModal = ({ 
  visible, 
  message = 'Creating your account...', 
  colorScheme = 'light' 
}: LoadingModalProps) => {
  const ambulanceX = useRef(new Animated.Value(-100)).current;
  const ambulancePulse = useRef(new Animated.Value(0)).current;
  const dotScale1 = useRef(new Animated.Value(0)).current;
  const dotScale2 = useRef(new Animated.Value(0)).current;
  const dotScale3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }

    // Ambulance sliding animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(ambulanceX, {
          toValue: Dimensions.get('window').width + 100,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(ambulanceX, {
          toValue: -100,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(ambulancePulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(ambulancePulse, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Dots animation
    const createDotAnimation = (dot: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    };

    createDotAnimation(dotScale1, 0).start();
    createDotAnimation(dotScale2, 200).start();
    createDotAnimation(dotScale3, 400).start();
  }, [visible]);

  const pulseScale = ambulancePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.2],
  });

  const pulseOpacity = ambulancePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0],
  });

  const isDark = colorScheme === 'dark';
  const bgColor = isDark ? '#0F172A' : '#FFFFFF';
  const textColor = isDark ? '#ECEDEE' : '#0F172A';
  const subTextColor = isDark ? '#94A3B8' : '#64748B';

  return (
    <Modal visible={visible} transparent statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.container, { backgroundColor: bgColor }]}>
          {/* Animated Ambulance */}
          <View style={styles.ambulanceContainer}>
            <Animated.View
              style={[
                styles.ambulancePulse,
                {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            <Animated.Text
              style={[
                styles.ambulanceEmoji,
                {
                  transform: [{ translateX: ambulanceX }],
                },
              ]}>
              🚑
            </Animated.Text>
          </View>

          {/* Message */}
          <ThemedText style={[styles.message, { color: textColor }]}>
            {message}
          </ThemedText>

          {/* Animated Dots */}
          <View style={styles.dotsContainer}>
            <Animated.View
              style={[
                styles.dot,
                { transform: [{ scale: dotScale1 }] },
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                { transform: [{ scale: dotScale2 }] },
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                { transform: [{ scale: dotScale3 }] },
              ]}
            />
          </View>

          {/* Loading Progress Text */}
          <ThemedText style={[styles.progressText, { color: subTextColor }]}>
            Please wait while we set up your account...
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: 280,
    paddingVertical: 36,
    paddingHorizontal: 24,
    borderRadius: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 20,
  },
  ambulanceContainer: {
    marginBottom: 24,
    justifyContent: 'center',
    alignItems: 'center',
    height: 80,
  },
  ambulancePulse: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EF4444',
  },
  ambulanceEmoji: {
    fontSize: 60,
    fontWeight: '800',
  },
  message: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
    height: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
    opacity: 0.7,
    fontWeight: '500',
  },
});
