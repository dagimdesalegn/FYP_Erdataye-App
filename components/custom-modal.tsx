import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React from "react";
import {
    ActivityIndicator,
    Animated,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";

import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ThemedText } from "./themed-text";

export type ModalType = "alert" | "confirm" | "loading";

export interface CustomModalProps {
  visible: boolean;
  type?: ModalType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  icon?: keyof typeof MaterialIcons.glyphMap;
  iconColor?: string;
  dismissOnBackdrop?: boolean;
}

export function CustomModal({
  visible,
  type = "alert",
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  icon,
  iconColor,
  dismissOnBackdrop = false,
}: CustomModalProps) {
  const scheme = useColorScheme();
  const theme = scheme ?? "light";
  const colors = Colors[theme];
  const isDark = theme === "dark";
  const scaleAnim = React.useRef(new Animated.Value(0.85)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.85);
    };
  }, [visible, fadeAnim, scaleAnim]);

  const normalizedTitle = (title ?? "").toLowerCase();
  const isError =
    normalizedTitle.includes("error") ||
    normalizedTitle.includes("failed") ||
    normalizedTitle.includes("decline");
  const isSuccess =
    normalizedTitle.includes("success") || normalizedTitle.includes("done");
  const isWarning =
    normalizedTitle.includes("warning") ||
    normalizedTitle.includes("cancel") ||
    type === "confirm";

  const autoIcon: keyof typeof MaterialIcons.glyphMap = icon
    ? icon
    : isError
      ? "error-outline"
      : isSuccess
        ? "check-circle"
        : isWarning
          ? "warning-amber"
          : "info";

  const accentColor =
    iconColor ??
    (isError
      ? "#EF4444"
      : isSuccess
        ? "#10B981"
        : isWarning
          ? "#F59E0B"
          : "#3B82F6");

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={onCancel ?? onConfirm}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Pressable
          style={styles.backdropTapArea}
          onPress={dismissOnBackdrop ? (onCancel ?? onConfirm) : undefined}
        />
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: isDark ? "#1E293B" : "#FFFFFF",
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Top accent gradient bar */}
          <View
            style={[
              styles.accentBar,
              {
                backgroundColor: accentColor,
                shadowColor: accentColor,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.5,
                shadowRadius: 8,
              },
            ]}
          />

          {/* Icon circle */}
          <View style={styles.iconContainer}>
            <View
              style={[
                styles.iconOuter,
                { backgroundColor: `${accentColor}15` },
              ]}
            >
              <View
                style={[
                  styles.iconInner,
                  { backgroundColor: `${accentColor}25` },
                ]}
              >
                {type === "loading" ? (
                  <ActivityIndicator color={accentColor} size={28} />
                ) : (
                  <MaterialIcons
                    name={autoIcon}
                    size={28}
                    color={accentColor}
                  />
                )}
              </View>
            </View>
          </View>

          {/* Title */}
          {title ? (
            <ThemedText
              style={[
                styles.title,
                { color: isDark ? "#F1F5F9" : "#0F172A" },
              ]}
            >
              {title}
            </ThemedText>
          ) : null}

          {/* Message */}
          <ThemedText
            style={[
              styles.message,
              { color: isDark ? "#94A3B8" : "#64748B" },
            ]}
          >
            {message}
          </ThemedText>

          {/* Divider */}
          {type !== "loading" && (
            <View
              style={[
                styles.divider,
                { backgroundColor: isDark ? "#334155" : "#E2E8F0" },
              ]}
            />
          )}

          {/* Actions */}
          {type !== "loading" ? (
            <View style={styles.actions}>
              {type === "confirm" ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.btn,
                    styles.cancelBtn,
                    {
                      backgroundColor: isDark ? "#334155" : "#F1F5F9",
                      borderColor: isDark ? "#475569" : "#E2E8F0",
                    },
                    pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
                  ]}
                  onPress={onCancel}
                >
                  <ThemedText
                    style={[
                      styles.cancelText,
                      { color: isDark ? "#CBD5E1" : "#475569" },
                    ]}
                  >
                    {cancelText}
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.confirmBtn,
                  {
                    backgroundColor: accentColor,
                    shadowColor: accentColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.35,
                    shadowRadius: 8,
                    elevation: 4,
                  },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
                ]}
                onPress={onConfirm}
              >
                <ThemedText style={styles.confirmText}>
                  {confirmText}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backdropTapArea: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  accentBar: {
    height: 4,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginBottom: 20,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  iconOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  iconInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: Platform.OS === "ios" ? 0.3 : 0,
  },
  message: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  divider: {
    height: 1,
    marginTop: 16,
    marginBottom: 16,
    marginHorizontal: -24,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    borderWidth: 1,
  },
  confirmBtn: {},
  cancelText: {
    fontWeight: "600",
    fontSize: 14,
    letterSpacing: 0.2,
  },
  confirmText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
