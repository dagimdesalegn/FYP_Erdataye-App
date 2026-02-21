import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AuthUser, onAuthStateChange } from '../utils/auth';

type AppState = {
  isRegistered: boolean;
  setRegistered: (v: boolean) => void;
  themeMode: 'system' | 'light' | 'dark';
  setThemeMode: (v: 'system' | 'light' | 'dark') => void;
  toggleThemeMode: () => void;
  isSirenMuted: boolean;
  toggleSirenMuted: () => void;
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  isLoading: boolean;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChange((authUser) => {
      setUser(authUser);
      setIsRegistered(!!authUser);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  const toggleThemeMode = () => {
    setThemeMode((prev) => (prev === 'system' ? 'dark' : prev === 'dark' ? 'light' : 'system'));
  };

  const toggleSirenMuted = () => {
    setIsSirenMuted((p) => !p);
  };

  const value = useMemo<AppState>(
    () => ({
      isRegistered,
      setRegistered: setIsRegistered,
      themeMode,
      setThemeMode,
      toggleThemeMode,
      isSirenMuted,
      toggleSirenMuted,
      user,
      setUser,
      isLoading,
    }),
    [isRegistered, themeMode, isSirenMuted, user, isLoading]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return ctx;
}
