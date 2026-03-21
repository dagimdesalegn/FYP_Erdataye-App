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
    backgroundColor: "rgba(2,6,23,0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  backdropTapArea: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 12,
  },
  glowOrb: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -88,
    right: -44,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    marginTop: 2,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: Platform.OS === "ios" ? 0.2 : 0,
  },
  message: {
    fontSize: 14,
    lineHeight: 24,
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 24,
  },
  btn: {
    minWidth: 120,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  cancel: {
    borderWidth: 1,
  },
  confirm: {
    backgroundColor: "#2563EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  cancelText: {
    fontWeight: "700",
    fontSize: 15,
  },
  confirmText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 16,
  },
});
