import { useAppState } from '@/components/app-state';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

/**
 * Root/Landing page - handles initial navigation based on auth state
 * Shows loading while checking auth, then redirects to login or main app
 */
export default function IndexScreen() {
  const router = useRouter();
  const { isRegistered, isLoading } = useAppState();
  const colorScheme = useColorScheme();

  useEffect(() => {
    // Wait for auth state to be loaded
    if (isLoading) return;

    // If user is authenticated, go to main app
    if (isRegistered) {
      router.replace('/(tabs)');
    } else {
      // Otherwise, go to login page
      router.replace('/login');
    }
  }, [isLoading, isRegistered]);

  // Show loading indicator while checking auth state
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
