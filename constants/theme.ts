/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#0F172A',
    textMuted: '#64748B',
    background: '#F6F7FB',
    surface: '#FFFFFF',
    surfaceMuted: '#F8FAFC',
    surfaceAlt: '#F1F5F9',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    tint: '#DC2626',
    primary: '#DC2626',
    primarySoft: '#FEE2E2',
    success: '#16A34A',
    warning: '#F59E0B',
    danger: '#EF4444',
    info: '#0EA5E9',
    icon: '#64748B',
    tabIconDefault: '#94A3B8',
    tabIconSelected: '#DC2626',
  },
  dark: {
    text: '#E2E8F0',
    textMuted: '#94A3B8',
    background: '#0B0F1A',
    surface: '#0F172A',
    surfaceMuted: '#111827',
    surfaceAlt: '#151C2C',
    border: '#1F2937',
    borderStrong: '#334155',
    tint: '#FCA5A5',
    primary: '#EF4444',
    primarySoft: '#7F1D1D',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#F87171',
    info: '#38BDF8',
    icon: '#A3AAB3',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#FCA5A5',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'SF Pro Display, -apple-system, BlinkMacSystemFont, sans-serif',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'New York, Georgia, serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'SF Pro Rounded, -apple-system, BlinkMacSystemFont, sans-serif',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'SF Mono, Monaco, monospace',
  },
  android: {
    sans: 'Roboto',
    serif: 'serif',
    rounded: 'Roboto',
    mono: 'monospace',
  },
  default: {
    sans: 'System, -apple-system, BlinkMacSystemFont, sans-serif',
    serif: 'serif',
    rounded: 'System, -apple-system, BlinkMacSystemFont, sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
