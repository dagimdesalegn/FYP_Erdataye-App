import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl) {
  console.warn('Missing EXPO_PUBLIC_SUPABASE_URL environment variable.');
}

if (!supabaseKey) {
  console.warn(
    'Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (preferred) or EXPO_PUBLIC_SUPABASE_ANON_KEY (legacy).'
  );
}

type AuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const isWeb = Platform.OS === 'web';
const isWebSSR = isWeb && typeof window === 'undefined';

const noOpStorage: AuthStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

const webStorage: AuthStorage = {
  getItem: async (key: string) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};

const storage: AuthStorage = isWeb ? (isWebSSR ? noOpStorage : webStorage) : (AsyncStorage as AuthStorage);

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage,
    autoRefreshToken: !isWebSSR,
    persistSession: !isWebSSR,
    detectSessionInUrl: isWeb && !isWebSSR,
  },
});

export default supabase;
