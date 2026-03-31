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
  const scaleAnim = React.useRef(new Animated.Value(0.96)).current;
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.96);
    };
  }, [visible, fadeAnim, scaleAnim]);

  const normalizedTitle = (title ?? "").toLowerCase();
  const autoIcon: keyof typeof MaterialIcons.glyphMap = icon
    ? icon
    : type === "confirm"
      ? "help-outline"
      : normalizedTitle.includes("error") || normalizedTitle.includes("failed")
        ? "error-outline"
        : normalizedTitle.includes("success") ||
            normalizedTitle.includes("done")
          ? "check-circle-outline"
          : "info-outline";

  const autoIconColor =
    iconColor ??
    (normalizedTitle.includes("error") || normalizedTitle.includes("failed")
      ? "#DC2626"
      : normalizedTitle.includes("success") || normalizedTitle.includes("done")
        ? "#059669"
        : colors.primary);

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
              backgroundColor: colors.surface,
              borderColor: colors.border,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <View
            style={[styles.accentBar, { backgroundColor: autoIconColor }]}
          />
          <View
            style={[styles.glowOrb, { backgroundColor: `${autoIconColor}1F` }]}
          />
          <View style={styles.headerRow}>
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: `${autoIconColor}1A` },
              ]}
            >
              {type === "loading" ? (
                <ActivityIndicator color={autoIconColor} size="small" />
              ) : (
                <MaterialIcons
                  name={autoIcon}
                  size={22}
                  color={autoIconColor}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              {title ? (
                <ThemedText
                  style={styles.title}
                  lightColor="#0F172A"
                  darkColor="#F8FAFC"
                >
                  {title}
                </ThemedText>
              ) : null}
            </View>
          </View>
          <ThemedText
            style={[styles.message, { color: colors.textMuted }]}
            lightColor="#334155"
            darkColor="#CBD5E1"
          >
            {message}
          </ThemedText>

          {type !== "loading" ? (
            <View style={styles.actions}>
              {type === "confirm" ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.btn,
                    styles.cancel,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surfaceAlt,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  onPress={onCancel}
                >
                  <ThemedText
                    style={styles.cancelText}
                    lightColor="#0F172A"
                    darkColor="#F8FAFC"
                  >
                    {cancelText}
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.btn,
                  styles.confirm,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.9 : 1,
                  },
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
    backgroundColor: "rgba(2,6,23,0.38)",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  backdropTapArea: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  glowOrb: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    top: -44,
    right: -24,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    marginTop: 4,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: Platform.OS === "ios" ? 0.2 : 0,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  btn: {
    minWidth: 90,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancel: {
    borderWidth: 1,
  },
  confirm: {
    backgroundColor: "#2563EB",
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  cancelText: {
    fontWeight: "600",
    fontSize: 14,
  },
  confirmText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
