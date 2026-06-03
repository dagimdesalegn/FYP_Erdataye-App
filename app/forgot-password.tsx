import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useRef, useState } from "react";
import {
    Animated,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    TextInput,
    View,
} from "react-native";

import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { confirmPasswordReset, requestPasswordReset } from "@/utils/auth";
import { t, translateText } from "@/utils/i18n";
import {
    hasInternetConnection,
    isLikelyConnectivityError,
} from "@/utils/network";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const insets = useSafeAreaInsets();
  const { showAlert, showError, showConfirm } = useModal();

  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [otp, setOtp] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fadeIn = useRef(new Animated.Value(1)).current;

  const validatePhone = (phone: string): boolean =>
    phone.length === 9 && phone.startsWith("9");

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

  const handleReset = async () => {
    const errors: Record<string, string> = {};

    if (!form.phone) {
      errors.phone = translateText("Please enter your phone number");
    } else if (!validatePhone(form.phone)) {
      errors.phone = translateText(
        "Enter 9 digits starting with 9 (e.g. 912345678)",
      );
    }

    if (otp) {
      if (!form.password) {
        errors.password = translateText("Please enter a new password");
      } else if (form.password.length < 6) {
        errors.password = translateText(
          "Password must be at least 6 characters",
        );
      }

      if (form.password !== form.confirmPassword) {
        errors.confirmPassword = translateText("Passwords do not match");
      }
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

    setLoading(true);
    try {
      if (!otp) {
        // Step 1: request a reset OTP
        const {
          success,
          otp: returnedOtp,
          error,
        } = await requestPasswordReset("+251" + form.phone);

        if (!success || error) {
          if (isLikelyConnectivityError(error)) {
            showAlert(
              t("internet_required_title"),
              t("internet_required_message"),
            );
            return;
          }
          showError(
            translateText("Request Failed"),
            error?.message || translateText("Failed to request password reset"),
          );
          return;
        }

        // For free/dev flow we display the OTP and let user copy it.
        setOtp(returnedOtp ?? null);
        const otpToShow = returnedOtp ?? "";
        showConfirm(
          translateText("Reset OTP"),
          otpToShow
            ? `Your OTP: ${otpToShow}`
            : translateText("An OTP was generated."),
          async () => {
            try {
              if (
                typeof window !== "undefined" &&
                (window as any).navigator?.clipboard
              ) {
                await (window as any).navigator.clipboard.writeText(otpToShow);
                showAlert(
                  translateText("Copied"),
                  translateText("OTP copied to clipboard."),
                );
              } else {
                showAlert(translateText("OTP"), otpToShow);
              }
            } catch {
              showAlert(translateText("OTP"), otpToShow);
            }
          },
          undefined,
        );
        return;
      }

      // Step 2: confirm using OTP
      const { success, error } = await confirmPasswordReset(
        "+251" + form.phone,
        otp,
        form.password,
      );

      if (!success || error) {
        if (isLikelyConnectivityError(error)) {
          showAlert(
            t("internet_required_title"),
            t("internet_required_message"),
          );
          return;
        }
        showError(
          translateText("Reset Failed"),
          error?.message || translateText("Failed to reset password"),
        );
        return;
      }

      showAlert(
        translateText("Password Reset Complete"),
        translateText(
          "Your password has been updated. Please sign in with your new password.",
        ),
        () => router.replace("/login"),
      );
    } catch (error) {
      showError(translateText("Reset Failed"), String(error));
    } finally {
      setLoading(false);
    }
  };

  const bg = colors.background;
  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const inputBg = colors.surfaceMuted;
  const inputBorder = colors.border;
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
              padding: 28,
              borderRadius: 24,
              minWidth: 340,
              maxWidth: 420,
              width: "100%",
              elevation: 4,
            },
          ]}
        >
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.cardBackBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.05)",
              },
              pressed && { opacity: 0.7, transform: [{ scale: 0.92 }] },
            ]}
          >
            <MaterialIcons name="arrow-back" size={20} color={textPrimary} />
          </Pressable>

          <ThemedText style={[styles.title, { color: textPrimary }]}>
            {translateText("Forgot Password")}
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
            {translateText("Enter your phone number and set a new password.")}
          </ThemedText>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <ThemedText style={[styles.label, { color: textPrimary }]}>
                {t("phone_number")}
              </ThemedText>
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: inputBg,
                    borderColor: fieldErrors.phone ? "#DC2626" : inputBorder,
                  },
                ]}
              >
                <MaterialIcons
                  name="phone"
                  size={18}
                  color={fieldErrors.phone ? "#DC2626" : textSecondary}
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
                  onChangeText={(value) => handleChange("phone", value)}
                  editable={!loading}
                />
              </View>
              {fieldErrors.phone ? (
                <ThemedText style={styles.fieldError}>
                  {fieldErrors.phone}
                </ThemedText>
              ) : null}
            </View>

            {/* Full name removed — OTP flow uses phone only */}

            {otp ? (
              <>
                <View style={styles.fieldGroup}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>
                    OTP
                  </ThemedText>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <MaterialIcons
                      name="vpn-key"
                      size={18}
                      color={textSecondary}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder={translateText("Enter OTP")}
                      placeholderTextColor={placeholderColor}
                      value={otp ?? ""}
                      onChangeText={(v) => setOtp(v)}
                      editable={!loading}
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>
                    {translateText("New Password")}
                  </ThemedText>
                  <View
                    style={[
                      styles.inputWrap,
                      {
                        backgroundColor: inputBg,
                        borderColor: fieldErrors.password
                          ? "#DC2626"
                          : inputBorder,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="lock-outline"
                      size={18}
                      color={fieldErrors.password ? "#DC2626" : textSecondary}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder={translateText("New password")}
                      placeholderTextColor={placeholderColor}
                      secureTextEntry
                      value={form.password}
                      onChangeText={(value) => handleChange("password", value)}
                      editable={!loading}
                    />
                  </View>
                  {fieldErrors.password ? (
                    <ThemedText style={styles.fieldError}>
                      {fieldErrors.password}
                    </ThemedText>
                  ) : null}
                </View>

                <View style={styles.fieldGroup}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>
                    {translateText("Confirm Password")}
                  </ThemedText>
                  <View
                    style={[
                      styles.inputWrap,
                      {
                        backgroundColor: inputBg,
                        borderColor: fieldErrors.confirmPassword
                          ? "#DC2626"
                          : inputBorder,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="lock"
                      size={18}
                      color={
                        fieldErrors.confirmPassword ? "#DC2626" : textSecondary
                      }
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder={translateText("Confirm new password")}
                      placeholderTextColor={placeholderColor}
                      secureTextEntry
                      value={form.confirmPassword}
                      onChangeText={(value) =>
                        handleChange("confirmPassword", value)
                      }
                      editable={!loading}
                    />
                  </View>
                  {fieldErrors.confirmPassword ? (
                    <ThemedText style={styles.fieldError}>
                      {fieldErrors.confirmPassword}
                    </ThemedText>
                  ) : null}
                </View>
              </>
            ) : (
              <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
                {translateText(
                  "We'll generate an OTP and show it to you for development/testing.",
                )}
              </ThemedText>
            )}

            <Pressable
              onPress={handleReset}
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
                    {t("loading")}
                  </ThemedText>
                ) : (
                  <>
                    <MaterialIcons name="password" size={20} color="#fff" />
                    <ThemedText style={styles.primaryBtnText}>
                      {translateText("Reset Password")}
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
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  card: { width: "100%" },
  cardBackBtn: {
    alignSelf: "flex-start",
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  title: { fontSize: 28, fontFamily: Fonts.sansBlack, marginBottom: 8 },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
    marginBottom: 20,
    lineHeight: 20,
  },
  form: { gap: 14 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: Fonts.sansSemiBold },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 8 },
  phonePrefix: { fontSize: 15, fontFamily: Fonts.sansSemiBold, marginRight: 6 },
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
  primaryBtn: { marginTop: 6, borderRadius: 14, overflow: "hidden" },
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
