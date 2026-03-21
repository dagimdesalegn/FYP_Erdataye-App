import { AppHeader } from "@/components/app-header";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { backendGet, backendPut } from "@/utils/api";
import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

type HospitalDetailsResponse = {
  hospital: any;
  linked_ambulances: any[];
  linked_driver_profiles: any[];
  total_emergencies: number;
  active_emergencies: number;
  completed_emergencies: number;
  cancelled_emergencies: number;
};

export default function AdminHospitalDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? "light";
  const isDark = theme === "dark";
  const colors = Colors[theme];

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<HospitalDetailsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    address: "",
    phone: "",
    isAcceptingEmergencies: true,
    traumaCapable: false,
    maxConcurrent: "",
    dispatchWeight: "",
    icuBeds: "",
    averageHandover: "",
  });

  const cardBg = colors.surface;
  const cardBorder = colors.border;
  const subText = colors.textMuted;
  const hospitalName = String(data?.hospital?.name || "Hospital");

  const fetchDetails = useCallback(async () => {
    if (!id) {
      setError("Hospital id is missing");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setError(null);
      const result = await backendGet<HospitalDetailsResponse>(`/ops/admin/hospitals/${id}`);
      setData(result);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load hospital details"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  useEffect(() => {
    if (!data?.hospital) return;
    setEditForm({
      name: String(data.hospital?.name || ""),
      address: String(data.hospital?.address || ""),
      phone: String(data.hospital?.phone || ""),
      isAcceptingEmergencies: data.hospital?.is_accepting_emergencies !== false,
      traumaCapable: Boolean(data.hospital?.trauma_capable),
      maxConcurrent: String(data.hospital?.max_concurrent_emergencies ?? ""),
      dispatchWeight: String(data.hospital?.dispatch_weight ?? "1"),
      icuBeds: String(data.hospital?.icu_beds_available ?? "0"),
      averageHandover: String(data.hospital?.average_handover_minutes ?? "25"),
    });
  }, [data?.hospital]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDetails();
  }, [fetchDetails]);

  const stats = useMemo(() => {
    if (!data) {
      return [
        { label: "Linked Ambulances", value: 0, icon: "directions-car" as const, color: "#8B5CF6" },
        { label: "Active Emergencies", value: 0, icon: "warning" as const, color: "#DC2626" },
        { label: "Completed", value: 0, icon: "check-circle" as const, color: "#10B981" },
        { label: "Drivers", value: 0, icon: "person" as const, color: "#3B82F6" },
      ];
    }

    return [
      {
        label: "Linked Ambulances",
        value: data.linked_ambulances.length,
        icon: "directions-car" as const,
        color: "#8B5CF6",
      },
      {
        label: "Active Emergencies",
        value: data.active_emergencies,
        icon: "warning" as const,
        color: "#DC2626",
      },
      {
        label: "Completed",
        value: data.completed_emergencies,
        icon: "check-circle" as const,
        color: "#10B981",
      },
      {
        label: "Drivers",
        value: data.linked_driver_profiles.length,
        icon: "person" as const,
        color: "#3B82F6",
      },
    ];
  }, [data]);

  const saveHospitalSettings = async () => {
    if (!id) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const payload = {
        name: editForm.name.trim() || undefined,
        address: editForm.address.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        is_accepting_emergencies: editForm.isAcceptingEmergencies,
        trauma_capable: editForm.traumaCapable,
        max_concurrent_emergencies: editForm.maxConcurrent.trim()
          ? Number(editForm.maxConcurrent)
          : undefined,
        dispatch_weight: editForm.dispatchWeight.trim()
          ? Number(editForm.dispatchWeight)
          : undefined,
        icu_beds_available: editForm.icuBeds.trim()
          ? Number(editForm.icuBeds)
          : undefined,
        average_handover_minutes: editForm.averageHandover.trim()
          ? Number(editForm.averageHandover)
          : undefined,
      };

      await backendPut(`/ops/admin/hospitals/${id}`, payload);
      setSaveMessage("Hospital settings updated successfully.");
      fetchDetails();
    } catch (e: any) {
      setSaveMessage(String(e?.message || "Failed to update hospital settings"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}> 
      <Stack.Screen options={{ headerShown: false, title: hospitalName }} />
      <AppHeader title={hospitalName} onProfilePress={() => router.back()} />

      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#DC2626" />}
      >
        <View style={styles.container}>
          {loading ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator size="large" color="#DC2626" />
              <ThemedText style={[styles.centerText, { color: subText }]}>Loading hospital details...</ThemedText>
            </View>
          ) : error ? (
            <View style={[styles.errorCard, { borderColor: cardBorder, backgroundColor: cardBg }]}>
              <MaterialIcons name="error-outline" size={20} color="#DC2626" />
              <ThemedText style={[styles.errorText, { color: colors.text }]}>{error}</ThemedText>
            </View>
          ) : data ? (
            <>
              <View style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }]}> 
                <ThemedText style={[styles.heroTitle, { color: colors.text }]}>{data.hospital?.name || "Hospital"}</ThemedText>
                <ThemedText style={[styles.heroSub, { color: subText }]}>{data.hospital?.address || "No address"}</ThemedText>
                <View style={styles.inlineRow}>
                  <MaterialIcons name="phone" size={14} color={subText} />
                  <ThemedText style={[styles.metaText, { color: subText }]}>{data.hospital?.phone || "N/A"}</ThemedText>
                </View>
              </View>

              <View style={styles.statsGrid}>
                {stats.map((stat) => (
                  <View key={stat.label} style={[styles.statCard, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                    <View style={[styles.statIcon, { backgroundColor: stat.color + "15" }]}> 
                      <MaterialIcons name={stat.icon} size={18} color={stat.color} />
                    </View>
                    <ThemedText style={[styles.statValue, { color: colors.text }]}>{stat.value}</ThemedText>
                    <ThemedText style={[styles.statLabel, { color: subText }]}>{stat.label}</ThemedText>
                  </View>
                ))}
              </View>

              <View style={[styles.sectionCard, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>{hospitalName} Metadata</ThemedText>
                <Meta label="Accepting Emergencies" value={data.hospital?.is_accepting_emergencies === false ? "No" : "Yes"} subText={subText} text={colors.text} />
                <Meta label="Max Concurrent" value={String(data.hospital?.max_concurrent_emergencies ?? "N/A")} subText={subText} text={colors.text} />
                <Meta label="Dispatch Weight" value={String(data.hospital?.dispatch_weight ?? "N/A")} subText={subText} text={colors.text} />
                <Meta label="Trauma Capable" value={data.hospital?.trauma_capable ? "Yes" : "No"} subText={subText} text={colors.text} />
                <Meta label="ICU Beds" value={String(data.hospital?.icu_beds_available ?? 0)} subText={subText} text={colors.text} />
                <Meta label="Avg Handover (min)" value={String(data.hospital?.average_handover_minutes ?? "N/A")} subText={subText} text={colors.text} />
                <Meta label="Created" value={String(data.hospital?.created_at ?? "N/A")} subText={subText} text={colors.text} />
                <Meta label="Updated" value={String(data.hospital?.updated_at ?? "N/A")} subText={subText} text={colors.text} />
              </View>

              <View style={[styles.sectionCard, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Edit Hospital Settings</ThemedText>

                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                  placeholder="Hospital name"
                  placeholderTextColor={subText}
                  value={editForm.name}
                  onChangeText={(t) => setEditForm((p) => ({ ...p, name: t }))}
                />
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                  placeholder="Address"
                  placeholderTextColor={subText}
                  value={editForm.address}
                  onChangeText={(t) => setEditForm((p) => ({ ...p, address: t }))}
                />
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                  placeholder="Phone"
                  placeholderTextColor={subText}
                  value={editForm.phone}
                  onChangeText={(t) => setEditForm((p) => ({ ...p, phone: t }))}
                />

                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setEditForm((p) => ({ ...p, isAcceptingEmergencies: !p.isAcceptingEmergencies }))}
                    style={[styles.toggleBtn, { backgroundColor: editForm.isAcceptingEmergencies ? "#DCFCE7" : "#FEE2E2" }]}
                  >
                    <ThemedText style={[styles.toggleText, { color: editForm.isAcceptingEmergencies ? "#166534" : "#991B1B" }]}>
                      {editForm.isAcceptingEmergencies ? "Accepting Emergencies" : "Closed to Emergencies"}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditForm((p) => ({ ...p, traumaCapable: !p.traumaCapable }))}
                    style={[styles.toggleBtn, { backgroundColor: editForm.traumaCapable ? "#DBEAFE" : "#F3F4F6" }]}
                  >
                    <ThemedText style={[styles.toggleText, { color: editForm.traumaCapable ? "#1D4ED8" : "#374151" }]}>
                      Trauma {editForm.traumaCapable ? "Enabled" : "Disabled"}
                    </ThemedText>
                  </Pressable>
                </View>

                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.inputHalf, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                    placeholder="Max concurrent"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={editForm.maxConcurrent}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, maxConcurrent: t }))}
                  />
                  <TextInput
                    style={[styles.inputHalf, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                    placeholder="Dispatch weight"
                    placeholderTextColor={subText}
                    keyboardType="decimal-pad"
                    value={editForm.dispatchWeight}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, dispatchWeight: t }))}
                  />
                </View>
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.inputHalf, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                    placeholder="ICU beds"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={editForm.icuBeds}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, icuBeds: t }))}
                  />
                  <TextInput
                    style={[styles.inputHalf, { color: colors.text, borderColor: cardBorder, backgroundColor: isDark ? "#101622" : "#F8FAFC" }]}
                    placeholder="Avg handover minutes"
                    placeholderTextColor={subText}
                    keyboardType="numeric"
                    value={editForm.averageHandover}
                    onChangeText={(t) => setEditForm((p) => ({ ...p, averageHandover: t }))}
                  />
                </View>

                <Pressable
                  onPress={saveHospitalSettings}
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { opacity: pressed || saving ? 0.85 : 1 },
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <MaterialIcons name="save" size={16} color="#FFFFFF" />
                  )}
                  <ThemedText style={styles.saveBtnText}>{saving ? "Saving..." : "Save Changes"}</ThemedText>
                </Pressable>

                {saveMessage ? (
                  <ThemedText style={[styles.saveMessage, { color: subText }]}>{saveMessage}</ThemedText>
                ) : null}
              </View>

              <View style={[styles.sectionCard, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Linked Ambulances ({data.linked_ambulances.length})</ThemedText>
                {data.linked_ambulances.length === 0 ? (
                  <ThemedText style={[styles.emptyText, { color: subText }]}>No ambulances linked yet.</ThemedText>
                ) : (
                  data.linked_ambulances.map((amb) => (
                    <View key={amb.id} style={[styles.rowItem, { borderColor: cardBorder }]}> 
                      <ThemedText style={[styles.rowTitle, { color: colors.text }]}>{amb.vehicle_number || amb.id}</ThemedText>
                      <ThemedText style={[styles.rowSub, { color: subText }]}>{amb.type || "standard"} · {amb.is_available ? "Available" : "Busy"}</ThemedText>
                    </View>
                  ))
                )}
              </View>

              <View style={[styles.sectionCard, { borderColor: cardBorder, backgroundColor: cardBg }]}>
                <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Linked Drivers ({data.linked_driver_profiles.length})</ThemedText>
                {data.linked_driver_profiles.length === 0 ? (
                  <ThemedText style={[styles.emptyText, { color: subText }]}>No linked driver profiles yet.</ThemedText>
                ) : (
                  data.linked_driver_profiles.map((d) => (
                    <View key={d.id} style={[styles.rowItem, { borderColor: cardBorder }]}> 
                      <ThemedText style={[styles.rowTitle, { color: colors.text }]}>{d.full_name || "Unknown"}</ThemedText>
                      <ThemedText style={[styles.rowSub, { color: subText }]}>{d.phone || "No phone"}</ThemedText>
                    </View>
                  ))
                )}
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Meta({ label, value, subText, text }: { label: string; value: string; subText: string; text: string }) {
  return (
    <View style={styles.metaRow}>
      <ThemedText style={[styles.metaLabel, { color: subText }]}>{label}</ThemedText>
      <ThemedText style={[styles.metaValue, { color: text }]}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  scrollOuter: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingBottom: 40 },
  container: {
    paddingHorizontal: 16,
    maxWidth: 900,
    width: "100%" as any,
    alignSelf: "center" as any,
    gap: 12,
  },
  centerWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 10 },
  centerText: { fontSize: 14, fontFamily: Fonts.sans },
  errorCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, fontWeight: "600" },
  heroCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  heroTitle: { fontSize: 18, fontWeight: "800", fontFamily: Fonts.sans },
  heroSub: { fontSize: 13, fontFamily: Fonts.sans },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  metaText: { fontSize: 12, fontFamily: Fonts.sans },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flexBasis: "30%" as any,
    minWidth: 120,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 12,
    gap: 4,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { fontSize: 22, fontWeight: "800", fontFamily: Fonts.sans },
  statLabel: { fontSize: 12, fontFamily: Fonts.sans, textAlign: "center" },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", fontFamily: Fonts.sans },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  metaLabel: { fontSize: 12, fontFamily: Fonts.sans },
  metaValue: { fontSize: 12, fontWeight: "700", fontFamily: Fonts.sans },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
  },
  inputHalf: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: Fonts.sans,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  toggleBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  saveBtn: {
    marginTop: 2,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    fontFamily: Fonts.sans,
  },
  saveMessage: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    fontWeight: "600",
  },
  emptyText: { fontSize: 12, fontFamily: Fonts.sans },
  rowItem: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: "700", fontFamily: Fonts.sans },
  rowSub: { fontSize: 12, fontFamily: Fonts.sans },
});
