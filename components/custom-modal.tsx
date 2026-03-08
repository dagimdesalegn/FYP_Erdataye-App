/**
 * CustomModal — Beautiful, app-themed replacement for Alert.alert and window.alert/confirm
 * Provides consistent, attractive modals throughout the app
 */
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useEffect, useRef } from "react";
import {
    Animated,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
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
}: CustomModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];

  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
    }
  }, [visible, scaleAnim, fadeAnim]);

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
  };

  // Auto-detect icon and color based on title or type
  const defaultIcon =
    icon ||
    (title?.toLowerCase().includes("error")
      ? "error"
      : title?.toLowerCase().includes("success")
        ? "check-circle"
        : title?.toLowerCase().includes("warning")
          ? "warning"
          : type === "confirm"
            ? "help"
            : "info");

  const defaultIconColor =
    iconColor ||
    (title?.toLowerCase().includes("error")
      ? "#DC2626"
      : title?.toLowerCase().includes("success")
        ? "#059669"
        : title?.toLowerCase().includes("warning")
          ? "#F59E0B"
          : colors.primary);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={type === "alert" ? handleConfirm : handleCancel}
    >
      <Animated.View
        style={[
          styles.overlay,
          {
            backgroundColor: isDark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.5)",
            opacity: fadeAnim,
          },
        ]}
      >
        <Pressable
          style={styles.overlayTouchable}
          onPress={type === "alert" ? handleConfirm : handleCancel}
        />
        <Animated.View
          style={[
            styles.modalContainer,
            {
              backgroundColor: isDark ? "#1E293B" : "#FFFFFF",
              borderColor: isDark ? "#334155" : "#E2E8F0",
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Icon */}
          {type !== "loading" && (
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" },
              ]}
            >
              <MaterialIcons
                name={defaultIcon}
                size={48}
                color={defaultIconColor}
              />
            </View>
          )}

          {/* Title */}
          {title && (
            <ThemedText
              style={[styles.title, { color: isDark ? "#F1F5F9" : "#0F172A" }]}
            >
              {title}
            </ThemedText>
          )}

          {/* Message */}
          <ThemedText
            style={[styles.message, { color: isDark ? "#CBD5E1" : "#475569" }]}
          >
            {message}
          </ThemedText>

          {/* Buttons */}
          {type !== "loading" && (
            <View style={styles.buttonContainer}>
              {type === "confirm" && (
                <Pressable
                  onPress={handleCancel}
                  style={({ pressed }) => [
                    styles.button,
                    styles.cancelButton,
                    {
                      backgroundColor: isDark ? "#334155" : "#F1F5F9",
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.buttonText,
                      { color: isDark ? "#E2E8F0" : "#475569" },
                    ]}
                  >
                    {cancelText}
                  </ThemedText>
                </Pressable>
              )}
              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [
                  styles.button,
                  styles.confirmButton,
                  {
                    backgroundColor: defaultIconColor,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <ThemedText style={styles.confirmButtonText}>
                  {confirmText}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Loading spinner */}
          {type === "loading" && (
            <View style={styles.loadingContainer}>
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: fadeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0deg", "360deg"],
                      }),
                    },
                  ],
                }}
              >
                <MaterialIcons
                  name="refresh"
                  size={32}
                  color={colors.primary}
                />
              </Animated.View>
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  overlayTouchable: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: {
        elevation: 12,
      },
      web: {
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      },
    }),
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {},
  confirmButton: {},
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  loadingContainer: {
    paddingVertical: 20,
    alignItems: "center",
  },
});
