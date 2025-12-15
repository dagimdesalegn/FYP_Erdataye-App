import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AppStateProvider } from '@/components/app-state';
import { FirstAidFab } from '@/components/first-aid-fab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { View } from 'react-native';
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

  return (
    <View style={{ flex: 1, backgroundColor: Colors[theme].background }}>
      <ThemeProvider value={resolved === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'ErdAtaye Ambulance' }} />
          <Stack.Screen name="register" options={{ headerShown: false, title: 'Register' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <FirstAidFab />
        <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </View>
  );
}
