import { useAppState } from "@/components/app-state";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { type Href, useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "./themed-text";

type HeaderAction = {
  label: string;
  href: Href;
  variant?: "primary" | "ghost";
};

export function AppHeader({
  title,
  actions,
  announcementHref,
  onProfilePress,
  onBackPress,
}: {
  title: string;
  actions?: HeaderAction[];
  announcementHref?: Href;
  onProfilePress?: () => void;
  onBackPress?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { themeMode, toggleThemeMode } = useAppState();
  const router = useRouter();

  const colors = Colors[colorScheme ?? "light"];

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 12),
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.left}>
          {onBackPress ? (
            <Pressable
              onPress={onBackPress}
              style={({ pressed }) => [
                { padding: 4, marginRight: 4 },
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <MaterialIcons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={styles.brandMark}>
            <MaterialIcons
              name="local-hospital"
              size={20}
              color={colors.primary}
            />
          </View>
          <ThemedText
            style={[
              styles.title,
              {
                color: colors.text,
                fontFamily: Fonts.rounded,
              },
            ]}
            numberOfLines={1}
          >
            {title}
          </ThemedText>
        </View>

        <View style={styles.right}>
          {announcementHref ? (
            <Pressable
              onPress={() => router.push(announcementHref)}
              style={({ pressed }) => [
                styles.toggleBase,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                },
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <MaterialIcons name="campaign" size={20} color={colors.text} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={toggleThemeMode}
            style={({ pressed }) => [
              styles.toggleBase,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <MaterialIcons
              name={
                themeMode === "dark"
                  ? "dark-mode"
                  : themeMode === "light"
                    ? "light-mode"
                    : "brightness-auto"
              }
              size={20}
              color={colors.text}
            />
          </Pressable>
          {(actions ?? []).map((a) => (
            <Pressable
              key={a.label}
              onPress={() => router.push(a.href)}
              style={({ pressed }) => [
                styles.actionBase,
                a.variant === "primary"
                  ? {
                      backgroundColor: colors.primary,
                      borderColor: "transparent",
                    }
                  : {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                    },
                a.variant === "primary"
                  ? {
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 10 },
                      shadowOpacity: 0.16,
                      shadowRadius: 18,
                      elevation: 6,
                    }
                  : null,
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <ThemedText
                style={[
                  styles.actionText,
                  a.variant === "primary"
                    ? { color: "#fff" }
                    : { color: colors.text },
                ]}
              >
                {a.label}
              </ThemedText>
            </Pressable>
          ))}
          {onProfilePress ? (
            <Pressable
              onPress={onProfilePress}
              style={({ pressed }) => [
                styles.toggleBase,
                {
                  backgroundColor:
                    colorScheme === "dark"
                      ? "rgba(239,68,68,0.18)"
                      : "rgba(220,38,38,0.10)",
                  borderColor: colors.border,
                  borderRadius: 20,
                },
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <MaterialIcons name="person" size={20} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(220,38,38,0.12)",
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.18)",
  },
  title: {
    fontSize: 20,
    fontWeight: Platform.select({ ios: "700", default: "800" }),
    letterSpacing: 0.2,
    fontFamily: Fonts.sans,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toggleBase: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBase: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
    fontFamily: Fonts.sans,
  },
});
