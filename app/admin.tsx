import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signOut } from '@/utils/auth';
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
    StyleSheet,
    TextInput,
    View,
} from 'react-native';

interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: 'patient' | 'driver' | 'admin';
  created_at: string;
  updated_at: string;
}

type FilterRole = 'all' | 'patient' | 'driver' | 'admin';

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  patient: { bg: '#DBEAFE', text: '#1D4ED8' },
  driver: { bg: '#FEF3C7', text: '#B45309' },
  admin: { bg: '#FCE7F3', text: '#BE185D' },
};

export default function AdminScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme ?? 'light';
  const isDark = theme === 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { user, setUser } = useAppState();

  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<FilterRole>('all');
  const [error, setError] = useState<string | null>(null);
  const [profileVisible, setProfileVisible] = useState(false);

  const handleProfilePress = () => setProfileVisible(true);

  const handleLogout = async () => {
    setProfileVisible(false);
    const { error: logoutErr } = await signOut();
    if (!logoutErr) {
      setUser(null);
      router.replace('/');
    } else {
      Alert.alert('Error', 'Failed to sign out');
    }
  };

  const fetchUsers = useCallback(async () => {
    try {
      setError(null);
      let query = supabase
        .from('profiles')
        .select('id, full_name, phone, role, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (filterRole !== 'all') {
        query = query.eq('role', filterRole);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setUsers((data as Profile[]) ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterRole]);

  useEffect(() => {
    setLoading(true);
    fetchUsers();
  }, [fetchUsers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (u.full_name ?? '').toLowerCase().includes(q) ||
      (u.phone ?? '').toLowerCase().includes(q)
    );
  });

  const roleCounts = {
    all: users.length,
    patient: users.filter((u) => u.role === 'patient').length,
    driver: users.filter((u) => u.role === 'driver').length,
    admin: users.filter((u) => u.role === 'admin').length,
  };

  const cardBg = isDark ? '#1E2028' : '#FFFFFF';
  const cardBorder = isDark ? '#2D3039' : '#E5E7EB';
  const inputBg = isDark ? '#1E2028' : '#F9FAFB';
  const inputBorder = isDark ? '#2D3039' : '#E5E7EB';
  const subText = isDark ? '#94A3B8' : '#64748B';

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const renderRoleFilter = (role: FilterRole, label: string) => {
    const isActive = filterRole === role;
    return (
      <Pressable
        key={role}
        onPress={() => setFilterRole(role)}
        style={[
          styles.filterChip,
          {
            backgroundColor: isActive ? '#DC2626' : isDark ? '#1E2028' : '#F3F4F6',
            borderColor: isActive ? '#DC2626' : cardBorder,
          },
        ]}
      >
        <ThemedText
          style={[
            styles.filterChipText,
            { color: isActive ? '#FFF' : colors.text },
          ]}
        >
          {label} ({roleCounts[role]})
        </ThemedText>
      </Pressable>
    );
  };

  const renderUserCard = ({ item }: { item: Profile }) => {
    const roleStyle = ROLE_COLORS[item.role] ?? ROLE_COLORS.patient;
    return (
      <View style={[styles.userCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.cardRow}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.08)' },
            ]}
          >
            <MaterialIcons
              name={item.role === 'driver' ? 'local-shipping' : item.role === 'admin' ? 'admin-panel-settings' : 'person'}
              size={22}
              color="#DC2626"
            />
          </View>
          <View style={styles.cardInfo}>
            <ThemedText style={[styles.userName, { color: colors.text }]}>
              {item.full_name || 'No Name'}
            </ThemedText>
            <ThemedText style={[styles.userEmail, { color: subText }]}>{item.phone || 'No phone'}</ThemedText>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: isDark ? `${roleStyle.bg}33` : roleStyle.bg }]}>
            <ThemedText style={[styles.roleText, { color: roleStyle.text }]}>
              {item.role}
            </ThemedText>
          </View>
        </View>

        <View style={[styles.cardDetails, { borderTopColor: cardBorder }]}>
          <View style={styles.detailItem}>
            <MaterialIcons name="phone" size={14} color={subText} />
            <ThemedText style={[styles.detailText, { color: subText }]}>
              {item.phone || 'N/A'}
            </ThemedText>
          </View>
          <View style={styles.detailItem}>
            <MaterialIcons name="calendar-today" size={14} color={subText} />
            <ThemedText style={[styles.detailText, { color: subText }]}>
              {formatDate(item.created_at)}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader title="Erdataye" onProfilePress={handleProfilePress} />

      <View style={styles.container}>
        {/* Stats Row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Total Users', count: roleCounts.all, icon: 'people' as const, color: '#6366F1' },
            { label: 'Patients', count: roleCounts.patient, icon: 'person' as const, color: '#3B82F6' },
            { label: 'Drivers', count: roleCounts.driver, icon: 'local-shipping' as const, color: '#F59E0B' },
            { label: 'Admins', count: roleCounts.admin, icon: 'admin-panel-settings' as const, color: '#EC4899' },
          ].map((stat) => (
            <View
              key={stat.label}
              style={[styles.statCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
            >
              <View style={[styles.statIcon, { backgroundColor: `${stat.color}18` }]}>
                <MaterialIcons name={stat.icon} size={18} color={stat.color} />
              </View>
              <ThemedText style={[styles.statCount, { color: colors.text }]}>{stat.count}</ThemedText>
              <ThemedText style={[styles.statLabel, { color: subText }]}>{stat.label}</ThemedText>
            </View>
          ))}
        </View>

        {/* Search */}
        <View style={[styles.searchWrap, { backgroundColor: inputBg, borderColor: inputBorder }]}>
          <MaterialIcons name="search" size={20} color={subText} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search by name or phone..."
            placeholderTextColor={subText}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <MaterialIcons name="close" size={18} color={subText} />
            </Pressable>
          )}
        </View>

        {/* Role Filters */}
        <View style={styles.filterRow}>
          {renderRoleFilter('all', 'All')}
          {renderRoleFilter('patient', 'Patients')}
          {renderRoleFilter('driver', 'Drivers')}
          {renderRoleFilter('admin', 'Admins')}
        </View>

        {/* Error */}
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: isDark ? '#7F1D1D' : '#FEF2F2' }]}>
            <MaterialIcons name="error-outline" size={18} color="#DC2626" />
            <ThemedText style={{ color: '#DC2626', fontSize: 13, flex: 1 }}>{error}</ThemedText>
            <Pressable onPress={onRefresh}>
              <ThemedText style={{ color: '#DC2626', fontWeight: '700', fontSize: 13 }}>Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {/* User List */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#DC2626" />
            <ThemedText style={[styles.loadingText, { color: subText }]}>Loading users...</ThemedText>
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            renderItem={renderUserCard}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#DC2626" />
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <MaterialIcons name="person-off" size={48} color={subText} />
                <ThemedText style={[styles.emptyText, { color: subText }]}>
                  {search ? 'No users match your search' : 'No users found'}
                </ThemedText>
              </View>
            }
          />
        )}
      </View>

      {/* ===== Admin Profile Dropdown Modal ===== */}
      <Modal
        visible={profileVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setProfileVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setProfileVisible(false)}>
          <View
            style={[
              styles.dropdownCard,
              {
                backgroundColor: isDark ? '#1E2028' : '#FFFFFF',
                borderColor: isDark ? '#2D3039' : '#E5E7EB',
              },
            ]}>
            {/* Profile Header */}
            <View style={styles.dropdownHeader}>
              <View
                style={[
                  styles.dropdownAvatar,
                  {
                    backgroundColor: isDark
                      ? 'rgba(220,38,38,0.15)'
                      : 'rgba(220,38,38,0.08)',
                  },
                ]}>
                <MaterialIcons name="admin-panel-settings" size={28} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.dropdownName, { color: colors.text }]}>
                  {user?.fullName || 'Admin'}
                </ThemedText>
                <ThemedText style={[styles.dropdownPhone, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  {user?.phone || ''}
                </ThemedText>
                <View
                  style={[
                    styles.dropdownRoleBadge,
                    { backgroundColor: isDark ? '#FCE7F333' : '#FCE7F3' },
                  ]}>
                  <ThemedText style={[styles.dropdownRoleText, { color: '#BE185D' }]}>
                    ADMIN
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Divider */}
            <View
              style={[
                styles.dropdownDivider,
                { backgroundColor: isDark ? '#2D3039' : '#E5E7EB' },
              ]}
            />

            {/* Sign Out Button */}
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.dropdownSignOut,
                pressed && { opacity: 0.7 },
              ]}>
              <MaterialIcons name="logout" size={20} color="#DC2626" />
              <ThemedText style={styles.dropdownSignOutText}>Sign Out</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    ...(Platform.OS === 'web' ? { maxWidth: 900, alignSelf: 'center' as any, width: '100%' } : {}),
  },

  /* Stats */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  statCount: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: Fonts.sans,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },

  /* Search */
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.sans,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },

  /* Filter */
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },

  /* User Card */
  userCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  userEmail: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardDetails: {
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  detailText: {
    fontSize: 12,
    fontFamily: Fonts.sans,
  },

  /* States */
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  listContent: {
    paddingBottom: 80,
  },

  /* Error */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },

  /* Profile Dropdown */
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 90,
    paddingRight: 16,
  },
  dropdownCard: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dropdownAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownName: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  dropdownPhone: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    marginTop: 2,
  },
  dropdownRoleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  dropdownRoleText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Fonts.sans,
    letterSpacing: 0.5,
  },
  dropdownDivider: {
    height: 1,
    marginVertical: 12,
  },
  dropdownSignOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  dropdownSignOutText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    color: '#DC2626',
  },
});
