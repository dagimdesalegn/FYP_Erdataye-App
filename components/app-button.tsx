import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, ViewStyle } from 'react-native';

import { ThemedText } from './themed-text';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  fullWidth,
  loading,
  disabled,
  style,
}: AppButtonProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  const bg =
    variant === 'primary'
      ? '#DC2626'
      : variant === 'secondary'
        ? isDark
          ? '#1F2937'
          : '#EEF2F6'
        : 'transparent';

  const borderColor =
    variant === 'ghost'
      ? isDark
        ? '#2E3236'
        : '#E6ECF2'
      : variant === 'secondary'
        ? isDark
          ? '#374151'
          : '#CBD5E1'
        : 'transparent';

  const textColor =
    variant === 'primary' ? '#fff' : isDark ? '#ECEDEE' : '#11181C';

  const handlePressIn = () => {
    Animated.timing(animatedValue, {
      toValue: 1,
      duration: 150,
      useNativeDriver: false,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(animatedValue, {
      toValue: 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
    onPress();
  };

  const animatedStyle = {
    transform: [
      {
        scale: animatedValue.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.96],
          extrapolate: 'clamp',
        }),
      },
    ],
    shadowOpacity: animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0.25, 0.15],
      extrapolate: 'clamp',
    }),
  };

  return (
    <Animated.View style={[fullWidth ? styles.fullWidth : null, style]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        hitSlop={15}
        style={[
          styles.base,
          fullWidth ? styles.fullWidth : null,
          {
            backgroundColor: bg,
            borderColor,
            borderWidth: 0,
          },
          variant === 'primary'
            ? {
                shadowColor: '#DC2626',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0,
                shadowRadius: 16,
                elevation: 0,
              }
            : variant === 'secondary'
            ? {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 4,
              }
            : null,
          animatedStyle,
          (disabled || loading) ? { opacity: 0.55 } : null,
        ]}>
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <ThemedText style={[styles.label, { color: textColor, fontFamily: Fonts.sans }]}>
            {label}
          </ThemedText>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 60,
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  fullWidth: {
    width: '100%',
  },
  label: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
});
