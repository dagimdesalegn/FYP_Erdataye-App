import { useAppState } from '@/components/app-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

/**
 * Root index - shows the main app page directly.
 * The (tabs)/index.tsx handles both authenticated and unauthenticated states.
 */
export default function IndexScreen() {
  const router = useRouter();
  const { isLoading } = useAppState();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = 'Erdataya Ambulance';
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    // Always go to (tabs) - the home screen handles both logged-in and guest states
    router.replace('/(tabs)');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors[colorScheme].background,
      }}>
      <ActivityIndicator size="large" color="#DC2626" />
    </View>
  );
}
