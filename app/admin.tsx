import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signOut } from '@/utils/auth';
import { Ambulance, EmergencyRequest, Hospital, normalizeEmergency } from '@/utils/emergency';
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

interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: 'patient' | 'driver' | 'admin' | 'hospital';
  hospital_id: string | null;
  created_at: string;
  updated_at: string;
}

type Tab = 'users' | 'emergencies' | 'ambulances' | 'hospitals';
type FilterRole = 'all' | 'patient' | 'driver' | 'admin' | 'hospital';
type EmergencyFilter = 'all' | 'active' | 'completed' | 'cancelled';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  patient: { bg: '#DBEAFE', text: '#1D4ED8' },
  driver: { bg: '#FEF3C7', text: '#B45309' },
  admin: { bg: '#FCE7F3', text: '#BE185D' },
  hospital: { bg: '#D1FAE5', text: '#059669' },
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',
  assigned: '#3B82F6',
  en_route: '#8B5CF6',
  arrived: '#10B981',
  at_hospital: '#06B6D4',
  completed: '#6B7280',
  cancelled: '#EF4444',
};

/* ─── Component ───────────────────────────────────────────────── */

export default function AdminScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { user, setUser } = useAppState();

  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [profileVisible, setProfileVisible] = useState(false);

  const [users, setUsers] = useState<Profile[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);

  const [filterRole, setFilterRole] = useState<FilterRole>('all');
  const [emergencyFilter, setEmergencyFilter] = useState<EmergencyFilter>('all');

  const cardBg = isDark ? '#1E2028' : '#FFFFFF';
  const cardBorder = isDark ? '#2D3039' : '#E5E7EB';
  const inputBg = isDark ? '#1E2028' : '#F9FAFB';
  const inputBorder = isDark ? '#2D3039' : '#E5E7EB';
  const subText = isDark ? '#94A3B8' : '#64748B';

  /* ─── data fetching ───────────────────────────────────────── */

  const fetchAll = useCallback(async () => {
    try {
      const [profileRes, emergencyRes, ambulanceRes, hospitalRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('emergency_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('ambulances').select('*').order('created_at', { ascending: false }),
        supabase.from('hospitals').select('*').order('created_at', { ascending: false }),
      ]);
      if (profileRes.data) setUsers(profileRes.data as Profile[]);
      if (emergencyRes.data) setEmergencies(emergencyRes.data.map(normalizeEmergency));
      if (ambulanceRes.data) setAmbulances(ambulanceRes.data as Ambulance[]);
      if (hospitalRes.data) setHospitals(hospitalRes.data as Hospital[]);
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('admin_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_requests' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ambulances' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hospitals' }, () => fetchAll())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [fetchAll]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchAll(); }, [fetchAll]);

  const handleLogout = async () => {
    setProfileVisible(false);
    const { error: logoutErr } = await signOut();
    if (!logoutErr) { setUser(null); router.replace('/'); }
    else Alert.alert('Error', 'Failed to sign out');
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  };

  const formatDateTime = (d: string) => {
    try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };

  /* ─── computed ────────────────────────────────────────────── */

  const roleCounts = {
    all: users.length,
    patient: users.filter((u) => u.role === 'patient').length,
    driver: users.filter((u) => u.role === 'driver').length,
    admin: users.filter((u) => u.role === 'admin').length,
    hospital: users.filter((u) => u.role === 'hospital').length,
  };

  const activeEmergencies = emergencies.filter((e) => !['completed', 'cancelled'].includes(e.status));
  const availableAmbulances = ambulances.filter((a) => a.is_available);

  const filteredUsers = users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.full_name ?? '').toLowerCase().includes(q) || (u.phone ?? '').toLowerCase().includes(q);
  });

  const filteredEmergencies = emergencies.filter((e) => {
    if (emergencyFilter === 'active') return !['completed', 'cancelled'].includes(e.status);
    if (emergencyFilter === 'completed') return e.status === 'completed';
    if (emergencyFilter === 'cancelled') return e.status === 'cancelled';
    return true;
  }).filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.emergency_type.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q) || e.status.toLowerCase().includes(q);
  });

  const filteredAmbulances = ambulances.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.vehicle_number.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q);
  });

  const filteredHospitals = hospitals.filter((h) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return h.name.toLowerCase().includes(q) || h.address?.toLowerCase().includes(q);
  });

  /* ─── web-only guard ──────────────────────────────────────── */

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.bg, { backgroundColor: colors.background }]}>
        <View style={styles.webOnlyWrap}>
          <MaterialIcons name="desktop-windows" size={52} color="#DC2626" />
          <ThemedText style={[styles.webOnlyTitle, { color: colors.text }]}>Admin dashboard is available on web only.</ThemedText>
          <ThemedText style={[styles.webOnlySub, { color: subText }]}>Open this app in a browser to manage users.</ThemedText>
        </View>
      </View>
    );
  }

  /* ─── stat cards ──────────────────────────────────────────── */

  const statCards = [
    { label: 'Total Users', count: roleCounts.all, icon: 'people' as const, color: '#6366F1' },
    { label: 'Patients', count: roleCounts.patient, icon: 'person' as const, color: '#3B82F6' },
    { label: 'Drivers', count: roleCounts.driver, icon: 'local-shipping' as const, color: '#F59E0B' },
    { label: 'Active Emergencies', count: activeEmergencies.length, icon: 'warning' as const, color: '#DC2626' },
    { label: 'Ambulances', count: ambulances.length, icon: 'directions-car' as const, color: '#8B5CF6' },
    { label: 'Available', count: availableAmbulances.length, icon: 'check-circle' as const, color: '#10B981' },
    { label: 'Hospitals', count: hospitals.length, icon: 'local-hospital' as const, color: '#06B6D4' },
    { label: 'Admins', count: roleCounts.admin, icon: 'admin-panel-settings' as const, color: '#EC4899' },
  ];

  /* ─── renderers ───────────────────────────────────────────── */

  const renderUserCard = ({ item }: { item: Profile }) => {
    const roleStyle = ROLE_COLORS[item.role] ?? ROLE_COLORS.patient;
    return (
      <View style={[styles.itemCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.cardRow}>
          <View style={[styles.avatar, { backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.08)' }]}>
            <MaterialIcons
              name={item.role === 'driver' ? 'local-shipping' : item.role === 'admin' ? 'admin-panel-settings' : item.role === 'hospital' ? 'local-hospital' : 'person'}
              size={22} color="#DC2626" />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>{item.full_name || 'No Name'}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>{item.phone || 'No phone'}</ThemedText>
          </View>
          <View style={[styles.badge, { backgroundColor: isDark ? roleStyle.bg + '33' : roleStyle.bg }]}>
            <ThemedText style={[styles.badgeText, { color: roleStyle.text }]}>{item.role}</ThemedText>
          </View>
        </View>
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          <View style={styles.footerItem}>
            <MaterialIcons name="phone" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>{item.phone || 'N/A'}</ThemedText>
          </View>
          <View style={styles.footerItem}>
            <MaterialIcons name="calendar-today" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>{formatDate(item.created_at)}</ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderEmergencyCard = ({ item }: { item: EmergencyRequest }) => {
    const statusColor = STATUS_COLORS[item.status] ?? '#6B7280';
    const patientProfile = users.find((u) => u.id === item.patient_id);
    return (
      <View style={[styles.itemCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.cardRow}>
          <View style={[styles.avatar, { backgroundColor: statusColor + '18' }]}>
            <MaterialIcons name="warning" size={22} color={statusColor} />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
              {patientProfile?.full_name || item.patient_id.slice(0, 8) + '...'}
            </ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {item.emergency_type.charAt(0).toUpperCase() + item.emergency_type.slice(1)} — {item.description || 'No description'}
            </ThemedText>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <ThemedText style={[styles.badgeText, { color: statusColor }]}>{item.status.replace('_', ' ')}</ThemedText>
          </View>
        </View>
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
      </View>
    );
  };

  const renderAmbulanceCard = ({ item }: { item: Ambulance }) => {
    const driverProfile = users.find((u) => u.id === item.current_driver_id);
    const isAvail = item.is_available;
    return (
      <View style={[styles.itemCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.cardRow}>
          <View style={[styles.avatar, { backgroundColor: isAvail ? '#D1FAE520' : '#FEE2E220' }]}>
            <MaterialIcons name="directions-car" size={22} color={isAvail ? '#10B981' : '#EF4444'} />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.text }]}>{item.vehicle_number}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>
              {driverProfile ? 'Driver: ' + driverProfile.full_name : 'No driver assigned'}
              {item.type ? ' · ' + item.type : ''}
            </ThemedText>
          </View>
          <View style={[styles.badge, { backgroundColor: isAvail ? '#D1FAE5' : '#FEE2E2' }]}>
            <ThemedText style={[styles.badgeText, { color: isAvail ? '#059669' : '#DC2626' }]}>
              {isAvail ? 'Available' : 'Busy'}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
          <View style={styles.footerItem}>
            <MaterialIcons name="calendar-today" size={14} color={subText} />
            <ThemedText style={[styles.footerText, { color: subText }]}>{formatDate(item.created_at)}</ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderHospitalCard = ({ item }: { item: Hospital }) => (
    <View style={[styles.itemCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.cardRow}>
        <View style={[styles.avatar, { backgroundColor: isDark ? 'rgba(6,182,212,0.15)' : 'rgba(6,182,212,0.08)' }]}>
          <MaterialIcons name="local-hospital" size={22} color="#06B6D4" />
        </View>
        <View style={styles.cardInfo}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>{item.name}</ThemedText>
          <ThemedText style={[styles.cardSub, { color: subText }]}>{item.address || 'No address'}</ThemedText>
        </View>
      </View>
      <View style={[styles.cardFooter, { borderTopColor: cardBorder }]}>
        <View style={styles.footerItem}>
          <MaterialIcons name="phone" size={14} color={subText} />
          <ThemedText style={[styles.footerText, { color: subText }]}>{item.phone || 'N/A'}</ThemedText>
        </View>
        <View style={styles.footerItem}>
          <MaterialIcons name="calendar-today" size={14} color={subText} />
          <ThemedText style={[styles.footerText, { color: subText }]}>{formatDate(item.created_at)}</ThemedText>
        </View>
      </View>
    </View>
  );

  /* ─── filter chips ────────────────────────────────────────── */

  const renderRoleChip = (role: FilterRole, label: string) => {
    const isActive = filterRole === role;
    return (
      <Pressable key={role} onPress={() => setFilterRole(role)}
        style={[styles.chip, { backgroundColor: isActive ? '#DC2626' : isDark ? '#1E2028' : '#F3F4F6', borderColor: isActive ? '#DC2626' : cardBorder }]}>
        <ThemedText style={[styles.chipText, { color: isActive ? '#FFF' : colors.text }]}>{label} ({roleCounts[role]})</ThemedText>
      </Pressable>
    );
  };

  const renderEmergencyChip = (filter: EmergencyFilter, label: string, count: number) => {
    const isActive = emergencyFilter === filter;
    return (
      <Pressable key={filter} onPress={() => setEmergencyFilter(filter)}
        style={[styles.chip, { backgroundColor: isActive ? '#DC2626' : isDark ? '#1E2028' : '#F3F4F6', borderColor: isActive ? '#DC2626' : cardBorder }]}>
        <ThemedText style={[styles.chipText, { color: isActive ? '#FFF' : colors.text }]}>{label} ({count})</ThemedText>
      </Pressable>
    );
  };

  const getListData = (): any[] => {
    switch (activeTab) {
      case 'users': return filteredUsers;
      case 'emergencies': return filteredEmergencies;
      case 'ambulances': return filteredAmbulances;
      case 'hospitals': return filteredHospitals;
    }
  };

  const getRenderItem = (): any => {
    switch (activeTab) {
      case 'users': return renderUserCard;
      case 'emergencies': return renderEmergencyCard;
      case 'ambulances': return renderAmbulanceCard;
      case 'hospitals': return renderHospitalCard;
    }
  };

  /* ─── main render ─────────────────────────────────────────── */

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader title="Erdataya Admin" onProfilePress={() => setProfileVisible(true)} />

      <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>

          {/* Page title */}
          <View style={styles.pageHeader}>
            <ThemedText style={[styles.pageTitle, { color: colors.text }]}>Admin Dashboard</ThemedText>
            <ThemedText style={[styles.pageSub, { color: subText }]}>Manage users, emergencies, ambulances & hospitals</ThemedText>
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

          {/* Tabs */}
          <View style={[styles.tabBar, { borderColor: cardBorder }]}>
            {([
              { key: 'users', label: 'Users', icon: 'people' },
              { key: 'emergencies', label: 'Emergencies', icon: 'warning' },
              { key: 'ambulances', label: 'Ambulances', icon: 'directions-car' },
              { key: 'hospitals', label: 'Hospitals', icon: 'local-hospital' },
            ] as { key: Tab; label: string; icon: any }[]).map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <Pressable key={tab.key} onPress={() => { setActiveTab(tab.key); setSearch(''); }}
                  style={[styles.tab, isActive && styles.tabActive]}>
                  <MaterialIcons name={tab.icon} size={18} color={isActive ? '#DC2626' : subText} />
                  <ThemedText style={[styles.tabLabel, { color: isActive ? '#DC2626' : subText }, isActive && styles.tabLabelActive]}>
                    {tab.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Search */}
          <View style={[styles.searchWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
            <MaterialIcons name="search" size={20} color={subText} />
            <TextInput style={[styles.searchInput, { color: colors.text }]} placeholder={'Search ' + activeTab + '...'} placeholderTextColor={subText} value={search} onChangeText={setSearch} />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}><MaterialIcons name="close" size={18} color={subText} /></Pressable>
            )}
          </View>

          {/* Filters */}
          {activeTab === 'users' && (
            <View style={styles.filterRow}>
              {renderRoleChip('all', 'All')}
              {renderRoleChip('patient', 'Patients')}
              {renderRoleChip('driver', 'Drivers')}
              {renderRoleChip('hospital', 'Hospital')}
              {renderRoleChip('admin', 'Admins')}
            </View>
          )}
          {activeTab === 'emergencies' && (
            <View style={styles.filterRow}>
              {renderEmergencyChip('all', 'All', emergencies.length)}
              {renderEmergencyChip('active', 'Active', activeEmergencies.length)}
              {renderEmergencyChip('completed', 'Completed', emergencies.filter((e) => e.status === 'completed').length)}
              {renderEmergencyChip('cancelled', 'Cancelled', emergencies.filter((e) => e.status === 'cancelled').length)}
            </View>
          )}

          {/* Data list */}
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#DC2626" />
              <ThemedText style={[styles.loadingText, { color: subText }]}>Loading data...</ThemedText>
            </View>
          ) : (
            <FlatList
              data={getListData()}
              keyExtractor={(item: any) => item.id}
              renderItem={getRenderItem()}
              scrollEnabled={false}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#DC2626" />}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <MaterialIcons name="inbox" size={48} color={subText} />
                  <ThemedText style={[styles.emptyText, { color: subText }]}>
                    {search ? 'No ' + activeTab + ' match your search' : 'No ' + activeTab + ' found'}
                  </ThemedText>
                </View>
              }
            />
          )}
        </View>
      </ScrollView>

      {/* Profile Dropdown */}
      <Modal visible={profileVisible} animationType="fade" transparent onRequestClose={() => setProfileVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setProfileVisible(false)}>
          <View style={[styles.dropdownCard, { backgroundColor: isDark ? '#1E2028' : '#FFFFFF', borderColor: cardBorder }]}>
            <View style={styles.dropdownHeader}>
              <View style={[styles.dropdownAvatar, { backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.08)' }]}>
                <MaterialIcons name="admin-panel-settings" size={28} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.dropdownName, { color: colors.text }]}>{user?.fullName || 'Admin'}</ThemedText>
                <ThemedText style={[styles.dropdownPhone, { color: subText }]}>{user?.phone || ''}</ThemedText>
                <View style={[styles.dropdownRoleBadge, { backgroundColor: isDark ? '#FCE7F333' : '#FCE7F3' }]}>
                  <ThemedText style={[styles.dropdownRoleLabel, { color: '#BE185D' }]}>ADMIN</ThemedText>
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

/* ─── Styles ────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  bg: { flex: 1 },
  scrollOuter: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  container: { paddingHorizontal: 16, ...(Platform.OS === 'web' ? { maxWidth: 1100, alignSelf: 'center' as any, width: '100%' } : {}) },

  webOnlyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  webOnlyTitle: { fontSize: 16, fontWeight: '700', fontFamily: Fonts.sans, textAlign: 'center' },
  webOnlySub: { fontSize: 14, fontFamily: Fonts.sans, textAlign: 'center' },

  pageHeader: { marginTop: 20, marginBottom: 16 },
  pageTitle: { fontSize: 26, fontWeight: '800', fontFamily: Fonts.sans, letterSpacing: -0.5 },
  pageSub: { fontSize: 14, fontFamily: Fonts.sans, marginTop: 2 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: { flexBasis: '23%' as any, minWidth: 140, flexGrow: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 14, borderWidth: 1, gap: 4 },
  statIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statCount: { fontSize: 24, fontWeight: '800', fontFamily: Fonts.sans },
  statLabel: { fontSize: 11, fontWeight: '600', fontFamily: Fonts.sans, textAlign: 'center' },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1, marginBottom: 14, gap: 4 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#DC2626' },
  tabLabel: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },
  tabLabelActive: { fontWeight: '800' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 46, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: Fonts.sans, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '700', fontFamily: Fonts.sans },

  itemCard: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', fontFamily: Fonts.sans },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '800', fontFamily: Fonts.sans, textTransform: 'uppercase', letterSpacing: 0.5 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  cardFooter: { flexDirection: 'row', gap: 20, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1 },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 12, fontFamily: Fonts.sans },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, fontFamily: Fonts.sans },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: Fonts.sans },
  listContent: { paddingBottom: 20 },

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
