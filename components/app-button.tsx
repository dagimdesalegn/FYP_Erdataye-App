import { useColorScheme } from '@/hooks/use-color-scheme';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, ViewStyle } from 'react-native';

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
      : 'transparent';

  const textColor =
    variant === 'primary' ? '#fff' : isDark ? '#ECEDEE' : '#11181C';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={10}
      style={({ pressed }) => [
        styles.base,
        fullWidth ? styles.fullWidth : null,
        { backgroundColor: bg, borderColor },
        variant === 'primary'
          ? {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: 0.16,
              shadowRadius: 18,
              elevation: 6,
            }
          : null,
        pressed ? { opacity: 0.92, transform: [{ scale: 0.99 }] } : null,
        (disabled || loading) ? { opacity: 0.55 } : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText style={[styles.label, { color: textColor }]}>{label}</ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  label: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
});
