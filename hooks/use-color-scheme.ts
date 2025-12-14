import { useAppState } from '@/components/app-state';
import { useColorScheme as useRNColorScheme } from 'react-native';

export function useColorScheme(): 'light' | 'dark' {
  const deviceScheme = useRNColorScheme();
  const { themeMode } = useAppState();

  if (themeMode === 'light' || themeMode === 'dark') {
    return themeMode;
  }

  return deviceScheme === 'dark' ? 'dark' : 'light';
}
