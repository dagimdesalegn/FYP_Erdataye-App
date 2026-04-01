import { useAppState } from "@/components/app-state";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

/**
 * Root index - shows the main app page directly.
 * The (tabs)/index.tsx handles both authenticated and unauthenticated states.
 */
export default function IndexScreen() {
  const router = useRouter();
  const { isLoading, user } = useAppState();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.title = "እርዳታዬ";
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    // Route to role-specific home screen if logged in
    const role = user?.role;
    if (role === "ambulance" || role === "driver") {
      router.replace("/driver-home" as any);
    } else if (role === "admin") {
      router.replace("/admin" as any);
    } else if (role === "hospital") {
      router.replace("/hospital" as any);
    } else {
      router.replace("/(tabs)");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: Colors[colorScheme].background,
      }}
    >
      <ActivityIndicator size="large" color="#DC2626" />
    </View>
  );
}
