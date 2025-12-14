import React, { createContext, useContext, useMemo, useState } from 'react';

type AppState = {
  isRegistered: boolean;
  setRegistered: (v: boolean) => void;
  themeMode: 'system' | 'light' | 'dark';
  setThemeMode: (v: 'system' | 'light' | 'dark') => void;
  toggleThemeMode: () => void;
  isSirenMuted: boolean;
  toggleSirenMuted: () => void;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
  const [isSirenMuted, setIsSirenMuted] = useState(false);

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
    }),
    [isRegistered, themeMode, isSirenMuted]
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
