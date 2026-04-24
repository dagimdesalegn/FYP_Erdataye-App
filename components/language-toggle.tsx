import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useI18n } from "@/hooks/use-i18n";
import { type Lang } from "@/utils/i18n";

import { ThemedText } from "./themed-text";

const shortLabel: Record<Lang, string> = {
  en: "EN",
  am: "AM",
  om: "OM",
};

export function LanguageToggle() {
  const [open, setOpen] = useState(false);
  const { lang, setLanguage, t } = useI18n();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const insets = useSafeAreaInsets();

  const options = useMemo(
    () => [
      { value: "en" as const, label: t("lang_en") },
      { value: "am" as const, label: t("lang_am") },
      { value: "om" as const, label: t("lang_om") },
    ],
    [t],
  );

  const onSelect = async (next: Lang) => {
    await setLanguage(next);
    setOpen(false);
  };

  const menuTop = Math.max(insets.top, 12) + 60;

  return (
    <View style={styles.root}>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <MaterialIcons name="language" size={17} color={colors.text} />
        <ThemedText style={[styles.triggerText, { color: colors.text }]}>
          {shortLabel[lang]}
        </ThemedText>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={styles.backdropTapArea}
            onPress={() => setOpen(false)}
          />
          <View
            style={[
              styles.menu,
              {
                top: menuTop,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <ThemedText style={[styles.menuTitle, { color: colors.textMuted }]}>
              {t("language")}
            </ThemedText>
            {options.map((option) => {
              const active = option.value === lang;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    void onSelect(option.value);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    active && {
                      backgroundColor:
                        colorScheme === "dark" ? "#1F2937" : "#EEF2FF",
                      borderColor:
                        colorScheme === "dark" ? "#334155" : "#C7D2FE",
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <ThemedText
                    style={[styles.optionText, { color: colors.text }]}
                  >
                    {option.label}
                  </ThemedText>
                  {active ? (
                    <MaterialIcons
                      name="check"
                      size={17}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.12)",
  },
  backdropTapArea: {
    ...StyleSheet.absoluteFillObject,
  },
  trigger: {
    height: 42,
    minWidth: 70,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
  },
  triggerText: {
    fontSize: 12,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: 0.2,
  },
  menu: {
    position: "absolute",
    right: 16,
    width: 170,
    borderRadius: 14,
    borderWidth: 1,
    padding: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  menuTitle: {
    fontSize: 11,
    marginBottom: 6,
    marginLeft: 4,
    fontFamily: Fonts.sansBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  option: {
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "space-between",
    flexDirection: "row",
  },
  optionText: {
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
  },
});
