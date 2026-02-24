import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';

interface LoadingModalProps {
  visible: boolean;
  message?: string;
  colorScheme?: 'light' | 'dark';
}

export const LoadingModal = ({
  visible,
  message = 'Creating your account...',
  colorScheme = 'light',
}: LoadingModalProps) => {
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }

    const spinLoop = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: false,
        }),
        Animated.timing(pulseValue, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: false,
        }),
      ])
    );

    spinLoop.start();
    pulseLoop.start();

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
      spinValue.setValue(0);
      pulseValue.setValue(0);
    };
  }, [visible, spinValue, pulseValue]);

  if (!visible) {
    return null;
  }

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const pulseOpacity = pulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 0.2],
  });

  const pulseScale = pulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });

  const isDark = colorScheme === 'dark';
  const bgColor = isDark ? '#0F172A' : '#FFFFFF';
  const textColor = isDark ? '#ECEDEE' : '#0F172A';
  const subTextColor = isDark ? '#94A3B8' : '#64748B';

  return (
    <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.spinnerContainer}>
          <Animated.View
            style={[
              styles.pulseRing,
              {
                opacity: pulseOpacity,
                transform: [{ scale: pulseScale }],
              },
            ]}
          />
          <View style={styles.staticRing} />
          <Animated.View
            style={[
              styles.spinner,
              {
                transform: [{ rotate: spin }],
              },
            ]}>
            <View style={styles.spinnerDot} />
          </Animated.View>
          <View style={styles.centerCircle} />
        </View>

        <ThemedText style={[styles.message, { color: textColor }]}>
          {message}
        </ThemedText>

        <ThemedText style={[styles.progressText, { color: subTextColor }]}>
          Please wait while we set up your account...
        </ThemedText>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
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
  spinnerContainer: {
    width: 100,
    height: 100,
    marginBottom: 28,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  staticRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FECACA',
    opacity: 0.4,
  },
  spinner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: '#EF4444',
    borderRightColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
    top: 0,
    left: '50%',
    marginLeft: -3,
  },
  centerCircle: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
  },
  message: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
    opacity: 0.7,
    fontWeight: '500',
  },
});
