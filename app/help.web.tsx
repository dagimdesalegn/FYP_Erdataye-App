import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getActiveEmergency } from '@/utils/patient';
import { signOut } from '@/utils/auth';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HelpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { user, setUser } = useAppState();
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [directOpen, setDirectOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [activeEmergencyId, setActiveEmergencyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const loadActiveEmergency = async () => {
      if (!user?.id) {
        if (!cancelled) setActiveEmergencyId(null);
        return;
      }

      const { emergency } = await getActiveEmergency(user.id);
      if (!cancelled) {
        setActiveEmergencyId(emergency?.id ?? null);
      }
    };

    void loadActiveEmergency();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const openPatientEmergency = React.useCallback(() => {
    if (!user?.id) {
      router.push('/login');
      return;
    }

    if (activeEmergencyId) {
      router.push(`/patient-emergency-tracking?emergencyId=${activeEmergencyId}`);
      return;
    }

    router.push('/patient-emergency');
  }, [activeEmergencyId, router, user?.id]);

  const handleForMe = () => {
    setHelpOpen(false);
    openPatientEmergency();
  };

  const handleForOther = () => {
    setHelpOpen(false);
    router.push('/patient-emergency');
  };

  const handleCall = (number: string) => {
    Linking.openURL(`tel:${number}`);
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    const { error } = await signOut();
    if (!error) {
      setUser(null);
      router.replace('/');
    }
  };

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader title="ErdAtaye" announcementHref="/modal" />

      {/* Profile Icon - top right */}
      <Pressable
        onPress={() => setProfileOpen(!profileOpen)}
        style={[
          styles.profileIcon,
          {
            backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : 'rgba(220,38,38,0.08)',
            borderColor: isDark ? '#2E3236' : '#E6ECF2',
            top: Math.max(insets.top, 12) + 6,
          },
        ]}
      >
        <MaterialIcons name="person" size={22} color="#DC2626" />
      </Pressable>

      {/* Profile Dropdown */}
      {profileOpen && (
        <View style={[styles.profileDropdown, { top: Math.max(insets.top, 12) + 52, backgroundColor: isDark ? '#1E2028' : '#FFFFFF', borderColor: isDark ? '#2E3236' : '#E6ECF2' }]}>
          <ThemedText style={[styles.profileEmail, { color: isDark ? '#94A3B8' : '#64748B' }]}>{user?.email ?? 'Not signed in'}</ThemedText>
          <Pressable onPress={() => { setProfileOpen(false); router.push('/patient-profile'); }} style={({ pressed }) => [styles.profileMenuItem, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="visibility" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />
            <ThemedText style={[styles.profileMenuText, { color: colors.text }]}>View Profile</ThemedText>
          </Pressable>
          <Pressable onPress={() => { setProfileOpen(false); router.push('/patient-profile'); }} style={({ pressed }) => [styles.profileMenuItem, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="edit" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />
            <ThemedText style={[styles.profileMenuText, { color: colors.text }]}>Edit Profile</ThemedText>
          </Pressable>
          <View style={[styles.profileDivider, { backgroundColor: isDark ? '#2E3236' : '#E6ECF2' }]} />
          <Pressable onPress={handleLogout} style={({ pressed }) => [styles.profileMenuItem, pressed && { opacity: 0.7 }]}>
            <MaterialIcons name="logout" size={18} color="#DC2626" />
            <ThemedText style={[styles.profileMenuText, { color: '#DC2626' }]}>Sign Out</ThemedText>
          </Pressable>
        </View>
      )}
      <View style={[styles.content, { paddingTop: 54, paddingBottom: Math.max(insets.bottom, 14) + 14 }]}>
        <ThemedView style={[styles.hero, { borderColor: isDark ? '#2E3236' : '#EEF2F6' }]}>
          <View style={styles.heroTopRow}>
            <View
              style={[
                styles.heroIconWrap,
                { backgroundColor: isDark ? 'rgba(220,38,38,0.18)' : 'rgba(220,38,38,0.12)' },
              ]}
            >
              <MaterialIcons name="location-on" size={22} color={isDark ? '#FCA5A5' : '#DC2626'} />
            </View>
            <View style={styles.heroTextCol}>
              <ThemedText style={styles.heroTitle}>Live location</ThemedText>
              <ThemedText style={[styles.heroSubtitle, { color: isDark ? '#A3AAB3' : '#64748B' }]}
              >Map is available on the mobile app (Android/iOS). Web preview uses a placeholder.</ThemedText>
            </View>
          </View>

          <View
            style={[
              styles.mapShell,
              {
                borderColor: isDark ? '#2E3236' : '#E6ECF2',
                backgroundColor: isDark ? '#0B1220' : '#F8FAFC',
              },
            ]}
          >
            <View style={styles.mapPlaceholder}>
              <MaterialIcons name="map" size={22} color={isDark ? '#E6E9EC' : '#0F172A'} />
              <ThemedText style={[styles.mapPlaceholderText, { color: isDark ? '#A3AAB3' : '#64748B' }]}
              >Open on Android/iOS to see the live map and nearby ambulances.</ThemedText>
            </View>
          </View>
        </ThemedView>

        <View style={styles.actionsRow}>
          <View style={styles.actionCol}>
            <AppButton
              label="Help"
              onPress={() => setHelpOpen(true)}
              variant="primary"
              fullWidth
              leftIcon={<MaterialIcons name="help-outline" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
              style={[styles.actionBtn, styles.helpPrimary]}
            />
          </View>
          <View style={styles.actionCol}>
            <AppButton
              label="Direct"
              onPress={() => setDirectOpen(true)}
              variant="secondary"
              fullWidth
              leftIcon={<MaterialIcons name="phone-in-talk" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
              style={[styles.actionBtn, styles.directPrimary]}
            />
          </View>
        </View>

        <View style={styles.quickRow}>
          <View style={styles.actionCol}>
            <AppButton
              label={activeEmergencyId ? 'Track Emergency' : 'Request Ambulance'}
              onPress={openPatientEmergency}
              variant="primary"
              fullWidth
              leftIcon={<MaterialIcons name="emergency" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
              style={styles.actionBtn}
            />
          </View>
        </View>

        {helpOpen ? (
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdrop} onPress={() => setHelpOpen(false)} />
            <View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 14) + 14,
                  backgroundColor: isDark ? '#0B1220' : '#FFFFFF',
                  borderColor: isDark ? '#2E3236' : '#E6ECF2',
                },
              ]}>
              <View style={styles.sheetHeader}>
                <ThemedText style={styles.sheetTitle}>Choose help type</ThemedText>
                <Pressable
                  onPress={() => setHelpOpen(false)}
                  style={({ pressed }) => [styles.sheetClose, pressed ? { opacity: 0.7 } : null]}>
                  <MaterialIcons name="close" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />
                </Pressable>
              </View>

              <View style={styles.modalActionsRow}>
                <View style={styles.actionCol}>
                  <AppButton
                    label="For me"
                    onPress={handleForMe}
                    variant="ghost"
                    fullWidth
                    leftIcon={<MaterialIcons name="person" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
                    style={[styles.actionBtn, styles.modalMeBtn]}
                  />
                </View>
                <View style={styles.actionCol}>
                  <AppButton
                    label="For other"
                    onPress={handleForOther}
                    variant="ghost"
                    fullWidth
                    leftIcon={<MaterialIcons name="groups" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
                    style={[styles.actionBtn, styles.modalOtherBtn]}
                  />
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* Direct Call Modal - Emergency Numbers */}
        {directOpen ? (
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdrop} onPress={() => setDirectOpen(false)} />
            <View
              style={[
                styles.sheet,
                {
                  paddingBottom: Math.max(insets.bottom, 14) + 14,
                  backgroundColor: isDark ? '#0B1220' : '#FFFFFF',
                  borderColor: isDark ? '#2E3236' : '#E6ECF2',
                },
              ]}>
              <View style={styles.sheetHeader}>
                <ThemedText style={styles.sheetTitle}>Emergency Contacts</ThemedText>
                <Pressable
                  onPress={() => setDirectOpen(false)}
                  style={({ pressed }) => [styles.sheetClose, pressed ? { opacity: 0.7 } : null]}>
                  <MaterialIcons name="close" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />
                </Pressable>
              </View>

              <ThemedText style={[styles.contactSectionTitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>Ethiopian Emergency Services</ThemedText>

              <Pressable onPress={() => handleCall('911')} style={({ pressed }) => [styles.contactRow, { backgroundColor: isDark ? '#1E2028' : '#FEF2F2', borderColor: isDark ? '#2E3236' : '#FECACA' }, pressed && { opacity: 0.8 }]}>
                <View style={[styles.contactIconWrap, { backgroundColor: '#DC262620' }]}>
                  <MaterialIcons name="local-hospital" size={20} color="#DC2626" />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText style={[styles.contactName, { color: colors.text }]}>Emergency (Ambulance)</ThemedText>
                  <ThemedText style={[styles.contactNumber, { color: '#DC2626' }]}>911</ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#DC2626" />
              </Pressable>

              <Pressable onPress={() => handleCall('939')} style={({ pressed }) => [styles.contactRow, { backgroundColor: isDark ? '#1E2028' : '#FFF7ED', borderColor: isDark ? '#2E3236' : '#FED7AA' }, pressed && { opacity: 0.8 }]}>
                <View style={[styles.contactIconWrap, { backgroundColor: '#F59E0B20' }]}>
                  <MaterialIcons name="local-fire-department" size={20} color="#F59E0B" />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText style={[styles.contactName, { color: colors.text }]}>Fire & Emergency</ThemedText>
                  <ThemedText style={[styles.contactNumber, { color: '#F59E0B' }]}>939</ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#F59E0B" />
              </Pressable>

              <Pressable onPress={() => handleCall('991')} style={({ pressed }) => [styles.contactRow, { backgroundColor: isDark ? '#1E2028' : '#EFF6FF', borderColor: isDark ? '#2E3236' : '#BFDBFE' }, pressed && { opacity: 0.8 }]}>
                <View style={[styles.contactIconWrap, { backgroundColor: '#3B82F620' }]}>
                  <MaterialIcons name="local-police" size={20} color="#3B82F6" />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText style={[styles.contactName, { color: colors.text }]}>Police</ThemedText>
                  <ThemedText style={[styles.contactNumber, { color: '#3B82F6' }]}>991</ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#3B82F6" />
              </Pressable>

              <ThemedText style={[styles.contactSectionTitle, { color: isDark ? '#94A3B8' : '#64748B', marginTop: 12 }]}>Family / Personal</ThemedText>

              <Pressable onPress={() => handleCall('+251911000000')} style={({ pressed }) => [styles.contactRow, { backgroundColor: isDark ? '#1E2028' : '#F0FDF4', borderColor: isDark ? '#2E3236' : '#BBF7D0' }, pressed && { opacity: 0.8 }]}>
                <View style={[styles.contactIconWrap, { backgroundColor: '#10B98120' }]}>
                  <MaterialIcons name="family-restroom" size={20} color="#10B981" />
                </View>
                <View style={styles.contactInfo}>
                  <ThemedText style={[styles.contactName, { color: colors.text }]}>Emergency Contact</ThemedText>
                  <ThemedText style={[styles.contactNumber, { color: '#10B981' }]}>From your profile</ThemedText>
                </View>
                <MaterialIcons name="call" size={22} color="#10B981" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    justifyContent: 'space-between',
  },
  hero: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextCol: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  heroSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  mapShell: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    flex: 1,
    minHeight: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  mapPlaceholderText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  actions: {
    marginTop: 18,
    gap: 12,
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  quickRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 12,
  },
  modalActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 12,
  },
  actionCol: {
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  sheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.2,
    shadowRadius: 26,
    elevation: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  sheetClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
  },
  actionBtn: {
    minHeight: 50,
    borderRadius: 16,
    paddingVertical: 12,
  },
  neutralBtn: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(148,163,184,0.35)',
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  helpPrimary: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
    borderWidth: 1,
  },
  directPrimary: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
    borderWidth: 1,
  },
  cleanBtn: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  modalMeBtn: {
    backgroundColor: 'transparent',
    borderColor: '#DC2626',
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  modalOtherBtn: {
    backgroundColor: 'transparent',
    borderColor: '#10B981',
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  actionSecondary: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(148,163,184,0.30)',
    borderWidth: 1,
  },

  /* Profile Icon */
  profileIcon: {
    position: 'absolute',
    right: 16,
    zIndex: 100,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  profileDropdown: {
    position: 'absolute',
    right: 16,
    zIndex: 200,
    borderRadius: 14,
    borderWidth: 1,
    padding: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  profileEmail: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  profileMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  profileMenuText: {
    fontSize: 14,
    fontWeight: '600',
  },
  profileDivider: {
    height: 1,
    marginVertical: 4,
    marginHorizontal: 8,
  },

  /* Emergency Contacts */
  contactSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  contactIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInfo: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '700',
  },
  contactNumber: {
    fontSize: 13,
    fontWeight: '600',
  },
});
