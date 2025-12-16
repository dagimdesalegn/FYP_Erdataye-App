import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppStateProvider } from '@/components/app-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <ThemedRoot />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const resolved = useColorScheme();
  const theme = resolved ?? 'light';

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void SystemUI.setBackgroundColorAsync(Colors[theme].background);
  }, [theme]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors[theme].background }}>
      <ThemeProvider value={resolved === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'ErdAtaye Ambulance' }} />
          <Stack.Screen name="register" options={{ headerShown: false, title: 'Register' }} />
          <Stack.Screen name="help" options={{ headerShown: false, title: 'Help' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </View>
  );
}
