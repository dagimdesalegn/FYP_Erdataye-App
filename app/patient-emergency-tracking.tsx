import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  buildDriverPatientMapHtml,
  buildMapHtml,
  calculateDistance,
  formatCoords,
  parsePostGISPoint,
} from '@/utils/emergency';
import {
  getEmergencyDetails,
  subscribeToEmergency,
  subscribeToAmbulanceLocation,
} from '@/utils/patient';

export default function PatientEmergencyTrackingScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { emergencyId } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [emergency, setEmergency] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [ambulance, setAmbulance] = useState<any>(null);
  const [ambulanceCoords, setAmbulanceCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergencyId]);

  // Realtime subscriptions
  useEffect(() => {
    if (!emergencyId || typeof emergencyId !== 'string') return;

    const unsubs: (() => void)[] = [];

    // Subscribe to emergency status changes
    unsubs.push(
      subscribeToEmergency(emergencyId, (updated) => {
        setEmergency(updated);
      })
    );

    return () => unsubs.forEach((fn) => fn());
  }, [emergencyId]);

  // Subscribe to ambulance location when we have an ambulance
  useEffect(() => {
    if (!ambulance?.id) return;
    const unsub = subscribeToAmbulanceLocation(ambulance.id, (lat, lng) => {
      setAmbulanceCoords({ latitude: lat, longitude: lng });
    });
    return unsub;
  }, [ambulance?.id]);

  const loadData = async () => {
    if (!emergencyId || typeof emergencyId !== 'string') {
      setError('Invalid emergency ID');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { emergency: emerg, assignment: assign, ambulance: amb, error: err } =
        await getEmergencyDetails(emergencyId);
      if (err) {
        setError(err.message);
      } else {
        setEmergency(emerg);
        setAssignment(assign);
        setAmbulance(amb);
        // Parse initial ambulance location
        if (amb?.last_known_location) {
          const parsed = parsePostGISPoint(amb.last_known_location);
          if (parsed) setAmbulanceCoords(parsed);
        }
      }
    } catch (err) {
      setError('Failed to load emergency details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ─── Status helpers ────────────────────────────────────
  const statusMeta = (s: string) => {
    switch (s) {
      case 'pending':
        return { color: '#F59E0B', bg: '#FEF3C7', icon: 'hourglass-top' as const, label: 'Finding Ambulance...' };
      case 'assigned':
        return { color: '#0EA5E9', bg: '#E0F2FE', icon: 'local-shipping' as const, label: 'Ambulance Dispatched' };
      case 'en_route':
        return { color: '#06B6D4', bg: '#CFFAFE', icon: 'directions-car' as const, label: 'Ambulance En Route' };
      case 'arrived':
      case 'at_scene':
        return { color: '#10B981', bg: '#D1FAE5', icon: 'place' as const, label: 'Ambulance Arrived' };
      case 'transporting':
        return { color: '#8B5CF6', bg: '#EDE9FE', icon: 'local-hospital' as const, label: 'Transporting to Hospital' };
      case 'at_hospital':
        return { color: '#7C3AED', bg: '#EDE9FE', icon: 'local-hospital' as const, label: 'At Hospital' };
      case 'completed':
        return { color: '#059669', bg: '#ECFDF5', icon: 'check-circle' as const, label: 'Completed' };
      case 'cancelled':
        return { color: '#EF4444', bg: '#FEE2E2', icon: 'cancel' as const, label: 'Cancelled' };
      default:
        return { color: '#6B7280', bg: '#F3F4F6', icon: 'info' as const, label: s };
    }
  };

  const sevMeta = (t: string) => {
    switch (t?.toLowerCase()) {
      case 'critical':
        return { color: '#DC2626', label: 'Critical' };
      case 'high':
        return { color: '#EA580C', label: 'High' };
      case 'medium':
        return { color: '#0284C7', label: 'Medium' };
      case 'low':
        return { color: '#059669', label: 'Low' };
      default:
        return { color: '#6B7280', label: t || 'Unknown' };
    }
  };

  // ─── Loading / Error ──────────────────────────────────
  if (loading) return <LoadingModal visible colorScheme={colorScheme} message="Loading emergency..." />;

  if (error || !emergency) {
    return (
      <View style={[styles.root, { backgroundColor: Colors[colorScheme].background }]}>
        <View style={styles.errWrap}>
          <MaterialIcons name="error-outline" size={48} color="#EF4444" />
          <ThemedText style={styles.errText}>{error || 'Emergency not found'}</ThemedText>
          <Pressable onPress={() => router.back()} style={styles.errBtn}>
            <ThemedText style={styles.errBtnText}>Go Back</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Computed values ──────────────────────────────────
  const st = statusMeta(emergency.status);
  const sev = sevMeta(emergency.emergency_type);
  const patientCoords = { latitude: Number(emergency.latitude || 0), longitude: Number(emergency.longitude || 0) };

  let distanceText = '';
  if (ambulanceCoords && patientCoords.latitude) {
    const km = calculateDistance(
      patientCoords.latitude, patientCoords.longitude,
      ambulanceCoords.latitude, ambulanceCoords.longitude,
    );
    distanceText = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }

  // Map: show both patient + ambulance if available, otherwise just patient
  const mapHtml =
    ambulanceCoords && patientCoords.latitude
      ? buildDriverPatientMapHtml(
          ambulanceCoords.latitude, ambulanceCoords.longitude,
          patientCoords.latitude, patientCoords.longitude,
        )
      : patientCoords.latitude
        ? buildMapHtml(patientCoords.latitude, patientCoords.longitude, 15)
        : null;

  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const cardBorder = isDark ? '#334155' : '#E2E8F0';
  const subtleText = isDark ? '#94A3B8' : '#64748B';

  // ─── Render ───────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: isDark ? '#0F172A' : '#F1F5F9' }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* X close button */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' },
            pressed && { opacity: 0.6 },
          ]}
        >
          <MaterialIcons name="close" size={20} color={isDark ? '#E2E8F0' : '#334155'} />
        </Pressable>

        {/* ── Status Banner ─────────────────────────────── */}
        <View style={[styles.statusBanner, { backgroundColor: st.bg }]}>
          <MaterialIcons name={st.icon} size={28} color={st.color} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <ThemedText style={[styles.statusLabel, { color: st.color }]}>
              {st.label}
            </ThemedText>
            <ThemedText style={[styles.statusSub, { color: st.color + 'AA' }]}>
              {new Date(emergency.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {distanceText ? `  •  Ambulance ${distanceText} away` : ''}
            </ThemedText>
          </View>
          {/* Severity chip */}
          <View style={[styles.sevChip, { borderColor: sev.color + '60' }]}>
            <ThemedText style={[styles.sevChipText, { color: sev.color }]}>
              {sev.label}
            </ThemedText>
          </View>
        </View>

        {/* ── MAP ───────────────────────────────────────── */}
        {mapHtml && Platform.OS === 'web' && (
          <View style={[styles.mapCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.mapHeader}>
              <MaterialIcons name="map" size={18} color="#0EA5E9" />
              <ThemedText style={[styles.mapTitle, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
                {ambulanceCoords ? 'Ambulance & Your Location' : 'Your Location'}
              </ThemedText>
              {distanceText ? (
                <View style={styles.distBadge}>
                  <ThemedText style={styles.distText}>{distanceText}</ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.mapFrame}>
              <iframe
                src={mapHtml}
                style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12 } as any}
                title="Emergency Map"
              />
            </View>
            {/* Legend */}
            <View style={styles.mapLegend}>
              {ambulanceCoords && (
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#0EA5E9' }]} />
                  <ThemedText style={[styles.legendText, { color: subtleText }]}>Ambulance</ThemedText>
                </View>
              )}
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
                <ThemedText style={[styles.legendText, { color: subtleText }]}>You</ThemedText>
              </View>
            </View>
          </View>
        )}

        {/* ── Ambulance Info ────────────────────────────── */}
        {ambulance && (
          <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="local-shipping" size={20} color="#0EA5E9" />
              </View>
              <ThemedText style={[styles.cardHeading, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
                Assigned Ambulance
              </ThemedText>
              <View style={styles.activeDot} />
            </View>

            <View style={styles.infoRow}>
              <ThemedText style={[styles.infoLabel, { color: subtleText }]}>Vehicle</ThemedText>
              <ThemedText style={[styles.infoValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                {ambulance.vehicle_number}
              </ThemedText>
            </View>

            {ambulance.type && (
              <View style={styles.infoRow}>
                <ThemedText style={[styles.infoLabel, { color: subtleText }]}>Type</ThemedText>
                <ThemedText style={[styles.infoValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {ambulance.type.charAt(0).toUpperCase() + ambulance.type.slice(1)}
                </ThemedText>
              </View>
            )}

            {assignment?.pickup_eta_minutes && (
              <View style={[styles.etaBadge, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="schedule" size={16} color="#0EA5E9" />
                <ThemedText style={styles.etaText}>
                  ETA: {assignment.pickup_eta_minutes} minutes
                </ThemedText>
              </View>
            )}
          </View>
        )}

        {/* ── Emergency Details ─────────────────────────── */}
        <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#FEE2E2' }]}>
              <MaterialIcons name="emergency" size={20} color="#DC2626" />
            </View>
            <ThemedText style={[styles.cardHeading, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
              Emergency Details
            </ThemedText>
          </View>

          <View style={styles.infoRow}>
            <ThemedText style={[styles.infoLabel, { color: subtleText }]}>Location</ThemedText>
            <ThemedText style={[styles.infoValue, { color: isDark ? '#F1F5F9' : '#0F172A', fontSize: 13 }]}>
              {formatCoords(patientCoords.latitude, patientCoords.longitude)}
            </ThemedText>
          </View>

          {emergency.description && (
            <View style={[styles.descBox, { backgroundColor: isDark ? '#0F172A' : '#F8FAFC', borderColor: cardBorder }]}>
              <MaterialIcons name="description" size={16} color={subtleText} />
              <ThemedText style={[styles.descText, { color: isDark ? '#CBD5E1' : '#475569' }]}>
                {emergency.description}
              </ThemedText>
            </View>
          )}
        </View>

        {/* ── Help Section ──────────────────────────────── */}
        <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#ECFDF5' }]}>
              <MaterialIcons name="support-agent" size={20} color="#059669" />
            </View>
            <ThemedText style={[styles.cardHeading, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
              Need Help?
            </ThemedText>
          </View>

          <Pressable
            onPress={() => Linking.openURL('tel:911')}
            style={({ pressed }) => [styles.helpBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons name="phone" size={18} color="#0EA5E9" />
            <ThemedText style={styles.helpBtnText}>Call Emergency Services</ThemedText>
            <MaterialIcons name="chevron-right" size={18} color="#0EA5E9" />
          </Pressable>

          {patientCoords.latitude ? (
            <Pressable
              onPress={() => {
                const url = `https://www.google.com/maps?q=${patientCoords.latitude},${patientCoords.longitude}`;
                Linking.openURL(url);
              }}
              style={({ pressed }) => [styles.helpBtn, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons name="map" size={18} color="#0EA5E9" />
              <ThemedText style={styles.helpBtnText}>Open in Google Maps</ThemedText>
              <MaterialIcons name="chevron-right" size={18} color="#0EA5E9" />
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  closeBtn: {
    alignSelf: 'flex-end',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  errWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
  errText: { fontSize: 16, fontFamily: Fonts.sans, color: '#EF4444', textAlign: 'center' },
  errBtn: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#0EA5E9', borderRadius: 10 },
  errBtnText: { color: '#FFF', fontWeight: '700', fontFamily: Fonts.sans },

  // Status banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  statusLabel: { fontSize: 16, fontWeight: '800', fontFamily: Fonts.sans },
  statusSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
  sevChip: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sevChipText: { fontSize: 11, fontWeight: '700', fontFamily: Fonts.sans },

  // Map card
  mapCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingBottom: 0,
  },
  mapTitle: { fontSize: 15, fontWeight: '600', fontFamily: Fonts.sans, marginLeft: 8, flex: 1 },
  distBadge: {
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  distText: { color: '#FFF', fontSize: 12, fontWeight: '700', fontFamily: Fonts.sans },
  mapFrame: {
    width: '100%' as any,
    height: 300,
    marginTop: 10,
    paddingHorizontal: 14,
  },
  mapLegend: {
    flexDirection: 'row',
    gap: 16,
    padding: 12,
    paddingTop: 6,
    justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, fontFamily: Fonts.sans },

  // Info card
  infoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeading: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans, marginLeft: 10, flex: 1 },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981' },

  infoRow: { marginBottom: 14 },
  infoLabel: { fontSize: 12, fontFamily: Fonts.sans, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 15, fontWeight: '600', fontFamily: Fonts.sans },

  etaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  etaText: { fontSize: 13, fontWeight: '700', fontFamily: Fonts.sans, color: '#0EA5E9' },

  descBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  descText: { fontSize: 13, fontFamily: Fonts.sans, marginLeft: 8, flex: 1, lineHeight: 20 },

  helpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
    borderRadius: 10,
    marginBottom: 10,
    gap: 10,
  },
  helpBtnText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    color: '#0EA5E9',
  },
});
