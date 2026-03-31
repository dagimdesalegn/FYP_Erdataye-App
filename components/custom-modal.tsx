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
            style={[
              styles.glowOrb,
              { backgroundColor: `${autoIconColor}1F` },
            ]}
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
                  size={20}
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
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 2,
  },
  glowOrb: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    top: -38,
    right: -20,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
    marginTop: 2,
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: Platform.OS === "ios" ? 0.2 : 0,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 14,
  },
  btn: {
    minWidth: 80,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancel: {
    borderWidth: 1,
  },
  confirm: {
    backgroundColor: "#2563EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  cancelText: {
    fontWeight: "600",
    fontSize: 13,
  },
  confirmText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
});
