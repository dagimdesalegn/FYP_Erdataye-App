import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
    Animated,
    Image,
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

const ambulanceFavicon = require("../assets/images/ambulance-favicon.png");

export default function StaffLoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const { setUser, setRegistered } = useAppState();
  const { showError } = useModal();

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
      errors.phone = "Please enter your phone number";
    } else if (!validatePhone(form.phone)) {
      errors.phone = "Enter 9 digits starting with 9 (e.g. 912345678)";
    }
    if (!form.password) {
      errors.password = "Please enter your password";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const { user, error } = await signIn("+251" + form.phone, form.password);
      if (error || !user) {
        setLoading(false);
        showError("Login Failed", error?.message || "Failed to sign in");
        return;
      }

      if (user.role !== "admin" && user.role !== "hospital") {
        await signOut();
        setUser(null);
        setRegistered(false);
        setLoading(false);
        showError(
          "Access Denied",
          "This portal is only for admin and hospital accounts.",
        );
        return;
      }

      setUser(user);
      setRegistered(true);
      setLoading(false);
      router.replace(user.role === "admin" ? "/admin" : "/hospital");
    } catch (err) {
      setLoading(false);
      showError("Login Failed", `Login failed: ${String(err)}`);
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
        { backgroundColor: bg },
        Platform.OS === "web" && { minHeight: "100vh" as any },
      ]}
    >
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        translucent
        backgroundColor="transparent"
      />
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
          <View style={styles.headerArea}>
            <View style={styles.logoContainer}>
              <Image
                source={ambulanceFavicon}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.roleRow}>
              <View style={[styles.roleChip, { backgroundColor: "#FCE7F3" }]}>
                <ThemedText style={[styles.roleChipText, { color: "#BE185D" }]}>
                  ADMIN
                </ThemedText>
              </View>
              <View style={[styles.roleChip, { backgroundColor: "#D1FAE5" }]}>
                <ThemedText style={[styles.roleChipText, { color: "#059669" }]}>
                  HOSPITAL
                </ThemedText>
              </View>
            </View>
          </View>

          <ThemedText style={[styles.title, { color: textPrimary }]}>
            Staff Portal Login
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
            Sign in with admin or hospital credentials.
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
                  placeholder="Enter your password"
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
                    Signing In...
                  </ThemedText>
                ) : (
                  <>
                    <MaterialIcons name="login" size={20} color="#fff" />
                    <ThemedText style={styles.primaryBtnText}>
                      Sign In
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
  headerArea: { alignItems: "center", marginBottom: 24, gap: 12 },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    elevation: 4,
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.12)",
  },
  logoImage: { width: 60, height: 60 },
  roleRow: { flexDirection: "row", gap: 8 },
  roleChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleChipText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    fontFamily: Fonts.sans,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    letterSpacing: -0.5,
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    fontWeight: "500",
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  form: { gap: 16 },
  fieldGroup: { gap: 6 },
  label: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
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
    fontWeight: "600",
    fontFamily: Fonts.sans,
    marginRight: 6,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.sans,
    fontWeight: "500",
    height: "100%",
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  fieldError: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: "600",
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
    fontWeight: "700",
    fontFamily: Fonts.sans,
    letterSpacing: 0.3,
  },
});
