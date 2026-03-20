import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
    Animated,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";

import ambulanceFavicon from "@/assets/images/ambulance-favicon.png";
import { useAppState } from "@/components/app-state";
import { LoadingModal } from "@/components/loading-modal";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { signUp } from "@/utils/auth";
import { upsertDriverAmbulance } from "@/utils/driver";
import { upsertMedicalProfile } from "@/utils/profile";
import { useRouter } from "expo-router";

const CARD_MAX_W = 420;
type AppRegistrationRole = "patient" | "ambulance";

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = Colors[colorScheme ?? "light"];
  const { setRegistered, setUser } = useAppState();
  const { showError, showAlert } = useModal();
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<AppRegistrationRole>("patient");
  const { width: windowWidth } = useWindowDimensions();
  const isSmallScreen = windowWidth < 480;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const [form, setForm] = useState({
    phone: "",
    password: "",
    fullName: "",
    bloodType: "",
    contact: "",
    allergies: "",
    plateNumber: "",
    registrationNumber: "",
    ambulanceType: "standard" as "standard" | "advanced" | "icu",
  });

  const validatePhone = (phone: string): boolean => {
    // phone is 9 digits after +251 (e.g. "912345678")
    return phone.length === 9 && phone.startsWith("9");
  };

  const formatPhoneForDB = (phone: string): string => {
    // Store as Ethiopian format: 0912345678
    const digits = phone.replace(/[^0-9]/g, "");
    return "0" + digits;
  };

  const handleChange = (key: string, value: string) => {
    // Clear error for this field when user types
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    // Phone fields: digits only, max 9 digits, strip leading 0 or 251
    if (key === "phone" || key === "contact") {
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

  const handleSubmit = async () => {
    console.log("handleSubmit called");

    const errors: Record<string, string> = {};

    // Full Name validation (must be at least two words)
    const nameParts = form.fullName.trim().split(/\s+/);
    if (!form.fullName.trim()) {
      errors.fullName = "Please enter your full name";
    } else if (nameParts.length < 2 || nameParts.some((p) => p.length < 2)) {
      errors.fullName = "Enter first and last name (e.g. Abebe Kebede)";
    }

    // Phone validation
    if (!form.phone) {
      errors.phone = "Please enter your phone number";
    } else if (!validatePhone(form.phone)) {
      errors.phone = "Enter 9 digits starting with 9 (e.g. 912345678)";
    }

    // Password validation
    if (!form.password) {
      errors.password = "Please enter a password";
    } else if (form.password.length < 6) {
      errors.password = "Password must be at least 6 characters";
    }

    // Blood type validation (optional, but must match valid types if given)
    if (userRole === "patient" && form.bloodType.trim()) {
      const validBloodTypes = ["a+", "a-", "b+", "b-", "ab+", "ab-", "o+", "o-", "a", "b", "ab", "o"];
      if (!validBloodTypes.includes(form.bloodType.trim().toLowerCase())) {
        errors.bloodType = "Valid types: A+, A-, B+, B-, AB+, AB-, O+, O-";
      }
    }

    // Emergency contact validation (optional but must be valid if provided, only for patients)
    if (
      userRole === "patient" &&
      form.contact &&
      !validatePhone(form.contact)
    ) {
      errors.contact = "Enter 9 digits starting with 9 (e.g. 912345678)";
    }

    // Ambulance-specific validation
    if (userRole === "ambulance") {
      if (!form.plateNumber.trim()) {
        errors.plateNumber = "Please enter the plate number";
      }
      if (!form.registrationNumber.trim()) {
        errors.registrationNumber = "Please enter registration number";
      }
    }

    // If any errors, show them and stop
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    performSignup();
  };

  const performSignup = async () => {
    console.log("performSignup called");
    setLoading(true);
    try {
      const emergencyContactPhone =
        userRole === "patient" && form.contact
          ? formatPhoneForDB(form.contact)
          : "";

      console.log("Starting signup with:", {
        phone: "+251" + form.phone,
        fullName: form.fullName,
        role: userRole,
      });

      // Sign up user with role (send E.164 phone for auth, Ethiopian format for profile)
      const { user, error } = await signUp(
        "+251" + form.phone,
        form.password,
        userRole,
        form.fullName.trim(),
      );

      console.log("Signup result:", { user, error });

      if (error || !user) {
        console.error("Signup error:", error);
        showError(
          "Registration Failed",
          error?.message || "Failed to create account",
        );
        setLoading(false);
        return;
      }

      console.log("User created:", user.id);

      // For patient role, create medical profile
      if (userRole === "patient") {
        try {
          const { success: medicalSuccess, error: medicalError } =
            await upsertMedicalProfile(user.id, {
              blood_type: form.bloodType || "Unknown",
              allergies: form.allergies.trim(),
              emergency_contact_name: form.fullName.trim(),
              emergency_contact_phone: emergencyContactPhone,
              medical_conditions: "",
            });

          console.log("Medical profile result:", {
            medicalSuccess,
            medicalError,
          });

          if (!medicalSuccess) {
            console.warn(
              "Warning: Medical profile creation failed:",
              medicalError?.message,
            );
            showAlert(
              "Warning",
              "Account created but medical profile could not be saved. You can update it later in your profile.",
            );
          } else {
            console.log("Medical profile created successfully");
          }
        } catch (err) {
          console.warn("Exception creating medical profile:", err);
          showAlert(
            "Warning",
            "Account created but medical profile could not be saved. You can update it later in your profile.",
          );
        }
      }

      // For ambulance role, create ambulance row
      if (userRole === "ambulance" && form.plateNumber) {
        try {
          const { ambulanceId, error: ambError } = await upsertDriverAmbulance(
            user.id,
            form.plateNumber,
            form.registrationNumber,
            form.ambulanceType,
          );

          if (ambError) {
            console.warn(
              "Warning: Ambulance creation failed:",
              ambError.message,
            );
            showAlert(
              "Warning",
              "Account created but ambulance could not be linked. Contact admin.",
            );
          } else {
            console.log("Ambulance linked to driver:", ambulanceId);
          }
        } catch (err) {
          console.warn("Exception creating ambulance:", err);
        }
      }

      setUser(user);
      setRegistered(true);

      // Redirect based on role after successful registration
      console.log("Redirecting based on role:", user.role);
      setLoading(false);

      const route =
        user.role === "ambulance" || user.role === "driver"
          ? "/driver-home"
          : "/help";
      console.log("Navigating to route:", route);
      router.replace(route as any);
    } catch (error) {
      console.error("Registration exception:", error);
      showError("Registration Failed", `Registration failed: ${error}`);
      setLoading(false);
    }
  };

  const RoleButton = ({
    role,
    label,
    icon,
  }: {
    role: AppRegistrationRole;
    label: string;
    icon: string;
  }) => {
    const isSelected = userRole === role;
    return (
      <Pressable
        onPress={() => !loading && setUserRole(role)}
        style={({ pressed }) => [
          styles.roleButton,
          isSelected
            ? isDark
              ? styles.roleButtonSelectedDark
              : styles.roleButtonSelectedLight
            : isDark
              ? styles.roleButtonDark
              : styles.roleButtonLight,
          pressed && { opacity: 0.8 },
        ]}
      >
        <MaterialIcons
          name={icon as any}
          size={24}
          color={isSelected ? "#0EA5E9" : isDark ? "#9CA3AF" : "#6B7280"}
        />
        <ThemedText
          style={[
            styles.roleButtonLabel,
            isSelected && styles.roleButtonLabelSelected,
          ]}
        >
          {label}
        </ThemedText>
      </Pressable>
    );
  };

  /* ---- colours ---- */
  const bg = colors.background;
  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const inputBg = colors.surfaceMuted;
  const inputBorder = colors.border;
  const textPrimary = colors.text;
  const textSecondary = colors.textMuted;
  const placeholderColor = isDark ? "#64748B" : "#94A3B8";

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        translucent
        backgroundColor="transparent"
      />
      <LoadingModal
        visible={loading}
        colorScheme={colorScheme}
        message="Creating your account..."
      />

      {/* Top accent gradient */}
      <LinearGradient
        colors={[colors.primary, "#EF4444", bg]}
        style={styles.topGradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        contentContainerStyle={[
          isSmallScreen ? styles.scrollMobile : styles.scroll,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces
        overScrollMode="always"
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
            isSmallScreen && styles.cardMobile,
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

          {/* Header */}
          <ThemedText style={[styles.title, { color: textPrimary }]}>
            Create Account
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
            Register for emergency ambulance assistance.
          </ThemedText>

          {/* Role Selection */}
          <View style={styles.roleSection}>
            <ThemedText style={[styles.roleLabel, { color: textPrimary }]}>
              I am a:
            </ThemedText>
            <View style={styles.roleButtons}>
              <RoleButton role="patient" label="Patient" icon="favorite" />
              <RoleButton role="ambulance" label="Ambulance" icon="local-shipping" />
            </View>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={isSmallScreen ? styles.rowMobile : styles.row}>
              <View style={styles.fieldHalf}>
                <ThemedText style={[styles.label, { color: textPrimary }]}>
                  Phone Number *
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
                    size={16}
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
                    onChangeText={(t) => handleChange("phone", t)}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                    editable={!loading}
                  />
                </View>
                {fieldErrors.phone ? (
                  <ThemedText style={styles.fieldError}>
                    {fieldErrors.phone}
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.fieldHalf}>
                <ThemedText style={[styles.label, { color: textPrimary }]}>
                  Password *
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
                    size={16}
                    color={fieldErrors.password ? "#DC2626" : textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    ref={passwordInputRef}
                    style={[styles.input, { color: textPrimary }]}
                    placeholder="Min 6 chars"
                    placeholderTextColor={placeholderColor}
                    secureTextEntry
                    value={form.password}
                    onChangeText={(t) => handleChange("password", t)}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    blurOnSubmit
                    editable={!loading}
                  />
                </View>
                {fieldErrors.password ? (
                  <ThemedText style={styles.fieldError}>
                    {fieldErrors.password}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            <View style={isSmallScreen ? styles.rowMobile : styles.row}>
              <View style={styles.fieldHalf}>
                <ThemedText style={[styles.label, { color: textPrimary }]}>
                  Full Name *
                </ThemedText>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: inputBg,
                      borderColor: fieldErrors.fullName
                        ? "#DC2626"
                        : inputBorder,
                    },
                  ]}
                >
                  <MaterialIcons
                    name="person-outline"
                    size={16}
                    color={fieldErrors.fullName ? "#DC2626" : textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={[styles.input, { color: textPrimary }]}
                    placeholder="Enter your full name"
                    placeholderTextColor={placeholderColor}
                    autoCapitalize="words"
                    value={form.fullName}
                    onChangeText={(t) => handleChange("fullName", t)}
                    editable={!loading}
                  />
                </View>
                {fieldErrors.fullName ? (
                  <ThemedText style={styles.fieldError}>
                    {fieldErrors.fullName}
                  </ThemedText>
                ) : null}
              </View>
              {/* Emergency Contact input only for patients */}
              {userRole === "patient" && (
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>
                    Emergency Contact
                  </ThemedText>
                  <View
                    style={[
                      styles.inputWrap,
                      {
                        backgroundColor: inputBg,
                        borderColor: fieldErrors.contact
                          ? "#DC2626"
                          : inputBorder,
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="contact-phone"
                      size={16}
                      color={fieldErrors.contact ? "#DC2626" : textSecondary}
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
                      maxLength={9}
                      value={form.contact}
                      onChangeText={(t) => handleChange("contact", t)}
                      editable={!loading}
                    />
                  </View>
                  {fieldErrors.contact ? (
                    <ThemedText style={styles.fieldError}>
                      {fieldErrors.contact}
                    </ThemedText>
                  ) : null}
                </View>
              )}
            </View>

            {/* Patient-specific fields */}
            {userRole === "patient" && (
              <View style={isSmallScreen ? styles.rowMobile : styles.row}>
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>
                    Blood Type
                  </ThemedText>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <MaterialIcons
                      name="bloodtype"
                      size={16}
                      color={textSecondary}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder="e.g. A+, O-"
                      placeholderTextColor={placeholderColor}
                      autoCapitalize="characters"
                      maxLength={3}
                      value={form.bloodType}
                      onChangeText={(t) => handleChange("bloodType", t)}
                      editable={!loading}
                    />
                  </View>
                  {fieldErrors.bloodType ? (
                    <ThemedText style={styles.fieldError}>
                      {fieldErrors.bloodType}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.fieldHalf}>
                  <ThemedText style={[styles.label, { color: textPrimary }]}>
                    Allergies
                  </ThemedText>
                  <View
                    style={[
                      styles.inputWrap,
                      { backgroundColor: inputBg, borderColor: inputBorder },
                    ]}
                  >
                    <MaterialIcons
                      name="warning-amber"
                      size={16}
                      color={textSecondary}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={[styles.input, { color: textPrimary }]}
                      placeholder="Comma-separated"
                      placeholderTextColor={placeholderColor}
                      value={form.allergies}
                      onChangeText={(t) => handleChange("allergies", t)}
                      editable={!loading}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* Ambulance-specific fields */}
            {userRole === "ambulance" && (
              <>
                <View style={isSmallScreen ? styles.rowMobile : styles.row}>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>
                      Ambulance Type *
                    </ThemedText>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {(["standard", "advanced", "icu"] as const).map((t) => {
                        const selected = form.ambulanceType === t;
                        return (
                          <Pressable
                            key={t}
                            onPress={() => handleChange("ambulanceType", t)}
                            disabled={loading}
                            style={[
                              {
                                flex: 1,
                                height: 34,
                                borderRadius: 8,
                                borderWidth: 1.5,
                                borderColor: selected ? "#DC2626" : inputBorder,
                                backgroundColor: selected
                                  ? "#DC262610"
                                  : inputBg,
                                alignItems: "center",
                                justifyContent: "center",
                              },
                            ]}
                          >
                            <ThemedText
                              style={{
                                fontSize: 11,
                                fontWeight: selected ? "800" : "600",
                                color: selected ? "#DC2626" : textSecondary,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                              }}
                            >
                              {t === "icu"
                                ? "ICU"
                                : t.charAt(0).toUpperCase() + t.slice(1)}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>
                <View style={isSmallScreen ? styles.rowMobile : styles.row}>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>
                      Plate Number *
                    </ThemedText>
                    <View
                      style={[
                        styles.inputWrap,
                        {
                          backgroundColor: inputBg,
                          borderColor: fieldErrors.plateNumber
                            ? "#DC2626"
                            : inputBorder,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name="directions-car"
                        size={16}
                        color={
                          fieldErrors.plateNumber ? "#DC2626" : textSecondary
                        }
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={[styles.input, { color: textPrimary }]}
                        placeholder="e.g. AA-12345"
                        placeholderTextColor={placeholderColor}
                        autoCapitalize="characters"
                        value={form.plateNumber}
                        onChangeText={(t) => handleChange("plateNumber", t)}
                        editable={!loading}
                      />
                    </View>
                    {fieldErrors.plateNumber ? (
                      <ThemedText style={styles.fieldError}>
                        {fieldErrors.plateNumber}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.fieldHalf}>
                    <ThemedText style={[styles.label, { color: textPrimary }]}>
                      Registration No. *
                    </ThemedText>
                    <View
                      style={[
                        styles.inputWrap,
                        {
                          backgroundColor: inputBg,
                          borderColor: fieldErrors.registrationNumber
                            ? "#DC2626"
                            : inputBorder,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name="assignment"
                        size={16}
                        color={
                          fieldErrors.registrationNumber
                            ? "#DC2626"
                            : textSecondary
                        }
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={[styles.input, { color: textPrimary }]}
                        placeholder="Reg. number"
                        placeholderTextColor={placeholderColor}
                        autoCapitalize="characters"
                        value={form.registrationNumber}
                        onChangeText={(t) =>
                          handleChange("registrationNumber", t)
                        }
                        editable={!loading}
                      />
                    </View>
                    {fieldErrors.registrationNumber ? (
                      <ThemedText style={styles.fieldError}>
                        {fieldErrors.registrationNumber}
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              </>
            )}

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                loading && { opacity: 0.7 },
              ]}
            >
              <LinearGradient
                colors={["#DC2626", "#B91C1C"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtnGradient}
              >
                <MaterialIcons name="person-add" size={18} color="#fff" />
                <ThemedText style={styles.primaryBtnText}>
                  {loading ? "Creating..." : "Create Account"}
                </ThemedText>
              </LinearGradient>
            </Pressable>
          </View>

          {/* Already have account */}
          <View
            style={[styles.footerDivider, { borderTopColor: cardBorder }]}
          />
          <View
            style={[styles.footer, { paddingBottom: isSmallScreen ? 28 : 0 }]}
          >
            <ThemedText style={[styles.footerText, { color: textSecondary }]}>
              Already have an account?
            </ThemedText>
            <Pressable
              onPress={() => !loading && router.replace("/login")}
              hitSlop={12}
            >
              <ThemedText style={styles.footerLink}>Sign In</ThemedText>
            </Pressable>
          </View>
        </Animated.View>
      </ScrollView>
      </KeyboardAvoidingView>
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
    height: "50%",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  scrollMobile: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 18 : 22,
    paddingBottom: 10,
  },
  card: {
    width: "100%",
    maxWidth: CARD_MAX_W,
    alignSelf: "center",
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 28,
    boxShadow: "0px 16px 32px rgba(0, 0, 0, 0.10)",
  },
  cardMobile: {
    width: "100%",
    maxWidth: CARD_MAX_W,
    alignSelf: "center",
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    marginHorizontal: 12,
    marginBottom: 8,
    flexGrow: 0,
  },
  headerArea: { alignItems: "center", marginBottom: 12 },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    boxShadow: "0px 6px 12px rgba(220, 38, 38, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.12)",
  },
  logoImage: {
    width: 48,
    height: 48,
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
    fontSize: 13,
    fontFamily: Fonts.sans,
    fontWeight: "500",
    lineHeight: 18,
    marginBottom: 10,
    textAlign: "center",
  },
  roleSection: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E6ECF2",
  },
  roleLabel: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
    letterSpacing: 0.1,
    marginBottom: 6,
  },
  roleButtons: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  roleButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 4,
  },
  roleButtonLight: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E6ECF2",
  },
  roleButtonDark: {
    backgroundColor: "#0B1220",
    borderColor: "#2E3236",
  },
  roleButtonSelectedLight: {
    backgroundColor: "#E0F2FE",
    borderColor: "#0EA5E9",
  },
  roleButtonSelectedDark: {
    backgroundColor: "rgba(14, 165, 233, 0.1)",
    borderColor: "#0EA5E9",
  },
  roleButtonLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    color: "#6B7280",
  },
  roleButtonLabelSelected: {
    color: "#0EA5E9",
    fontWeight: "700",
  },
  form: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  rowMobile: {
    flexDirection: "column",
    gap: 10,
  },
  fieldHalf: {
    flex: 1,
    gap: 3,
  },
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
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 10,
  },
  inputIcon: { marginRight: 6 },
  phonePrefix: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 13,
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
  primaryBtn: {
    marginTop: 2,
    borderRadius: 12,
    overflow: "hidden",
  },
  primaryBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    borderRadius: 12,
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
  footerDivider: {
    borderTopWidth: 1,
    marginTop: 16,
    marginBottom: 4,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  footerText: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    fontWeight: "500",
  },
  footerLink: {
    fontSize: 14,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    color: "#DC2626",
  },
});
