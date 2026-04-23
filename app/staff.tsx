import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
    Animated,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    TextInput,
    View,
} from "react-native";

import { useAppState } from "@/components/app-state";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { signIn, signOut } from "@/utils/auth";
import { t, translateText } from "@/utils/i18n";
import { hasInternetConnection, isLikelyConnectivityError } from "@/utils/network";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function StaffLoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const insets = useSafeAreaInsets();
  const { setUser, setRegistered } = useAppState();
  const { showError, showAlert } = useModal();

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ phone: "", password: "" });

  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;
  const passwordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeIn, slideUp]);

  const handleChange = (key: string, value: string) => {
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }

    if (key === "phone") {
      let cleaned = value.replace(/[^0-9]/g, "");
      if (cleaned.startsWith("251") && cleaned.length > 9)
        cleaned = cleaned.substring(3);
      if (cleaned.startsWith("0")) cleaned = cleaned.substring(1);
      if (cleaned.length > 9) cleaned = cleaned.substring(0, 9);
      setForm({ ...form, [key]: cleaned });
      return;
    }

    setForm({ ...form, [key]: value });
  };

  const validatePhone = (phone: string): boolean => {
    return phone.length === 9 && phone.startsWith("9");
  };

  const handleLogin = async () => {
    const errors: Record<string, string> = {};
    if (!form.phone) {
      errors.phone = translateText("Please enter your phone number");
    } else if (!validatePhone(form.phone)) {
      errors.phone = translateText("Enter 9 digits starting with 9 (e.g. 912345678)");
    }
    if (!form.password) {
      errors.password = translateText("Please enter your password");
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const online = await hasInternetConnection();
    if (!online) {
      showAlert(t("internet_required_title"), t("internet_required_message"));
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const { user, error } = await signIn("+251" + form.phone, form.password);
      if (error || !user) {
        setLoading(false);
        if (isLikelyConnectivityError(error)) {
          showAlert(t("internet_required_title"), t("internet_required_message"));
          return;
        }
        showError(translateText("Login Failed"), error?.message || translateText("Failed to sign in"));
        return;
      }

      if (user.role !== "admin" && user.role !== "hospital") {
        await signOut();
        setUser(null);
        setRegistered(false);
        setLoading(false);
        showError(
          translateText("Access Denied"),
          translateText("This portal is only for admin and hospital accounts."),
        );
        return;
      }

      setUser(user);
      setRegistered(true);
      setLoading(false);
      router.replace(user.role === "admin" ? "/admin" : "/hospital");
    } catch (err) {
      setLoading(false);
      if (isLikelyConnectivityError(err)) {
        showAlert(t("internet_required_title"), t("internet_required_message"));
        return;
      }
      showError(translateText("Login Failed"), `${translateText("Login failed")}: ${String(err)}`);
    }
  };

  const bg = colors.background;
  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const inputBg = colors.surfaceMuted;
  const inputBorder = colors.border;
  const inputFocusBorder = colors.primary;
  const textPrimary = colors.text;
  const textSecondary = colors.textMuted;
  const placeholderColor = isDark ? "#64748B" : "#94A3B8";

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
        Platform.OS === "web" && { minHeight: "100vh" as any },
      ]}
    >
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        translucent
        backgroundColor="transparent"
      />
      {/* Back button */}
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
      >
        <MaterialIcons name="arrow-back" size={24} color={textPrimary} />
      </Pressable>
      <LinearGradient
        colors={[colors.primary, "#EF4444", bg]}
        style={styles.topGradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
      />

      <View
        style={[
          styles.flex,
          Platform.OS === "web" && { minHeight: "100vh" as any },
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: cardBorder,
              opacity: fadeIn,
              transform: [{ translateY: slideUp }],
            },
          ]}
        >
          <ThemedText style={[styles.title, { color: textPrimary }]}>
            {translateText("Sign In")}
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
            {translateText("Enter your credentials to continue")}
          </ThemedText>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <ThemedText style={[styles.label, { color: textPrimary }]}>
                Phone Number
              </ThemedText>
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: inputBg,
                    borderColor: fieldErrors.phone
                      ? "#DC2626"
                      : focusedField === "phone"
                        ? inputFocusBorder
                        : inputBorder,
                  },
                ]}
              >
                <MaterialIcons
                  name="phone"
                  size={18}
                  color={
                    fieldErrors.phone
                      ? "#DC2626"
                      : focusedField === "phone"
                        ? "#DC2626"
                        : textSecondary
                  }
                  style={styles.inputIcon}
                />
                <ThemedText
                  style={[styles.phonePrefix, { color: textPrimary }]}
                >
                  +251
                </ThemedText>
                <TextInput
                  style={[styles.input, { color: textPrimary }]}
                  placeholder="912345678"
                  placeholderTextColor={placeholderColor}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  maxLength={9}
                  value={form.phone}
                  onChangeText={(t) => handleChange("phone", t)}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  onFocus={() => setFocusedField("phone")}
                  onBlur={() => setFocusedField(null)}
                  editable={!loading}
                />
              </View>
              {fieldErrors.phone ? (
                <ThemedText style={styles.fieldError}>
                  {fieldErrors.phone}
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText style={[styles.label, { color: textPrimary }]}>
                Password
              </ThemedText>
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: inputBg,
                    borderColor: fieldErrors.password
                      ? "#DC2626"
                      : focusedField === "password"
                        ? inputFocusBorder
                        : inputBorder,
                  },
                ]}
              >
                <MaterialIcons
                  name="lock-outline"
                  size={18}
                  color={
                    fieldErrors.password
                      ? "#DC2626"
                      : focusedField === "password"
                        ? "#DC2626"
                        : textSecondary
                  }
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={passwordInputRef}
                  style={[styles.input, { color: textPrimary }]}
                  placeholder={translateText("Enter your password")}
                  placeholderTextColor={placeholderColor}
                  secureTextEntry={!showPassword}
                  value={form.password}
                  onChangeText={(t) => handleChange("password", t)}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  blurOnSubmit
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  editable={!loading}
                />
                <Pressable
                  onPress={() => setShowPassword((p) => !p)}
                  hitSlop={8}
                >
                  <MaterialIcons
                    name={showPassword ? "visibility" : "visibility-off"}
                    size={20}
                    color={textSecondary}
                  />
                </Pressable>
              </View>
              {fieldErrors.password ? (
                <ThemedText style={styles.fieldError}>
                  {fieldErrors.password}
                </ThemedText>
              ) : null}
            </View>

            <Pressable
              onPress={handleLogin}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.92, transform: [{ scale: 0.98 }] },
                loading && { opacity: 0.7 },
              ]}
            >
              <LinearGradient
                colors={["#DC2626", "#B91C1C"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtnGradient}
              >
                {loading ? (
                  <ThemedText style={styles.primaryBtnText}>
                    {translateText("Signing In...")}
                  </ThemedText>
                ) : (
                  <>
                    <MaterialIcons name="login" size={20} color="#fff" />
                    <ThemedText style={styles.primaryBtnText}>
                      {translateText("Sign In")}
                    </ThemedText>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    ...(Platform.OS === "web"
      ? { minHeight: "100vh" as any, overflow: "auto" as any }
      : {}),
  },
  backBtn: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 10,
    padding: 8,
    borderRadius: 20,
  },
  flex: {
    flex: 1,
    ...(Platform.OS === "web" ? { minHeight: "100vh" as any } : {}),
  },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 300,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 32,
    elevation: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: Fonts.sansExtraBold,
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  form: { gap: 16 },
  fieldGroup: { gap: 6 },
  label: {
    fontSize: 13,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.2,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  phonePrefix: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
    marginRight: 6,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.sansMedium,
    height: "100%",
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  fieldError: {
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    color: "#DC2626",
    marginTop: 2,
    marginLeft: 2,
  },
  primaryBtn: { marginTop: 4, borderRadius: 14, overflow: "hidden" },
  primaryBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 14,
    gap: 8,
    elevation: 3,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: Fonts.sansBold,
    letterSpacing: 0.3,
  },
});
