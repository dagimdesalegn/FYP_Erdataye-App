import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Dimensions,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';

import { AppButton } from '@/components/app-button';
import { useAppState } from '@/components/app-state';
import { LoadingModal } from '@/components/loading-modal';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    getDriverAmbulanceId,
    getPatientInfo,
    sendLocationUpdate,
    subscribeToEmergencyStatus,
    updateEmergencyStatus,
} from '@/utils/driver';
import {
    buildDriverPatientMapHtml,
    buildMapHtml,
    calculateDistance,
    formatCoords,
    parsePostGISPoint,
} from '@/utils/emergency';
import { supabaseAdmin } from '@/utils/supabase';

type Tab = 'map' | 'status';

const STATUS_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  pending: { label: 'Pending', icon: 'hourglass-top', color: '#F59E0B' },
  assigned: { label: 'Assigned', icon: 'local-shipping', color: '#0EA5E9' },
  en_route: { label: 'En Route', icon: 'directions-car', color: '#06B6D4' },
  at_scene: { label: 'At Scene', icon: 'place', color: '#10B981' },
  transporting: { label: 'Transporting', icon: 'local-hospital', color: '#8B5CF6' },
  at_hospital: { label: 'At Hospital', icon: 'local-hospital', color: '#7C3AED' },
  completed: { label: 'Completed', icon: 'check-circle', color: '#059669' },
};

export default function DriverEmergencyTrackingScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const { emergencyId } = useLocalSearchParams();
  const { user } = useAppState();

  const [currentStatus, setCurrentStatus] = useState('assigned');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [ambulanceId, setAmbulanceId] = useState<string | null>(null);
  const [driverCoords, setDriverCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [patientCoords, setPatientCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [patientInfo, setPatientInfo] = useState<any>(null);
  const [locationTracking, setLocationTracking] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('map');

  const statusFlow = ['assigned', 'en_route', 'at_scene', 'transporting', 'at_hospital', 'completed'];

  // Load emergency data + ambulance + patient info
  useEffect(() => {
    if (!emergencyId || !user) return;

    const loadData = async () => {
      try {
        setLoading(true);

        // Get ambulance ID
        const { ambulanceId: ambId } = await getDriverAmbulanceId(user.id);
        if (ambId) {
          setAmbulanceId(ambId);
          // Get ambulance location
          const { data: ambData } = await supabaseAdmin
            .from('ambulances')
            .select('last_known_location')
            .eq('id', ambId)
            .maybeSingle();
          if (ambData?.last_known_location) {
            const parsed = parsePostGISPoint(ambData.last_known_location);
            if (parsed) setDriverCoords(parsed);
          }
        }

        // Get emergency request for patient location + status
        const { data: emergData } = await supabaseAdmin
          .from('emergency_requests')
          .select('*')
          .eq('id', emergencyId as string)
          .maybeSingle();

        if (emergData) {
          setCurrentStatus(emergData.status || 'assigned');
          // Parse patient location from PostGIS geometry
          const patLoc = parsePostGISPoint(emergData.patient_location);
          if (patLoc) {
            setPatientCoords(patLoc);
          }

          // Get patient info
          if (emergData.patient_id) {
            const { info } = await getPatientInfo(emergData.patient_id);
            if (info) setPatientInfo(info);
          }
        }
      } catch (err) {
        console.error('Error loading data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Subscribe to status changes
    const unsubscribe = subscribeToEmergencyStatus(emergencyId as string, (status: string) => {
      setCurrentStatus(status);
    });

    return unsubscribe;
  }, [emergencyId, user]);

  // Location tracking - updates driver position + sends to DB
  useEffect(() => {
    if (!locationTracking || !ambulanceId) return;

    let intervalId: any = null;

    const startTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync();
        setDriverCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        await sendLocationUpdate(ambulanceId, loc.coords.latitude, loc.coords.longitude);

        intervalId = setInterval(async () => {
          try {
            const currentLoc = await Location.getCurrentPositionAsync();
            setDriverCoords({ latitude: currentLoc.coords.latitude, longitude: currentLoc.coords.longitude });
            await sendLocationUpdate(ambulanceId, currentLoc.coords.latitude, currentLoc.coords.longitude);
          } catch {}
        }, 10000);
      } catch (error) {
        console.error('Location error:', error);
      }
    };

    startTracking();
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [locationTracking, ambulanceId]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!emergencyId || !user) return;
    try {
      setUpdating(true);
      const { error } = await updateEmergencyStatus(emergencyId as string, newStatus as any);
      if (error) {
        const msg = 'Failed to update status';
        Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
        return;
      }
      setCurrentStatus(newStatus);
      if (newStatus === 'completed') {
        const msg = 'Emergency marked as completed!';
        if (Platform.OS === 'web') {
          window.alert(msg);
          router.replace('/driver-home' as any);
        } else {
          Alert.alert('Success', msg, [
            { text: 'Return Home', onPress: () => router.replace('/driver-home' as any) },
          ]);
        }
      }
    } catch {
      Platform.OS === 'web' ? window.alert('Failed to update') : Alert.alert('Error', 'Failed to update');
    } finally {
      setUpdating(false);
    }
  };

  const getNextStatus = () => {
    const idx = statusFlow.indexOf(currentStatus);
    return idx >= 0 && idx < statusFlow.length - 1 ? statusFlow[idx + 1] : null;
  };

  // ─── Loading ──────────────────────────────────────────
  if (loading) {
    return <LoadingModal visible colorScheme={colorScheme} message="Loading..." />;
  }

  const nextStatus = getNextStatus();
  const canUpdate = currentStatus !== 'completed';
  const st = STATUS_LABELS[currentStatus] || STATUS_LABELS.assigned;

  // Distance
  let distanceText = '';
  if (driverCoords && patientCoords) {
    const km = calculateDistance(driverCoords.latitude, driverCoords.longitude, patientCoords.latitude, patientCoords.longitude);
    distanceText = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }

  // Map HTML
  const mapHtml =
    driverCoords && patientCoords
      ? buildDriverPatientMapHtml(
          driverCoords.latitude, driverCoords.longitude,
          patientCoords.latitude, patientCoords.longitude,
          { blueLabel: 'You', redLabel: 'Patient', bluePopup: '🚑 You', redPopup: '🆘 Patient' },
        )
      : patientCoords
        ? buildMapHtml(patientCoords.latitude, patientCoords.longitude, 16)
        : driverCoords
          ? buildMapHtml(driverCoords.latitude, driverCoords.longitude, 16)
          : null;

  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const cardBorder = isDark ? '#334155' : '#E2E8F0';
  const subtleText = isDark ? '#94A3B8' : '#64748B';

  return (
    <View style={[styles.root, { backgroundColor: isDark ? '#0F172A' : '#F1F5F9' }]}>
      <LoadingModal visible={updating} colorScheme={colorScheme} message="Updating..." />

      {/* ── Header ───────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: cardBg, borderBottomColor: cardBorder }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.headerBtn, { backgroundColor: isDark ? '#334155' : '#F1F5F9' }, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name="arrow-back" size={20} color={isDark ? '#E2E8F0' : '#334155'} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <ThemedText style={[styles.headerTitle, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
            Emergency Tracking
          </ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <View style={[styles.statusDot, { backgroundColor: st.color }]} />
            <ThemedText style={[styles.headerSub, { color: st.color }]}>{st.label}</ThemedText>
            {distanceText ? (
              <ThemedText style={[styles.headerSub, { color: subtleText }]}>  •  {distanceText}</ThemedText>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => setLocationTracking(!locationTracking)}
          style={({ pressed }) => [styles.headerBtn, { backgroundColor: locationTracking ? '#10B98120' : '#6B728020' }, pressed && { opacity: 0.6 }]}
        >
          <MaterialIcons name={locationTracking ? 'location-on' : 'location-off'} size={20} color={locationTracking ? '#10B981' : '#6B7280'} />
        </Pressable>
      </View>

      {/* ── Tabs ─────────────────────────────────────── */}
      <View style={[styles.tabBar, { backgroundColor: cardBg, borderBottomColor: cardBorder }]}>
        <Pressable
          onPress={() => setActiveTab('map')}
          style={[styles.tabBtn, activeTab === 'map' && styles.tabBtnActive]}
        >
          <MaterialIcons name="map" size={18} color={activeTab === 'map' ? '#0EA5E9' : subtleText} />
          <ThemedText style={[styles.tabLabel, { color: activeTab === 'map' ? '#0EA5E9' : subtleText }]}>
            Map
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('status')}
          style={[styles.tabBtn, activeTab === 'status' && styles.tabBtnActive]}
        >
          <MaterialIcons name="timeline" size={18} color={activeTab === 'status' ? '#0EA5E9' : subtleText} />
          <ThemedText style={[styles.tabLabel, { color: activeTab === 'status' ? '#0EA5E9' : subtleText }]}>
            Update Status
          </ThemedText>
        </Pressable>
      </View>

      {/* ── Tab Content ──────────────────────────────── */}
      {activeTab === 'map' ? (
        /* ═══════════ MAP TAB ═══════════ */
        <View style={styles.mapTabWrap}>
          {mapHtml && Platform.OS === 'web' ? (
            <View style={styles.mapFull}>
              <iframe
                src={mapHtml}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' } as any}
                title="Driver Tracking Map"
                allow="geolocation"
              />
            </View>
          ) : (
            <View style={styles.noMapWrap}>
              <MaterialIcons name="map" size={48} color={subtleText} />
              <ThemedText style={[styles.noMapText, { color: subtleText }]}>Map not available</ThemedText>
            </View>
          )}

          {/* Floating info overlay on map */}
          <View style={[styles.mapOverlay, { backgroundColor: cardBg + 'EE', borderColor: cardBorder }]}>
            {patientInfo && (
              <View style={styles.overlayRow}>
                <MaterialIcons name="person" size={16} color="#059669" />
                <ThemedText style={[styles.overlayText, { color: isDark ? '#F1F5F9' : '#0F172A' }]} numberOfLines={1}>
                  {patientInfo.full_name}
                </ThemedText>
                {patientInfo.phone ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}>
                    <MaterialIcons name="phone" size={16} color="#0EA5E9" />
                  </Pressable>
                ) : null}
              </View>
            )}
            {patientCoords && (
              <Pressable
                onPress={() => {
                  const url = `https://www.google.com/maps/dir/?api=1&destination=${patientCoords.latitude},${patientCoords.longitude}`;
                  Linking.openURL(url);
                }}
                style={styles.navOverlayBtn}
              >
                <MaterialIcons name="navigation" size={14} color="#FFF" />
                <ThemedText style={styles.navOverlayText}>Navigate</ThemedText>
              </Pressable>
            )}
          </View>

          {/* Legend */}
          <View style={[styles.mapLegend, { backgroundColor: cardBg + 'DD' }]}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#0EA5E9' }]} />
              <ThemedText style={[styles.legendText, { color: subtleText }]}>You</ThemedText>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
              <ThemedText style={[styles.legendText, { color: subtleText }]}>Patient</ThemedText>
            </View>
          </View>

          {/* Quick status update floating button */}
          {canUpdate && nextStatus && (
            <Pressable
              onPress={() => handleStatusUpdate(nextStatus)}
              disabled={updating}
              style={({ pressed }) => [styles.floatingBtn, pressed && { opacity: 0.8 }]}
            >
              <MaterialIcons name="update" size={18} color="#FFF" />
              <ThemedText style={styles.floatingBtnText}>
                → {nextStatus.replace(/_/g, ' ').toUpperCase()}
              </ThemedText>
            </Pressable>
          )}
        </View>
      ) : (
        /* ═══════════ STATUS TAB ═══════════ */
        <ScrollView contentContainerStyle={styles.statusScroll} showsVerticalScrollIndicator={false}>
          {/* Current status card */}
          <View style={[styles.statusCard, { backgroundColor: st.color + '15', borderColor: st.color + '30' }]}>
            <MaterialIcons name={st.icon as any} size={32} color={st.color} />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <ThemedText style={[styles.statusCardLabel, { color: st.color }]}>{st.label}</ThemedText>
              <ThemedText style={[styles.statusCardSub, { color: st.color + 'AA' }]}>
                {distanceText ? `${distanceText} from patient` : 'Active emergency'}
              </ThemedText>
            </View>
          </View>

          {/* Timeline */}
          <View style={[styles.timelineCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <ThemedText style={[styles.sectionTitle, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
              Emergency Progress
            </ThemedText>
            {statusFlow.map((step, i) => {
              const stepIdx = statusFlow.indexOf(currentStatus);
              const done = i <= stepIdx;
              const active = i === stepIdx;
              const meta = STATUS_LABELS[step] || STATUS_LABELS.assigned;
              const col = done ? '#10B981' : (isDark ? '#475569' : '#CBD5E1');
              return (
                <View key={step}>
                  <View style={styles.timelineItem}>
                    <View style={[styles.timelineNode, { backgroundColor: done ? '#10B981' : 'transparent', borderColor: col }]}>
                      {done ? (
                        <MaterialIcons name="check" size={14} color="#FFF" />
                      ) : (
                        <MaterialIcons name={meta.icon as any} size={14} color={col} />
                      )}
                    </View>
                    <View style={{ flex: 1, paddingTop: 2 }}>
                      <ThemedText style={[styles.timelineLabel, { color: done ? '#10B981' : subtleText, fontWeight: active ? '800' : '500' }]}>
                        {meta.label}
                      </ThemedText>
                    </View>
                    {active && <View style={[styles.activePulse, { backgroundColor: meta.color + '30' }]}>
                      <ThemedText style={{ color: meta.color, fontSize: 10, fontWeight: '700', fontFamily: Fonts.sans }}>CURRENT</ThemedText>
                    </View>}
                  </View>
                  {i < statusFlow.length - 1 && (
                    <View style={[styles.timelineConnector, { backgroundColor: i < stepIdx ? '#10B981' : (isDark ? '#334155' : '#E2E8F0') }]} />
                  )}
                </View>
              );
            })}
          </View>

          {/* Next action */}
          {canUpdate && nextStatus && (
            <View style={[styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <ThemedText style={[styles.sectionTitle, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
                Next Step
              </ThemedText>
              <ThemedText style={[styles.actionDesc, { color: subtleText }]}>
                Update the emergency status to:
              </ThemedText>
              <View style={[styles.nextBadge, { backgroundColor: (STATUS_LABELS[nextStatus]?.color || '#0EA5E9') + '15' }]}>
                <MaterialIcons name={(STATUS_LABELS[nextStatus]?.icon as any) || 'update'} size={20} color={STATUS_LABELS[nextStatus]?.color || '#0EA5E9'} />
                <ThemedText style={[styles.nextBadgeText, { color: STATUS_LABELS[nextStatus]?.color || '#0EA5E9' }]}>
                  {nextStatus.replace(/_/g, ' ').toUpperCase()}
                </ThemedText>
              </View>
              <AppButton
                label={`Update to ${(STATUS_LABELS[nextStatus]?.label || nextStatus).toUpperCase()}`}
                onPress={() => handleStatusUpdate(nextStatus)}
                variant="primary"
                fullWidth
                disabled={updating}
                style={{ marginTop: 12 }}
              />
            </View>
          )}

          {/* Patient info */}
          {patientInfo && (
            <View style={[styles.infoCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <MaterialIcons name="person" size={18} color="#059669" />
                </View>
                <ThemedText style={[styles.sectionTitle, { color: isDark ? '#E2E8F0' : '#1E293B', marginBottom: 0, marginLeft: 10 }]}>
                  Patient
                </ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={[styles.infoLabel, { color: subtleText }]}>Name</ThemedText>
                <ThemedText style={[styles.infoValue, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
                  {patientInfo.full_name}
                </ThemedText>
              </View>
              {patientInfo.phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${patientInfo.phone}`)}>
                  <View style={styles.infoRow}>
                    <ThemedText style={[styles.infoLabel, { color: subtleText }]}>Phone</ThemedText>
                    <ThemedText style={styles.phoneLink}>{patientInfo.phone}</ThemedText>
                  </View>
                </Pressable>
              )}
              {patientCoords && (
                <View style={styles.infoRow}>
                  <ThemedText style={[styles.infoLabel, { color: subtleText }]}>Location</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: isDark ? '#F1F5F9' : '#0F172A', fontSize: 13 }]}>
                    {formatCoords(patientCoords.latitude, patientCoords.longitude)}
                  </ThemedText>
                </View>
              )}
            </View>
          )}

          {/* Location tracking toggle */}
          <Pressable
            onPress={() => setLocationTracking(!locationTracking)}
            style={[styles.trackingRow, { backgroundColor: cardBg, borderColor: cardBorder }]}
          >
            <MaterialIcons
              name={locationTracking ? 'location-on' : 'location-off'}
              size={22}
              color={locationTracking ? '#10B981' : '#6B7280'}
            />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <ThemedText style={[styles.trackingLabel, { color: isDark ? '#E2E8F0' : '#1E293B' }]}>
                {locationTracking ? 'Location Sharing On' : 'Location Sharing Off'}
              </ThemedText>
              <ThemedText style={[styles.trackingSub, { color: subtleText }]}>
                {locationTracking ? 'Patient can see your live position' : 'Patient cannot track you'}
              </ThemedText>
            </View>
            <View style={[styles.togglePill, { backgroundColor: locationTracking ? '#10B981' : '#6B7280' }]}>
              <View style={[styles.toggleKnob, { alignSelf: locationTracking ? 'flex-end' : 'flex-start' }]} />
            </View>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const { width: SCREEN_W } = Dimensions.get('window');
const isWide = SCREEN_W > 600;

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 12 : 50,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', fontFamily: Fonts.sans },
  headerSub: { fontSize: 12, fontWeight: '600', fontFamily: Fonts.sans },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#0EA5E9',
  },
  tabLabel: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },

  // Map tab
  mapTabWrap: { flex: 1, position: 'relative', overflow: 'hidden' as any },
  mapFull: { flex: 1, width: '100%' as any, minHeight: isWide ? 450 : 350 },
  noMapWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 300 },
  noMapText: { fontSize: 14, fontFamily: Fonts.sans },

  mapOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    maxWidth: isWide ? 360 : undefined,
  },
  overlayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overlayText: { flex: 1, fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans },
  navOverlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  navOverlayText: { color: '#FFF', fontSize: 12, fontWeight: '700', fontFamily: Fonts.sans },

  mapLegend: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, fontFamily: Fonts.sans },

  floatingBtn: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#0EA5E9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  floatingBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800', fontFamily: Fonts.sans },

  // Status tab
  statusScroll: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 640,
    alignSelf: 'center' as any,
    width: '100%' as any,
  },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  statusCardLabel: { fontSize: 17, fontWeight: '800', fontFamily: Fonts.sans },
  statusCardSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },

  timelineCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans, marginBottom: 14 },

  timelineItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  timelineNode: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  timelineLabel: { fontSize: 14, fontFamily: Fonts.sans },
  timelineConnector: { width: 2, height: 16, marginLeft: 13, marginBottom: 6 },
  activePulse: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },

  actionCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  actionDesc: { fontSize: 13, fontFamily: Fonts.sans, marginBottom: 8 },
  nextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  nextBadgeText: { fontSize: 15, fontWeight: '700', fontFamily: Fonts.sans },

  infoCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  infoRow: { marginBottom: 10 },
  infoLabel: { fontSize: 11, fontFamily: Fonts.sans, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  infoValue: { fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans },
  phoneLink: { fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans, color: '#0EA5E9', textDecorationLine: 'underline' },

  trackingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  trackingLabel: { fontSize: 14, fontWeight: '600', fontFamily: Fonts.sans },
  trackingSub: { fontSize: 11, fontFamily: Fonts.sans, marginTop: 2 },
  togglePill: { width: 44, height: 24, borderRadius: 12, padding: 2, justifyContent: 'center' },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF' },
});
