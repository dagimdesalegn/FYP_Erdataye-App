import { useAppState } from '@/components/app-state';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type Href, useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemedText } from './themed-text';

type HeaderAction = {
  label: string;
  href: Href;
  variant?: 'primary' | 'ghost';
};

export function AppHeader({
  title,
  actions,
  announcementHref,
}: {
  title: string;
  actions?: HeaderAction[];
  announcementHref?: Href;
}) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { themeMode, toggleThemeMode } = useAppState();
  const router = useRouter();

  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 12),
          backgroundColor: colors.background,
          borderBottomColor: colorScheme === 'dark' ? '#232526' : '#EEF2F6',
        },
      ]}>
      <View style={styles.content}>
        <View style={styles.left}>
          <View style={styles.brandMark}>
            <MaterialIcons name="local-hospital" size={18} color={colors.tint} />
          </View>
          <ThemedText
            style={[
              styles.title,
              {
                color: colors.text,
                fontFamily: Fonts.rounded,
              },
            ]}
            numberOfLines={1}>
            {title}
          </ThemedText>
        </View>

        <View style={styles.right}>
          {announcementHref ? (
            <Pressable
              onPress={() => router.push(announcementHref)}
              style={({ pressed }) => [
                styles.toggleBase,
                {
                  backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  borderColor: colorScheme === 'dark' ? '#2E3236' : '#E6ECF2',
                },
                pressed ? { opacity: 0.85 } : null,
              ]}>
              <MaterialIcons name="campaign" size={18} color={colorScheme === 'dark' ? '#E6E9EC' : '#11181C'} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={toggleThemeMode}
            style={({ pressed }) => [
              styles.toggleBase,
              {
                backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                borderColor: colorScheme === 'dark' ? '#2E3236' : '#E6ECF2',
              },
              pressed ? { opacity: 0.85 } : null,
            ]}>
            <MaterialIcons
              name={themeMode === 'dark' ? 'dark-mode' : themeMode === 'light' ? 'light-mode' : 'brightness-auto'}
              size={18}
              color={colorScheme === 'dark' ? '#E6E9EC' : '#11181C'}
            />
          </Pressable>
          {(actions ?? []).map((a) => (
            <Pressable
              key={a.label}
              onPress={() => router.push(a.href)}
              style={({ pressed }) => [
                styles.actionBase,
                a.variant === 'primary'
                  ? {
                      backgroundColor: '#DC2626',
                      borderColor: 'transparent',
                    }
                  : {
                      backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                      borderColor: colorScheme === 'dark' ? '#2E3236' : '#E6ECF2',
                    },
                a.variant === 'primary'
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 10 },
                      shadowOpacity: 0.16,
                      shadowRadius: 18,
                      elevation: 6,
                    }
                  : null,
                pressed ? { opacity: 0.85 } : null,
              ]}>
              <ThemedText
                style={[
                  styles.actionText,
                  a.variant === 'primary'
                    ? { color: '#fff' }
                    : { color: colorScheme === 'dark' ? '#E6E9EC' : '#11181C' },
                ]}>
                {a.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220,38,38,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.18)',
  },
  title: {
    fontSize: 18,
    fontWeight: Platform.select({ ios: '700', default: '700' }),
    letterSpacing: 0.2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toggleBase: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBase: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
