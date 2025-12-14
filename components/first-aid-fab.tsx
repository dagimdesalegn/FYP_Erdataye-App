import { useAppState } from '@/components/app-state';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

export function FirstAidFab() {
  const { isRegistered } = useAppState();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();

  if (!isRegistered) return null;

  const isDark = colorScheme === 'dark';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: Math.max(insets.bottom, 12) + 78,
        },
      ]}>
      <Pressable
        onPress={() => alert('First Aid Chatbot (coming soon)')}
        style={({ pressed }) => [
          styles.btn,
          isDark ? styles.btnDark : styles.btnLight,
          pressed ? { transform: [{ scale: 0.98 }], opacity: 0.92 } : null,
        ]}>
        <View style={styles.iconPill}>
          <Image
            source={{ uri: 'https://img.icons8.com/color/96/ambulance.png' }}
            style={styles.iconImage}
            contentFit="contain"
          />
        </View>
        <ThemedText style={styles.text} lightColor="#fff" darkColor="#fff">
          First Aid
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  btnLight: {
    backgroundColor: '#0F172A',
  },
  btnDark: {
    backgroundColor: '#DC2626',
  },
  iconPill: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  iconImage: {
    width: 20,
    height: 20,
  },
  text: {
    fontSize: 14,
    fontWeight: '900',
  },
});
