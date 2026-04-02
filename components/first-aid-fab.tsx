import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
    Pressable,
    StyleProp,
    StyleSheet,
    Text,
    ViewStyle,
} from "react-native";

type FirstAidFabProps = {
  triggerMode?: "fab" | "tag";
  triggerLabel?: string;
  anchorStyle?: StyleProp<ViewStyle>;
};

export function FirstAidFab({
  triggerMode = "fab",
  triggerLabel = "Ask Chatbot",
  anchorStyle,
}: FirstAidFabProps) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push("/chatbot")}
      style={({ pressed }) => [
        styles.base,
        triggerMode === "tag" ? styles.tag : styles.fab,
        anchorStyle,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={triggerLabel}
    >
      <Text style={triggerMode === "tag" ? styles.tagText : styles.fabEmoji}>
        {triggerMode === "tag" ? triggerLabel : "🚑"}
      </Text>
    </Pressable>
  );
}

export default FirstAidFab;

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.85,
  },
  fab: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    ...(Platform.select({
      web: { boxShadow: "0px 6px 14px rgba(0,0,0,0.16)" as any },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
      },
    }) as object),
    elevation: 8,
  },
  tag: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#374151",
  },
  tagText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  fabEmoji: {
    fontSize: 34,
    lineHeight: 38,
  },
});
