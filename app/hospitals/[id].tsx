import { AppHeader } from "@/components/app-header";
import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { backendGet } from "@/utils/api";
import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
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
  const _authLoading = useAuthGuard(["admin"]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? "light";
  const _isDark = theme === "dark";
  const colors = Colors[theme];

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<HospitalDetailsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const result = await backendGet<HospitalDetailsResponse>(
        `/ops/admin/hospitals/${id}`,
      );
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDetails();
  }, [fetchDetails]);

  const stats = useMemo(() => {
    if (!data) {
      return [
        {
          label: "Linked Ambulances",
          value: 0,
          icon: "directions-car" as const,
          color: "#8B5CF6",
        },
        {
          label: "Active Emergencies",
          value: 0,
          icon: "warning" as const,
          color: "#DC2626",
        },
        {
          label: "Completed",
          value: 0,
          icon: "check-circle" as const,
          color: "#10B981",
        },
        {
          label: "Drivers",
          value: 0,
          icon: "person" as const,
          color: "#3B82F6",
        },
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

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, title: hospitalName }} />
      <AppHeader title={hospitalName} onProfilePress={() => router.back()} />

      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#DC2626"
          />
        }
      >
        <View style={styles.container}>
          {loading ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator size="large" color="#DC2626" />
              <ThemedText style={[styles.centerText, { color: subText }]}>
                Loading hospital details...
              </ThemedText>
            </View>
          ) : error ? (
            <View
              style={[
                styles.errorCard,
                { borderColor: cardBorder, backgroundColor: cardBg },
              ]}
            >
              <MaterialIcons name="error-outline" size={20} color="#DC2626" />
              <ThemedText style={[styles.errorText, { color: colors.text }]}>
                {error}
              </ThemedText>
            </View>
          ) : data ? (
            <>
              <View
                style={[
                  styles.heroCard,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <ThemedText style={[styles.heroTitle, { color: colors.text }]}>
                  {data.hospital?.name || "Hospital"}
                </ThemedText>
                <ThemedText style={[styles.heroSub, { color: subText }]}>
                  {data.hospital?.address || "No address"}
                </ThemedText>
                <View style={styles.inlineRow}>
                  <MaterialIcons name="phone" size={14} color={subText} />
                  <ThemedText style={[styles.metaText, { color: subText }]}>
                    {data.hospital?.phone || "N/A"}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.statsGrid}>
                {stats.map((stat) => (
                  <View
                    key={stat.label}
                    style={[
                      styles.statCard,
                      { borderColor: cardBorder, backgroundColor: cardBg },
                    ]}
                  >
                    <View
                      style={[
                        styles.statIcon,
                        { backgroundColor: stat.color + "15" },
                      ]}
                    >
                      <MaterialIcons
                        name={stat.icon}
                        size={18}
                        color={stat.color}
                      />
                    </View>
                    <ThemedText
                      style={[styles.statValue, { color: colors.text }]}
                    >
                      {stat.value}
                    </ThemedText>
                    <ThemedText style={[styles.statLabel, { color: subText }]}>
                      {stat.label}
                    </ThemedText>
                  </View>
                ))}
              </View>

              <View
                style={[
                  styles.sectionCard,
                  { borderColor: cardBorder, backgroundColor: cardBg },
                ]}
              >
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.text }]}
                >
                  {hospitalName} Metadata
                </ThemedText>
                <Meta
                  label="Accepting Emergencies"
                  value={
                    data.hospital?.is_accepting_emergencies === false
                      ? "No"
                      : "Yes"
                  }
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="Max Concurrent"
                  value={String(
                    data.hospital?.max_concurrent_emergencies ?? "N/A",
                  )}
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="Dispatch Weight"
                  value={String(data.hospital?.dispatch_weight ?? "N/A")}
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="Trauma Capable"
                  value={data.hospital?.trauma_capable ? "Yes" : "No"}
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="ICU Beds"
                  value={String(data.hospital?.icu_beds_available ?? 0)}
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="Avg Handover (min)"
                  value={String(
                    data.hospital?.average_handover_minutes ?? "N/A",
                  )}
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="Created"
                  value={String(data.hospital?.created_at ?? "N/A")}
                  subText={subText}
                  text={colors.text}
                />
                <Meta
                  label="Updated"
                  value={String(data.hospital?.updated_at ?? "N/A")}
                  subText={subText}
                  text={colors.text}
                />
              </View>

              <View
                style={[
                  styles.sectionCard,
                  { borderColor: cardBorder, backgroundColor: cardBg },
                ]}
              >
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.text }]}
                >
                  Linked Ambulances ({data.linked_ambulances.length})
                </ThemedText>
                {data.linked_ambulances.length === 0 ? (
                  <ThemedText style={[styles.emptyText, { color: subText }]}>
                    No ambulances linked yet.
                  </ThemedText>
                ) : (
                  data.linked_ambulances.map((amb) => (
                    <View
                      key={amb.id}
                      style={[styles.rowItem, { borderColor: cardBorder }]}
                    >
                      <ThemedText
                        style={[styles.rowTitle, { color: colors.text }]}
                      >
                        {amb.vehicle_number || amb.id}
                      </ThemedText>
                      <ThemedText style={[styles.rowSub, { color: subText }]}>
                        {amb.type || "standard"} ·{" "}
                        {amb.is_available ? "Available" : "Busy"}
                      </ThemedText>
                    </View>
                  ))
                )}
              </View>

              <View
                style={[
                  styles.sectionCard,
                  { borderColor: cardBorder, backgroundColor: cardBg },
                ]}
              >
                <ThemedText
                  style={[styles.sectionTitle, { color: colors.text }]}
                >
                  Linked Drivers ({data.linked_driver_profiles.length})
                </ThemedText>
                {data.linked_driver_profiles.length === 0 ? (
                  <ThemedText style={[styles.emptyText, { color: subText }]}>
                    No linked driver profiles yet.
                  </ThemedText>
                ) : (
                  data.linked_driver_profiles.map((d) => (
                    <View
                      key={d.id}
                      style={[styles.rowItem, { borderColor: cardBorder }]}
                    >
                      <ThemedText
                        style={[styles.rowTitle, { color: colors.text }]}
                      >
                        {d.full_name || "Unknown"}
                      </ThemedText>
                      <ThemedText style={[styles.rowSub, { color: subText }]}>
                        {d.phone || "No phone"}
                      </ThemedText>
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

function Meta({
  label,
  value,
  subText,
  text,
}: {
  label: string;
  value: string;
  subText: string;
  text: string;
}) {
  return (
    <View style={styles.metaRow}>
      <ThemedText style={[styles.metaLabel, { color: subText }]}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.metaValue, { color: text }]}>
        {value}
      </ThemedText>
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
  centerWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 10,
  },
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
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
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
  emptyText: { fontSize: 12, fontFamily: Fonts.sans },
  rowItem: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: "700", fontFamily: Fonts.sans },
  rowSub: { fontSize: 12, fontFamily: Fonts.sans },
});
