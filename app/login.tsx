import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
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

import faydaLogo from "@/assets/images/fayda-logo.webp";
import { useAppState } from "@/components/app-state";
import { LoadingModal } from "@/components/loading-modal";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { signIn } from "@/utils/auth";
import { useRouter } from "expo-router";
const ambulanceFavicon = require("../assets/images/ambulance-favicon.png");

const CARD_MAX_W = 440;

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const { setUser, setRegistered } = useAppState();
  const { showError, showAlert } = useModal();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ phone: "", password: "" });

  // Entrance animation
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (key: string, value: string) => {
    // Clear error for this field when user types
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    // For phone field – digits only, max 9 digits (after +251)
    if (key === "phone") {
      let cleaned = value.replace(/[^0-9]/g, "");
      // Strip leading 0 or 251 if user pastes full number
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
    // phone here is 9 digits after +251 prefix (e.g. "912345678")
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
      if (user.role === "admin" || user.role === "hospital") {
        await (await import("@/utils/auth")).signOut();
        setUser(null);
        setRegistered(false);
        setLoading(false);
        showAlert(
          "Staff Portal Required",
          "Admin and hospital accounts must log in through the Staff Portal at /staff.",
        );
        return;
      }
      setUser(user);
      setRegistered(true);
      let route: any;
      switch (user.role) {
        case "ambulance":
        case "driver":
          route = "/driver-home";
          break;
        default:
          route = "/help";
          break;
      }
      setLoading(false);
      router.replace(route);
    } catch (err) {
      setLoading(false);
      showError("Login Failed", `Login failed: ${String(err)}`);
    }
  };

  /* ---- colours ---- */
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
      <LoadingModal
        visible={loading}
        colorScheme={colorScheme}
        message="Signing in..."
      />

      {/* Top accent gradient */}
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
        {/* Card */}
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: cardBorder,
              opacity: fadeIn,
              transform: [{ translateY: slideUp }],
              padding: 28,
              borderRadius: 24,
              minWidth: 340,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 4px 24px #0001",
            },
          ]}
        >
          {/* Logo / Header area */}
          <View style={styles.headerArea}>
            <View style={styles.logoContainer}>
              <Image
                source={ambulanceFavicon}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* Title */}
          <ThemedText style={[styles.title, { color: textPrimary }]}>
            Welcome Back
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
            Sign in to access emergency services
          </ThemedText>

          {/* Form */}
          <View style={styles.form}>
            {/* Phone Number */}
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

            {/* Password */}
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

          {/* OR divider + Continue with Fayda */}
          <View style={{ marginVertical: 14, alignItems: "center" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 12,
                width: "100%",
              }}
            >
              <View
                style={{ flex: 1, height: 1, backgroundColor: cardBorder }}
              />
              <ThemedText
                style={{
                  marginHorizontal: 12,
                  fontWeight: "700",
                  fontSize: 12,
                  color: textSecondary,
                }}
              >
                OR
              </ThemedText>
              <View
                style={{ flex: 1, height: 1, backgroundColor: cardBorder }}
              />
            </View>
            <Pressable
              onPress={() =>
                showAlert(
                  "Coming Soon",
                  "Fayda (National ID) sign-in will be available soon. Please sign in manually for now.",
                )
              }
              disabled={loading}
              style={({ pressed }) => [
                {
                  backgroundColor: "#1A4D8F",
                  borderRadius: 14,
                  paddingVertical: 13,
                  paddingHorizontal: 22,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Image
                source={faydaLogo}
                style={{
                  width: 26,
                  height: 26,
                  marginRight: 10,
                  borderRadius: 4,
                }}
                resizeMode="contain"
              />
              <ThemedText
                style={{
                  color: "#fff",
                  fontWeight: "800",
                  fontSize: 15,
                  letterSpacing: 0.2,
                }}
              >
                Continue with Fayda
              </ThemedText>
            </Pressable>
          </View>

          {/* Create Account */}
          <Pressable
            onPress={() => !loading && router.push("/register")}
            disabled={loading}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: isDark ? "#1E293B" : "#E2E8F0",
                backgroundColor: isDark ? "#0F172A" : "#F8FAFC",
              },
              pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            <MaterialIcons name="person-add" size={20} color="#DC2626" />
            <ThemedText
              style={[styles.secondaryBtnText, { color: textPrimary }]}
            >
              Create Account
            </ThemedText>
          </Pressable>
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
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  /* ---- Card ---- */
  card: {
    width: "100%",
    maxWidth: CARD_MAX_W,
    alignSelf: "center",
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 32,
    boxShadow: "0px 16px 32px rgba(0, 0, 0, 0.10)",
  },
  /* ---- Header ---- */
  headerArea: { alignItems: "center", marginBottom: 24 },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    boxShadow: "0px 8px 16px rgba(220, 38, 38, 0.25)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.12)",
  },
  logoImage: {
    width: 60,
    height: 60,
  },
  /* ---- Title / Subtitle ---- */
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
  /* ---- Form ---- */
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
  /* ---- Primary button ---- */
  primaryBtn: { marginTop: 4, borderRadius: 14, overflow: "hidden" },
  primaryBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 14,
    gap: 8,
    boxShadow: "0px 4px 12px rgba(220, 38, 38, 0.30)",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    letterSpacing: 0.3,
  },
  /* ---- Divider ---- */
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 14,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: "600", fontFamily: Fonts.sans },
  /* ---- Secondary button ---- */
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 8,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    letterSpacing: 0.2,
  },
});
