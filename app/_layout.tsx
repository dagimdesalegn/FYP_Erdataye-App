import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppStateProvider } from '@/components/app-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Prevent the splash screen from auto-hiding before fonts load
SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialIcons.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      // Hide splash screen once fonts are loaded or failed (don't block the app)
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Don't render until font loading is resolved (loaded or errored)
  if (!fontsLoaded && !fontError) {
    return null;
  }

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
          <Stack.Screen name="index" options={{ headerShown: false, title: 'Erdataya Ambulance' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Erdataya Ambulance' }} />
          <Stack.Screen name="login" options={{ headerShown: false, title: 'Login' }} />
          <Stack.Screen name="register" options={{ headerShown: false, title: 'Register' }} />
          <Stack.Screen name="help" options={{ headerShown: false, title: 'Help' }} />
          {/* Patient Routes */}
          <Stack.Screen name="patient-profile" options={{ headerShown: false, title: 'Patient Profile' }} />
          <Stack.Screen name="patient-emergency" options={{ headerShown: false, title: 'Emergency' }} />
          <Stack.Screen name="patient-emergency-tracking" options={{ headerShown: false, title: 'Emergency Tracking' }} />
          {/* Driver Routes */}
          <Stack.Screen name="driver-home" options={{ headerShown: false, title: 'Driver Home' }} />
          <Stack.Screen name="driver-emergency" options={{ headerShown: false, title: 'Emergency Assignment' }} />
          <Stack.Screen name="driver-patient-info" options={{ headerShown: false, title: 'Patient Information' }} />
          <Stack.Screen name="driver-emergency-tracking" options={{ headerShown: false, title: 'Emergency Tracking' }} />
          {/* Admin Route */}
          <Stack.Screen name="admin" options={{ headerShown: false, title: 'Admin Panel' }} />
          {/* Hospital & Map Routes */}
          <Stack.Screen name="hospital" options={{ headerShown: false, title: 'Hospital Dashboard' }} />
          <Stack.Screen name="map" options={{ headerShown: false, title: 'Live Map' }} />
          <Stack.Screen name="emergency" options={{ headerShown: false, title: 'Emergency' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </View>
  );
}
