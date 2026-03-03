import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

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
import { HtmlMapView } from '@/components/html-map-view';
import {
    getEmergencyDetails,
    subscribeToAmbulanceLocation,
    subscribeToEmergency,
} from '@/utils/patient';

/* ─── Status notification messages (patient-facing) ───── */
const STATUS_NOTIFICATIONS: Record<string, { title: string; message: string; icon: string }> = {
  pending: { title: 'Request Sent', message: 'Looking for the nearest available ambulance...', icon: 'hourglass-top' },
  assigned: { title: 'Ambulance Assigned', message: 'An ambulance has been assigned to your emergency.', icon: 'local-shipping' },
  en_route: { title: 'Ambulance is Coming!', message: 'The ambulance is on its way to your location.', icon: 'directions-car' },
  at_scene: { title: 'Ambulance Arrived', message: 'The ambulance has arrived at your location.', icon: 'place' },
  arrived: { title: 'Ambulance Arrived', message: 'The ambulance has arrived at your location.', icon: 'place' },
  transporting: { title: 'On the Way to Hospital', message: 'You are being transported to the hospital.', icon: 'local-hospital' },
  at_hospital: { title: 'Arrived at Hospital', message: 'You have arrived at the hospital.', icon: 'local-hospital' },
  completed: { title: 'Emergency Completed', message: 'Your emergency request has been completed. Stay safe!', icon: 'check-circle' },
  cancelled: { title: 'Emergency Cancelled', message: 'This emergency request has been cancelled.', icon: 'cancel' },
};

export default function PatientEmergencyTrackingScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { emergencyId } = useLocalSearchParams();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth > 600;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [emergency, setEmergency] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [ambulance, setAmbulance] = useState<any>(null);
  const [ambulanceCoords, setAmbulanceCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const notifAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadData();
  }, [emergencyId]);

  // Realtime: emergency status changes
  useEffect(() => {
    if (!emergencyId || typeof emergencyId !== 'string') return;
    const unsub = subscribeToEmergency(emergencyId, (updated) => {
      setEmergency(updated);
    });
    return unsub;
  }, [emergencyId]);

  // Show notification toast when status changes
  useEffect(() => {
    if (!emergency?.status) return;
    const cur = emergency.status;
    if (prevStatusRef.current && prevStatusRef.current !== cur) {
      const notif = STATUS_NOTIFICATIONS[cur];
      if (notif) {
        setStatusNotification(cur);
        Animated.sequence([
          Animated.timing(notifAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.delay(4000),
          Animated.timing(notifAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start(() => setStatusNotification(null));
      }
    }
    prevStatusRef.current = cur;
  }, [emergency?.status]);

  // Realtime: ambulance location
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
        if (amb?.last_known_location) {
          const parsed = parsePostGISPoint(amb.last_known_location);
          if (parsed) setAmbulanceCoords(parsed);
        }
      }
    } catch (e) {
      setError('Failed to load emergency details');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ─── Status styling ───────────────────────────────────
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
      case 'critical': return { color: '#DC2626', label: 'Critical' };
      case 'high': return { color: '#EA580C', label: 'High' };
      case 'medium': return { color: '#0284C7', label: 'Medium' };
      case 'low': return { color: '#059669', label: 'Low' };
      default: return { color: '#6B7280', label: t || 'Unknown' };
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

  // Map: show both patient + ambulance with CORRECT labels for patient view
  const mapHtml =
    ambulanceCoords && patientCoords.latitude
      ? buildDriverPatientMapHtml(
          ambulanceCoords.latitude, ambulanceCoords.longitude,
          patientCoords.latitude, patientCoords.longitude,
          { blueLabel: 'Ambulance', redLabel: 'You', bluePopup: '🚑 Ambulance', redPopup: '📍 Your Location' },
        )
      : patientCoords.latitude
        ? buildMapHtml(patientCoords.latitude, patientCoords.longitude, 15)
        : null;

  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const cardBorder = isDark ? '#334155' : '#E2E8F0';
  const subtleText = isDark ? '#94A3B8' : '#64748B';
  const isCompleted = emergency.status === 'completed' || emergency.status === 'cancelled';
  const statusGradientColors: [string, string] = isDark
    ? [st.color + '40', '#020617']
    : [st.color + '30', '#F8FAFC'];

  // Status flow steps
  const statusSteps = [
    { key: 'pending', label: 'Requested', icon: 'hourglass-top' as const },
    { key: 'assigned', label: 'Assigned', icon: 'local-shipping' as const },
    { key: 'en_route', label: 'En Route', icon: 'directions-car' as const },
    { key: 'at_scene', label: 'Arrived', icon: 'place' as const },
    { key: 'transporting', label: 'Transport', icon: 'local-hospital' as const },
    { key: 'completed', label: 'Done', icon: 'check-circle' as const },
  ];
  const currentStepIndex = statusSteps.findIndex((s) => s.key === emergency.status);
  const resolvedIndex = emergency.status === 'at_hospital' ? 4 : currentStepIndex;

  // ─── Render ───────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: isDark ? '#0F172A' : '#F1F5F9' }]}>
      <LinearGradient
        colors={isDark ? ['rgba(14,165,233,0.15)', '#020617', 'transparent'] : ['rgba(14,165,233,0.2)', '#F8FAFC', 'transparent']}
        style={styles.heroGlow}
        pointerEvents="none"
      />
      {/* Floating notification toast */}
      {statusNotification && (
        <Animated.View
          style={[
            styles.notifToast,
            {
              backgroundColor: statusMeta(statusNotification).color,
              opacity: notifAnim,
              transform: [{ translateY: notifAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }],
            },
          ]}
        >
          <MaterialIcons name={STATUS_NOTIFICATIONS[statusNotification]?.icon as any || 'info'} size={22} color="#FFF" />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <ThemedText style={styles.notifTitle}>{STATUS_NOTIFICATIONS[statusNotification]?.title}</ThemedText>
            <ThemedText style={styles.notifMsg}>{STATUS_NOTIFICATIONS[statusNotification]?.message}</ThemedText>
          </View>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: Math.max(insets.top, 16) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header Row: Back + Title ─────────────────── */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' },
              pressed && { opacity: 0.6 },
            ]}
          >
            <MaterialIcons name="arrow-back" size={20} color={isDark ? '#E2E8F0' : '#334155'} />
          </Pressable>
          <ThemedText style={[styles.headerTitle, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
            Emergency Status
          </ThemedText>
          <Pressable
            onPress={onRefresh}
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' },
              pressed && { opacity: 0.6 },
            ]}
          >
            <MaterialIcons name="refresh" size={20} color={isDark ? '#E2E8F0' : '#334155'} />
          </Pressable>
        </View>

        <View style={styles.tagRow}>
          <MaterialIcons name="auto-awesome" size={18} color="#0EA5E9" />
          <ThemedText style={[styles.tagText, { color: isDark ? '#E2E8F0' : '#0F172A' }]}>Help is on the way—drivers see your request in real time.</ThemedText>
        </View>

        {/* ── Status Banner ─────────────────────────────── */}
        <LinearGradient
          colors={statusGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.statusBanner, styles.statusBannerElevated, { borderColor: st.color + '60' }]}
        >
          <MaterialIcons name={st.icon} size={32} color={st.color} />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <ThemedText style={[styles.statusLabel, { color: st.color }]}>
              {st.label}
            </ThemedText>
            <ThemedText style={[styles.statusSub, { color: st.color + 'BB' }]}>
              {new Date(emergency.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {distanceText ? `  •  ${distanceText} away` : ''}
            </ThemedText>
          </View>
          <View style={[styles.sevChip, { borderColor: sev.color + '60' }]}>
            <ThemedText style={[styles.sevChipText, { color: sev.color }]}>{sev.label}</ThemedText>
          </View>
        </LinearGradient>

        {/* ── Progress Steps ────────────────────────────── */}
        <View style={[styles.stepsCard, styles.cardElevated, { backgroundColor: cardBg, borderColor: cardBorder }]}> 
          <View style={styles.stepsRow}>
            {statusSteps.map((step, i) => {
              const done = resolvedIndex >= i;
              const active = resolvedIndex === i;
              const col = done ? '#10B981' : (active ? st.color : (isDark ? '#475569' : '#CBD5E1'));
              return (
                <View key={step.key} style={styles.stepItem}>
                  <View style={[styles.stepDot, { backgroundColor: done ? '#10B981' : 'transparent', borderColor: col }]}>
                    {done ? (
                      <MaterialIcons name="check" size={12} color="#FFF" />
                    ) : (
                      <MaterialIcons name={step.icon} size={12} color={col} />
                    )}
                  </View>
                  <ThemedText
                    style={[styles.stepLabel, { color: done ? '#10B981' : (isDark ? '#64748B' : '#94A3B8') }]}
                    numberOfLines={1}
                  >
                    {step.label}
                  </ThemedText>
                  {i < statusSteps.length - 1 && (
                    <View style={[styles.stepLine, { backgroundColor: resolvedIndex > i ? '#10B981' : (isDark ? '#334155' : '#E2E8F0') }]} />
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── MAP ───────────────────────────────────────── */}
        {mapHtml && (
          <View style={[styles.mapCard, styles.cardElevated, { backgroundColor: cardBg, borderColor: cardBorder }]}> 
            <View style={styles.mapHeader}>
              <MaterialIcons name="map" size={18} color="#0EA5E9" />
              <ThemedText style={[styles.mapTitle, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
                {ambulanceCoords ? 'Live Tracking' : 'Your Location'}
              </ThemedText>
              {distanceText ? (
                <View style={styles.distBadge}>
                  <MaterialIcons name="near-me" size={12} color="#FFF" style={{ marginRight: 4 }} />
                  <ThemedText style={styles.distText}>{distanceText}</ThemedText>
                </View>
              ) : null}
            </View>
            <HtmlMapView
              html={mapHtml}
              style={[styles.mapFrame, { height: isWide ? 450 : 300 }]}
              title="Emergency Map"
            />
            {/* Legend */}
            <View style={styles.mapLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
                <ThemedText style={[styles.legendText, { color: subtleText }]}>You</ThemedText>
              </View>
              {ambulanceCoords && (
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#0EA5E9' }]} />
                  <ThemedText style={[styles.legendText, { color: subtleText }]}>Ambulance</ThemedText>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── Ambulance Info ────────────────────────────── */}
        {ambulance && (
          <View style={[styles.infoCard, styles.cardElevated, { backgroundColor: cardBg, borderColor: cardBorder }]}> 
            <View style={styles.cardHeader}>
              <View style={[styles.iconCircle, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="local-shipping" size={20} color="#0EA5E9" />
              </View>
              <ThemedText style={[styles.cardHeading, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
                Assigned Ambulance
              </ThemedText>
              {!isCompleted && <View style={styles.activeDot} />}
            </View>

            <View style={styles.detailRow}>
              <View style={[styles.detailIcon, { backgroundColor: isDark ? '#0F172A' : '#F8FAFC' }]}>
                <MaterialIcons name="directions-car" size={16} color="#0EA5E9" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.detailLabel, { color: subtleText }]}>Vehicle</ThemedText>
                <ThemedText style={[styles.detailValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {ambulance.vehicle_number}
                </ThemedText>
              </View>
            </View>

            {ambulance.type && (
              <View style={styles.detailRow}>
                <View style={[styles.detailIcon, { backgroundColor: isDark ? '#0F172A' : '#F8FAFC' }]}>
                  <MaterialIcons name="category" size={16} color="#0EA5E9" />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.detailLabel, { color: subtleText }]}>Type</ThemedText>
                  <ThemedText style={[styles.detailValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                    {ambulance.type.charAt(0).toUpperCase() + ambulance.type.slice(1)}
                  </ThemedText>
                </View>
              </View>
            )}

            {assignment?.pickup_eta_minutes && (
              <View style={[styles.etaBadge, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="schedule" size={16} color="#0EA5E9" />
                <ThemedText style={styles.etaText}>ETA: {assignment.pickup_eta_minutes} min</ThemedText>
              </View>
            )}
          </View>
        )}

        {/* ── Emergency Details ─────────────────────────── */}
        <View style={[styles.infoCard, styles.cardElevated, { backgroundColor: cardBg, borderColor: cardBorder }]}> 
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#FEE2E2' }]}>
              <MaterialIcons name="emergency" size={20} color="#DC2626" />
            </View>
            <ThemedText style={[styles.cardHeading, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
              Emergency Details
            </ThemedText>
          </View>

          <View style={styles.detailRow}>
            <View style={[styles.detailIcon, { backgroundColor: isDark ? '#0F172A' : '#F8FAFC' }]}>
              <MaterialIcons name="place" size={16} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.detailLabel, { color: subtleText }]}>Your Location</ThemedText>
              <ThemedText style={[styles.detailValue, { color: isDark ? '#F1F5F9' : '#0F172A', fontSize: 13 }]}>
                {formatCoords(patientCoords.latitude, patientCoords.longitude)}
              </ThemedText>
            </View>
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

        {/* ── Quick Actions ──────────────────────────────── */}
        <View style={[styles.actionsContainer, { backgroundColor: cardBg, borderColor: cardBorder }]}> 
          <View style={styles.actionsRow}>
          <Pressable
            onPress={() => Linking.openURL('tel:911')}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: cardBg, borderColor: cardBorder },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.actionIcon, { backgroundColor: '#FEE2E2' }]}>
              <MaterialIcons name="phone" size={20} color="#DC2626" />
            </View>
            <ThemedText style={[styles.actionLabel, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>Call 911</ThemedText>
          </Pressable>

          {patientCoords.latitude ? (
            <Pressable
              onPress={() => {
                const url = `https://www.google.com/maps?q=${patientCoords.latitude},${patientCoords.longitude}`;
                Linking.openURL(url);
              }}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: cardBg, borderColor: cardBorder },
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.actionIcon, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="map" size={20} color="#0EA5E9" />
              </View>
              <ThemedText style={[styles.actionLabel, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>Maps</ThemedText>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => router.push('/help' as any)}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: cardBg, borderColor: cardBorder },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.actionIcon, { backgroundColor: '#ECFDF5' }]}>
              <MaterialIcons name="support-agent" size={20} color="#059669" />
            </View>
            <ThemedText style={[styles.actionLabel, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>Help</ThemedText>
          </Pressable>
          </View>
        </View>

        {/* Go Home if completed */}
        {isCompleted && (
          <Pressable
            onPress={() => router.replace('/patient-emergency' as any)}
            style={({ pressed }) => [styles.homeBtn, pressed && { opacity: 0.8 }]}
          >
            <MaterialIcons name="home" size={20} color="#FFF" />
            <ThemedText style={styles.homeBtnText}>Return Home</ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  heroGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
    zIndex: 0,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    alignSelf: 'center' as any,
    width: '100%' as any,
  },

  // Notification toast
  notifToast: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: 600,
    alignSelf: 'center' as any,
  },
  notifTitle: { color: '#FFF', fontSize: 14, fontWeight: '800', fontFamily: Fonts.sans },
  notifMsg: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontFamily: Fonts.sans, marginTop: 1 },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    fontFamily: Fonts.sans,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },

  // Error
  errWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 32 },
  errText: { fontSize: 16, fontFamily: Fonts.sans, color: '#EF4444', textAlign: 'center' },
  errBtn: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#0EA5E9', borderRadius: 10 },
  errBtnText: { color: '#FFF', fontWeight: '700', fontFamily: Fonts.sans },

  // Status banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  statusBannerElevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 17,
    elevation: 10,
  },
  statusLabel: { fontSize: 17, fontWeight: '800', fontFamily: Fonts.sans },
  statusSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
  sevChip: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  sevChipText: { fontSize: 11, fontWeight: '700', fontFamily: Fonts.sans },

  // Steps
  stepsCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
    position: 'relative' as any,
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepLabel: { fontSize: 9, fontWeight: '600', fontFamily: Fonts.sans, textAlign: 'center' },
  stepLine: {
    position: 'absolute',
    top: 11,
    left: '62%' as any,
    right: '-38%' as any,
    height: 2,
    zIndex: -1,
  },
  cardElevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 10,
  },

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
    flexDirection: 'row',
    alignItems: 'center',
  },
  distText: { color: '#FFF', fontSize: 12, fontWeight: '700', fontFamily: Fonts.sans },
  mapFrame: {
    width: '100%' as any,
    height: 300,
    marginTop: 10,
    paddingHorizontal: 12,
  },
  mapLegend: {
    flexDirection: 'row',
    gap: 16,
    padding: 10,
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
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
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

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailLabel: { fontSize: 11, fontFamily: Fonts.sans, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans },

  etaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
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

  // Actions
  actionsContainer: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    marginTop: 8,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  actionLabel: { fontSize: 12, fontWeight: '600', fontFamily: Fonts.sans },

  homeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  homeBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: Fonts.sans },
});
