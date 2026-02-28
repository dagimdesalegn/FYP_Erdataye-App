import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signOut } from '@/utils/auth';
import { EmergencyRequest, normalizeEmergency } from '@/utils/emergency';
import { getMedicalProfile, MedicalProfile, UserProfile } from '@/utils/profile';
import { supabase } from '@/utils/supabase';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

/* ─── Types ───────────────────────────────────────────────────── */

interface EmergencyWithPatient extends EmergencyRequest {
  patient_profile?: UserProfile;
  patient_medical?: MedicalProfile;
}

type StatusFilter = 'all' | 'active' | 'at_hospital' | 'completed';

const STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',
  assigned: '#3B82F6',
  en_route: '#8B5CF6',
  arrived: '#10B981',
  at_hospital: '#06B6D4',
  completed: '#6B7280',
  cancelled: '#EF4444',
};

const TYPE_COLORS: Record<string, string> = {
  accident: '#DC2626',
  cardiac: '#EF4444',
  medical: '#3B82F6',
  maternity: '#EC4899',
  fire: '#F97316',
  other: '#6B7280',
};

/* ─── Component ───────────────────────────────────────────────── */

export default function HospitalDashboard() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { user, setUser } = useAppState();

  const [emergencies, setEmergencies] = useState<EmergencyWithPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmergency, setSelectedEmergency] = useState<EmergencyWithPatient | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const cardBg = isDark ? '#1E2028' : '#FFFFFF';
  const cardBorder = isDark ? '#2D3039' : '#E5E7EB';
  const inputBg = isDark ? '#1E2028' : '#F9FAFB';
  const inputBorder = isDark ? '#2D3039' : '#E5E7EB';
  const subText = isDark ? '#94A3B8' : '#64748B';

  /* ─── Data fetching ─────────────────────────────────────────── */

  const fetchEmergencies = useCallback(async () => {
    try {
      const { data: emergencyData, error: emergencyError } = await supabase
        .from('emergency_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (emergencyError) throw emergencyError;

      if (!emergencyData || emergencyData.length === 0) {
        setEmergencies([]);
        return;
      }

      const enriched = await Promise.all(
        emergencyData.map(async (raw) => {
          const emergency = normalizeEmergency(raw);
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', emergency.patient_id)
            .single();
          const { profile: medical } = await getMedicalProfile(emergency.patient_id);

          return {
            ...emergency,
            patient_profile: profile as UserProfile | undefined,
            patient_medical: medical ?? undefined,
          } as EmergencyWithPatient;
        })
      );

      setEmergencies(enriched);
    } catch (error) {
      console.error('Error fetching emergencies:', error);
      Alert.alert('Error', 'Failed to load emergency requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const updateStatus = async (emergencyId: string, newStatus: EmergencyRequest['status']) => {
    try {
      const { error } = await supabase
        .from('emergency_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', emergencyId);

      if (error) throw error;
      Alert.alert('Success', `Status updated to ${newStatus.replace('_', ' ')}`);
      fetchEmergencies();
      setModalVisible(false);
    } catch {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  useEffect(() => {
    fetchEmergencies();
    const channel = supabase
      .channel('hospital_emergency_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_requests' }, () => fetchEmergencies())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [fetchEmergencies]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchEmergencies(); }, [fetchEmergencies]);

  const handleLogout = async () => {
    setProfileVisible(false);
    const { error: logoutErr } = await signOut();
    if (!logoutErr) { setUser(null); router.replace('/'); }
    else Alert.alert('Error', 'Failed to sign out');
  };

  const formatDateTime = (d: string) => {
    try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };

  /* ─── Computed ──────────────────────────────────────────────── */

  const counts = {
    all: emergencies.length,
    active: emergencies.filter((e) => ['pending', 'assigned', 'en_route', 'arrived'].includes(e.status)).length,
    at_hospital: emergencies.filter((e) => e.status === 'at_hospital').length,
    completed: emergencies.filter((e) => e.status === 'completed').length,
    cancelled: emergencies.filter((e) => e.status === 'cancelled').length,
    pending: emergencies.filter((e) => e.status === 'pending').length,
  };

  const filtered = emergencies.filter((e) => {
    if (statusFilter === 'active') return ['pending', 'assigned', 'en_route', 'arrived'].includes(e.status);
    if (statusFilter === 'at_hospital') return e.status === 'at_hospital';
    if (statusFilter === 'completed') return ['completed', 'cancelled'].includes(e.status);
    return true;
  }).filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.patient_profile?.full_name ?? '').toLowerCase().includes(q) ||
      e.emergency_type.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.status.toLowerCase().includes(q)
    );
  });

  /* ─── Web-only guard ────────────────────────────────────────── */

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.bg, { backgroundColor: colors.background }]}>
        <View style={styles.webOnlyWrap}>
          <MaterialIcons name="desktop-windows" size={52} color="#DC2626" />
          <ThemedText style={[styles.webOnlyTitle, { color: colors.text }]}>Hospital dashboard is available on web only.</ThemedText>
          <ThemedText style={[styles.webOnlySub, { color: subText }]}>Open this app in a browser to access hospital operations.</ThemedText>
        </View>
      </View>
    );
  }

  /* ─── Stat cards ────────────────────────────────────────────── */

  const statCards = [
    { label: 'Total', count: counts.all, icon: 'list-alt' as const, color: '#6366F1' },
    { label: 'Pending', count: counts.pending, icon: 'hourglass-empty' as const, color: '#F59E0B' },
    { label: 'Active (In Progress)', count: counts.active, icon: 'local-shipping' as const, color: '#8B5CF6' },
    { label: 'At Hospital', count: counts.at_hospital, icon: 'local-hospital' as const, color: '#06B6D4' },
    { label: 'Completed', count: counts.completed, icon: 'check-circle' as const, color: '#10B981' },
    { label: 'Cancelled', count: counts.cancelled, icon: 'cancel' as const, color: '#EF4444' },
  ];

  /* ─── Card renderer ─────────────────────────────────────────── */

  const renderEmergencyCard = ({ item }: { item: EmergencyWithPatient }) => {
    const statusColor = STATUS_COLORS[item.status] ?? '#6B7280';
    const typeColor = TYPE_COLORS[item.emergency_type] ?? '#6B7280';
    return (
      <Pressable
        style={[styles.itemCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
        onPress={() => { setSelectedEmergency(item); setModalVisible(true); }}
      >
        {/* Header: status + type badges */}
        <View style={styles.cardHeader}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <ThemedText style={[styles.badgeText, { color: statusColor }]}>{item.status.replace('_', ' ')}</ThemedText>
          </View>
          <View style={[styles.typeBadge, { backgroundColor: typeColor + '18' }]}>
            <ThemedText style={[styles.badgeText, { color: typeColor }]}>{item.emergency_type || 'medical'}</ThemedText>
          </View>
        </View>

        {/* Patient info */}
        <View style={styles.cardBody}>
          <View style={[styles.avatar, { backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.08)' }]}>
            <MaterialIcons name="person" size={22} color="#DC2626" />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>{item.patient_profile?.full_name || 'Unknown Patient'}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>{item.patient_profile?.phone || 'No phone'}</ThemedText>
          </View>
          <MaterialIcons name="chevron-right" size={22} color={subText} />
        </View>

        {/* Footer details */}
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          {item.latitude !== 0 && (
            <View style={styles.footerItem}>
              <MaterialIcons name="location-on" size={14} color={subText} />
              <ThemedText style={[styles.footerText, { color: subText }]}>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</ThemedText>
            </View>
          )}
          <View style={styles.footerItem}>
            <MaterialIcons name="access-time" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>{formatDateTime(item.created_at)}</ThemedText>
          </View>
        </View>

        {item.description ? (
          <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
            <ThemedText style={[styles.descText, { color: subText }]} numberOfLines={2}>{item.description}</ThemedText>
          </View>
        ) : null}
      </Pressable>
    );
  };

  /* ─── Filter chips ──────────────────────────────────────────── */

  const renderFilterChip = (filter: StatusFilter, label: string, count: number) => {
    const isActive = statusFilter === filter;
    return (
      <Pressable key={filter} onPress={() => setStatusFilter(filter)}
        style={[styles.chip, { backgroundColor: isActive ? '#DC2626' : isDark ? '#1E2028' : '#F3F4F6', borderColor: isActive ? '#DC2626' : cardBorder }]}>
        <ThemedText style={[styles.chipText, { color: isActive ? '#FFF' : colors.text }]}>{label} ({count})</ThemedText>
      </Pressable>
    );
  };

  /* ─── Main render ────────────────────────────────────────────── */

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader title="Erdataya Hospital" onProfilePress={() => setProfileVisible(true)} />

      <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>
          {/* Page header */}
          <View style={styles.pageHeader}>
            <ThemedText style={[styles.pageTitle, { color: colors.text }]}>Hospital Dashboard</ThemedText>
            <ThemedText style={[styles.pageSub, { color: subText }]}>Monitor incoming emergencies and manage patient arrivals</ThemedText>
          </View>

          {/* Stat cards */}
          <View style={styles.statsGrid}>
            {statCards.map((stat) => (
              <View key={stat.label} style={[styles.statCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                <View style={[styles.statIcon, { backgroundColor: stat.color + '15' }]}>
                  <MaterialIcons name={stat.icon} size={20} color={stat.color} />
                </View>
                <ThemedText style={[styles.statCount, { color: colors.text }]}>{stat.count}</ThemedText>
                <ThemedText style={[styles.statLabel, { color: subText }]}>{stat.label}</ThemedText>
              </View>
            ))}
          </View>

          {/* Search bar */}
          <View style={[styles.searchWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
            <MaterialIcons name="search" size={20} color={subText} />
            <TextInput style={[styles.searchInput, { color: colors.text }]} placeholder="Search by patient, type, or status..." placeholderTextColor={subText} value={search} onChangeText={setSearch} />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}><MaterialIcons name="close" size={18} color={subText} /></Pressable>
            )}
          </View>

          {/* Filter chips */}
          <View style={styles.filterRow}>
            {renderFilterChip('all', 'All', counts.all)}
            {renderFilterChip('active', 'Active', counts.active)}
            {renderFilterChip('at_hospital', 'At Hospital', counts.at_hospital)}
            {renderFilterChip('completed', 'Resolved', counts.completed + counts.cancelled)}
          </View>

          {/* Emergency list */}
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#DC2626" />
              <ThemedText style={[styles.loadingText, { color: subText }]}>Loading emergencies...</ThemedText>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={renderEmergencyCard}
              scrollEnabled={false}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#DC2626" />}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <MaterialIcons name={search ? 'search-off' : 'check-circle'} size={48} color={subText} />
                  <ThemedText style={[styles.emptyText, { color: subText }]}>
                    {search ? 'No emergencies match your search' : 'No emergencies found'}
                  </ThemedText>
                  {!search && <ThemedText style={[styles.emptySub, { color: subText }]}>Pull down to refresh</ThemedText>}
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      {/* Patient Details Modal */}
      <Modal animationType="fade" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
          <Pressable style={[styles.modalContent, { backgroundColor: isDark ? '#1E2028' : '#FFFFFF' }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Modal header */}
              <View style={styles.modalHeader}>
                <ThemedText style={[styles.modalTitle, { color: colors.text }]}>Patient Details</ThemedText>
                <Pressable onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                  <MaterialIcons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              {selectedEmergency && (
                <>
                  {/* Patient Info Section */}
                  <View style={[styles.section, { borderColor: cardBorder }]}>
                    <View style={styles.sectionHeader}>
                      <MaterialIcons name="person" size={18} color="#DC2626" />
                      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Patient Information</ThemedText>
                    </View>
                    <InfoRow label="Name" value={selectedEmergency.patient_profile?.full_name} c={colors.text} s={subText} />
                    <InfoRow label="Phone" value={selectedEmergency.patient_profile?.phone} c={colors.text} s={subText} />
                  </View>

                  {/* Medical Info Section */}
                  {selectedEmergency.patient_medical && (
                    <View style={[styles.section, { borderColor: cardBorder }]}>
                      <View style={styles.sectionHeader}>
                        <MaterialIcons name="medical-services" size={18} color="#DC2626" />
                        <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Medical Information</ThemedText>
                      </View>
                      <InfoRow label="Blood Type" value={selectedEmergency.patient_medical.blood_type} c={colors.text} s={subText} highlight />
                      <InfoRow label="Allergies" value={selectedEmergency.patient_medical.allergies || 'None'} c={colors.text} s={subText} />
                      <InfoRow label="Medical Conditions" value={selectedEmergency.patient_medical.medical_conditions || 'None'} c={colors.text} s={subText} />
                      <InfoRow label="Emergency Contact" value={selectedEmergency.patient_medical.emergency_contact_name} c={colors.text} s={subText} />
                      <InfoRow label="Emergency Phone" value={selectedEmergency.patient_medical.emergency_contact_phone} c={colors.text} s={subText} />
                    </View>
                  )}

                  {/* Emergency Details Section */}
                  <View style={[styles.section, { borderColor: cardBorder }]}>
                    <View style={styles.sectionHeader}>
                      <MaterialIcons name="warning" size={18} color="#F59E0B" />
                      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Emergency Details</ThemedText>
                    </View>
                    <InfoRow label="Type" value={selectedEmergency.emergency_type} c={colors.text} s={subText} />
                    <InfoRow label="Description" value={selectedEmergency.description} c={colors.text} s={subText} />
                    <InfoRow label="Location" value={selectedEmergency.latitude !== 0 ? `${selectedEmergency.latitude.toFixed(6)}, ${selectedEmergency.longitude.toFixed(6)}` : 'Unknown'} c={colors.text} s={subText} />
                    <InfoRow label="Status" value={selectedEmergency.status.replace('_', ' ')} c={colors.text} s={subText} />
                    <InfoRow label="Created" value={formatDateTime(selectedEmergency.created_at)} c={colors.text} s={subText} />
                  </View>

                  {/* Action buttons */}
                  {!['completed', 'cancelled'].includes(selectedEmergency.status) && (
                    <View style={styles.actionRow}>
                      {selectedEmergency.status !== 'at_hospital' && (
                        <Pressable style={[styles.actionBtn, { backgroundColor: '#06B6D4' }]} onPress={() => updateStatus(selectedEmergency.id, 'at_hospital')}>
                          <MaterialIcons name="local-hospital" size={18} color="#FFF" />
                          <ThemedText style={styles.actionBtnText}>Mark at Hospital</ThemedText>
                        </Pressable>
                      )}
                      <Pressable style={[styles.actionBtn, { backgroundColor: '#10B981' }]} onPress={() => updateStatus(selectedEmergency.id, 'completed')}>
                        <MaterialIcons name="check-circle" size={18} color="#FFF" />
                        <ThemedText style={styles.actionBtnText}>Mark Completed</ThemedText>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Profile Dropdown */}
      <Modal visible={profileVisible} animationType="fade" transparent onRequestClose={() => setProfileVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setProfileVisible(false)}>
          <View style={[styles.dropdownCard, { backgroundColor: isDark ? '#1E2028' : '#FFFFFF', borderColor: cardBorder }]}>
            <View style={styles.dropdownHeader}>
              <View style={[styles.dropdownAvatar, { backgroundColor: isDark ? 'rgba(6,182,212,0.15)' : 'rgba(6,182,212,0.08)' }]}>
                <MaterialIcons name="local-hospital" size={28} color="#06B6D4" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.dropdownName, { color: colors.text }]}>{user?.fullName || 'Hospital'}</ThemedText>
                <ThemedText style={[styles.dropdownPhone, { color: subText }]}>{user?.phone || ''}</ThemedText>
                <View style={[styles.dropdownRoleBadge, { backgroundColor: isDark ? '#D1FAE533' : '#D1FAE5' }]}>
                  <ThemedText style={[styles.dropdownRoleLabel, { color: '#059669' }]}>HOSPITAL</ThemedText>
                </View>
              </View>
            </View>
            <View style={[styles.dropdownDivider, { backgroundColor: cardBorder }]} />
            <Pressable onPress={handleLogout} style={({ pressed }) => [styles.dropdownSignOut, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="logout" size={20} color="#DC2626" />
              <ThemedText style={styles.dropdownSignOutText}>Sign Out</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ─── InfoRow helper ────────────────────────────────────────────── */

function InfoRow({ label, value, c, s, highlight }: { label: string; value?: string | null; c: string; s: string; highlight?: boolean }) {
  return (
    <View style={infoStyles.row}>
      <ThemedText style={[infoStyles.label, { color: s }]}>{label}</ThemedText>
      <ThemedText style={[infoStyles.value, { color: c }, highlight && infoStyles.highlight]}>{value || 'N/A'}</ThemedText>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: { marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 2, fontFamily: Fonts.sans },
  value: { fontSize: 15, fontFamily: Fonts.sans },
  highlight: { fontSize: 18, fontWeight: '700', color: '#DC2626' },
});

/* ─── Styles ────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  bg: { flex: 1 },
  scrollOuter: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  container: { paddingHorizontal: 16, ...(Platform.OS === 'web' ? { maxWidth: 900, alignSelf: 'center' as any, width: '100%' } : {}) },

  webOnlyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  webOnlyTitle: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans, textAlign: 'center' },
  webOnlySub: { fontSize: 14, fontFamily: Fonts.sans, textAlign: 'center' },

  pageHeader: { marginTop: 20, marginBottom: 16 },
  pageTitle: { fontSize: 26, fontWeight: '800', fontFamily: Fonts.sans, letterSpacing: -0.5 },
  pageSub: { fontSize: 14, fontFamily: Fonts.sans, marginTop: 2 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { flexBasis: '30%' as any, minWidth: 130, flexGrow: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 14, borderWidth: 1, gap: 4 },
  statIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statCount: { fontSize: 24, fontWeight: '800', fontFamily: Fonts.sans },
  statLabel: { fontSize: 11, fontWeight: '600', fontFamily: Fonts.sans, textAlign: 'center' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 46, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: Fonts.sans, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '700', fontFamily: Fonts.sans },

  itemCard: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: '800', fontFamily: Fonts.sans, textTransform: 'uppercase', letterSpacing: 0.5 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  cardBody: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', fontFamily: Fonts.sans },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans },
  cardFooter: { flexDirection: 'row', gap: 20, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1 },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 12, fontFamily: Fonts.sans },
  descText: { fontSize: 12, fontStyle: 'italic', fontFamily: Fonts.sans },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, fontFamily: Fonts.sans },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: Fonts.sans },
  emptySub: { fontSize: 12, fontFamily: Fonts.sans },
  listContent: { paddingBottom: 20 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '92%', maxWidth: 500, maxHeight: '85%', borderRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', fontFamily: Fonts.sans, flex: 1 },
  closeBtn: { padding: 4, marginLeft: 8 },
  section: { marginBottom: 20, paddingBottom: 16, borderBottomWidth: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  actionBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', fontFamily: Fonts.sans },

  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 90, paddingRight: 16 },
  dropdownCard: { width: 260, borderRadius: 16, borderWidth: 1, paddingVertical: 16, paddingHorizontal: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10 },
  dropdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dropdownAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dropdownName: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans },
  dropdownPhone: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
  dropdownRoleBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  dropdownRoleLabel: { fontSize: 10, fontWeight: '800', fontFamily: Fonts.sans, letterSpacing: 0.5 },
  dropdownDivider: { height: 1, marginVertical: 12 },
  dropdownSignOut: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  dropdownSignOutText: { fontSize: 15, fontWeight: '700', fontFamily: Fonts.sans, color: '#DC2626' },
});
