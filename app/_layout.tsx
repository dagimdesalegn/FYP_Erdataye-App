import {
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
} from "@expo-google-fonts/inter";
import { MaterialIcons } from "@expo/vector-icons";
import {
    DarkTheme,
    DefaultTheme,
    ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { AppStateProvider } from "@/components/app-state";
import { ErrorBoundary } from "@/components/error-boundary";
import { ModalProvider } from "@/components/modal-context";
import { useModal } from "@/components/modal-context";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { checkForAndroidAppUpdate } from "@/utils/app-update";
import { getLang, loadLang, subscribeLangChange, t } from "@/utils/i18n";
import { initSentry } from "@/utils/sentry";
import * as SystemUI from "expo-system-ui";
import React, { useEffect } from "react";
import { Linking, LogBox, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Suppress non-critical warnings that can mask real issues in dev
LogBox.ignoreLogs(["Require cycle:"]);

// Prevent the splash screen from auto-hiding before fonts load
SplashScreen.preventAutoHideAsync().catch(() => {});

// Initialise Sentry error tracking (no-op if DSN not set)
initSentry().catch(() => {});

// Global handler for unhandled promise rejections — prevents silent crash
const _origHandler = (globalThis as any).onunhandledrejection;
(globalThis as any).onunhandledrejection = (e: any) => {
  console.warn("[Unhandled Rejection]", e?.reason ?? e);
  _origHandler?.(e);
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialIcons.font,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
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
    <ErrorBoundary>
      <SafeAreaProvider>
        <AppStateProvider>
          <ModalProvider>
            <ThemedRoot />
          </ModalProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

function ThemedRoot() {
  const resolved = useColorScheme();
  const theme = resolved ?? "light";
  const [, setLangRevision] = React.useState(0);
  const hasCheckedForUpdatesRef = React.useRef(false);
  const { showAlert, showConfirm, showError } = useModal();

  useEffect(() => {
    let mounted = true;

    void loadLang().finally(() => {
      if (mounted) {
        setLangRevision((prev) => prev + 1);
      }
    });

    const unsubscribe = subscribeLangChange(() => {
      if (!mounted) return;
      setLangRevision((prev) => prev + 1);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      document.title = getLang() === "en" ? "Erdataye" : "እርዳታዬ";
    }
    if (Platform.OS !== "android") return;
    void SystemUI.setBackgroundColorAsync(Colors[theme].background);
  }, [theme]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (hasCheckedForUpdatesRef.current) return;
    hasCheckedForUpdatesRef.current = true;

    let cancelled = false;

    const openUpdate = async (apkUrl: string) => {
      try {
        await Linking.openURL(apkUrl);
      } catch {
        if (cancelled) return;
        showError(
          t("update_open_failed_title"),
          t("update_open_failed_message"),
        );
      }
    };

    const runUpdateCheck = async () => {
      const update = await checkForAndroidAppUpdate();
      if (cancelled || !update) return;

      const message =
        update.message ||
        t(
          "update_available_message",
          update.latestVersionLabel,
          update.currentVersionLabel,
        );

      if (update.forceUpdate) {
        showAlert(t("update_required_title"), message, () => {
          void openUpdate(update.apkUrl);
        });
        return;
      }

      showConfirm(
        t("update_available_title"),
        message,
        () => {
          void openUpdate(update.apkUrl);
        },
        undefined,
        {
          confirmText: t("update_now"),
          cancelText: t("later"),
        },
      );
    };

    void runUpdateCheck();

    return () => {
      cancelled = true;
    };
  }, [showAlert, showConfirm, showError]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors[theme].background }}>
      <ThemeProvider value={resolved === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen
            name="index"
            options={{ headerShown: false, title: "እርዳታዬ" }}
          />
          <Stack.Screen
            name="(tabs)"
            options={{ headerShown: false, title: "እርዳታዬ" }}
          />
          <Stack.Screen
            name="login"
            options={{ headerShown: false, title: "Login" }}
          />
          <Stack.Screen
            name="staff"
            options={{ headerShown: false, title: "Staff Login" }}
          />
          <Stack.Screen
            name="register"
            options={{ headerShown: false, title: "Register" }}
          />
          <Stack.Screen
            name="help"
            options={{ headerShown: false, title: "Help" }}
          />
          <Stack.Screen
            name="chatbot"
            options={{ headerShown: false, title: "Chatbot" }}
          />
          {/* Patient Routes */}
          <Stack.Screen
            name="patient-profile"
            options={{ headerShown: false, title: "Patient Profile" }}
          />
          <Stack.Screen
            name="patient-emergency"
            options={{ headerShown: false, title: "Emergency" }}
          />
          <Stack.Screen
            name="patient-emergency-tracking"
            options={{ headerShown: false, title: "Emergency Tracking" }}
          />
          <Stack.Screen
            name="first-aid-chat"
            options={{ headerShown: false, title: "First Aid Assistant" }}
          />
          {/* Ambulance Routes */}
          <Stack.Screen
            name="driver-home"
            options={{ headerShown: false, title: "Ambulance Home" }}
          />
          <Stack.Screen
            name="driver-emergency"
            options={{ headerShown: false, title: "Emergency Assignment" }}
          />
          <Stack.Screen
            name="driver-patient-info"
            options={{ headerShown: false, title: "Patient Information" }}
          />
          <Stack.Screen
            name="driver-emergency-tracking"
            options={{ headerShown: false, title: "Emergency Tracking" }}
          />
          {/* Admin Route */}
          <Stack.Screen
            name="admin"
            options={{ headerShown: false, title: "Admin Panel" }}
          />
          {/* Hospital & Map Routes */}
          <Stack.Screen
            name="hospital"
            options={{ headerShown: false, title: "Hospital Dashboard" }}
          />
          <Stack.Screen
            name="hospitals/[id]"
            options={{ headerShown: false, title: "Hospital Details" }}
          />
          <Stack.Screen
            name="map"
            options={{ headerShown: false, title: "Live Map" }}
          />
          <Stack.Screen
            name="emergency"
            options={{ headerShown: false, title: "Emergency" }}
          />
        </Stack>
        <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      </ThemeProvider>
    </View>
  );
}
