import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { useAppState } from '@/components/app-state';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getActiveEmergency, type PatientEmergency } from '@/utils/patient';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HelpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { user } = useAppState();
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [activeEmergency, setActiveEmergency] = React.useState<PatientEmergency | null>(null);
  const [activeEmergencyId, setActiveEmergencyId] = React.useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [locationLoading, setLocationLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    const loadActiveEmergency = async () => {
      if (!user?.id) {
        if (!cancelled) setActiveEmergencyId(null);
        return;
      }

      const { emergency } = await getActiveEmergency(user.id);
      if (!cancelled) {
        setActiveEmergency(emergency ?? null);
        setActiveEmergencyId(emergency?.id ?? null);
      }
    };

    void loadActiveEmergency();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  React.useEffect(() => {
    let cancelled = false;

    const loadCurrentLocation = async () => {
      try {
        setLocationLoading(true);
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          if (!cancelled) {
            setLocationError('Location permission is required to show your position on web.');
            setCurrentLocation(null);
          }
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!cancelled) {
          setCurrentLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          setLocationError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLocationError('Unable to read current location from this browser session.');
          setCurrentLocation(null);
        }
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    void loadCurrentLocation();

    return () => {
      cancelled = true;
    };
  }, []);

  const mapLocation = React.useMemo(() => {
    if (
      activeEmergency &&
      Number.isFinite(activeEmergency.latitude) &&
      Number.isFinite(activeEmergency.longitude)
    ) {
      return {
        latitude: activeEmergency.latitude,
        longitude: activeEmergency.longitude,
        sourceLabel: 'Emergency location',
      };
    }

    if (currentLocation) {
      return {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        sourceLabel: 'Current device location',
      };
    }

    return null;
  }, [activeEmergency, currentLocation]);

  const mapEmbedUrl = React.useMemo(() => {
    if (!mapLocation) return null;

    const lat = mapLocation.latitude;
    const lon = mapLocation.longitude;
    const delta = 0.0125;

    return `https://www.openstreetmap.org/export/embed.html?bbox=${lon - delta}%2C${lat - delta}%2C${lon + delta}%2C${lat + delta}&layer=mapnik&marker=${lat}%2C${lon}`;
  }, [mapLocation]);

  const mapExternalUrl = React.useMemo(() => {
    if (!mapLocation) return null;
    return `https://www.openstreetmap.org/?mlat=${mapLocation.latitude}&mlon=${mapLocation.longitude}#map=16/${mapLocation.latitude}/${mapLocation.longitude}`;
  }, [mapLocation]);

  const mapSummaryText = React.useMemo(() => {
    if (mapLocation) {
      return `${mapLocation.latitude.toFixed(6)}, ${mapLocation.longitude.toFixed(6)}`;
    }
    if (locationLoading) return 'Getting your current location...';
    if (locationError) return locationError;
    return 'No active location is available yet.';
  }, [locationError, locationLoading, mapLocation]);

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

  return (
    <View style={[styles.bg, { backgroundColor: colors.background }]}>
      <AppHeader title="ErdAtaye" announcementHref="/modal" />
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
              >Showing patient location from active emergency data or current device coordinates.</ThemedText>
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
            {mapLocation && mapEmbedUrl ? (
              <View style={styles.liveMapRoot}>
                <View style={styles.mapMetaRow}>
                  <View style={styles.mapMetaLeft}>
                    <MaterialIcons name="my-location" size={18} color={isDark ? '#E6E9EC' : '#0F172A'} />
                    <View>
                      <ThemedText style={styles.mapMetaLabel}>{mapLocation.sourceLabel}</ThemedText>
                      <ThemedText
                        style={[styles.mapMetaValue, { color: isDark ? '#A3AAB3' : '#64748B' }]}>
                        {mapSummaryText}
                      </ThemedText>
                    </View>
                  </View>
                  {mapExternalUrl ? (
                    <Pressable
                      onPress={() => {
                        void Linking.openURL(mapExternalUrl);
                      }}
                      style={({ pressed }) => [styles.openMapBtn, pressed ? { opacity: 0.75 } : null]}>
                      <MaterialIcons name="open-in-new" size={16} color={isDark ? '#E6E9EC' : '#0F172A'} />
                      <ThemedText style={styles.openMapText}>Open map</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.mapFrameWrap}>
                  {React.createElement('iframe', {
                    title: 'Patient location map',
                    src: mapEmbedUrl,
                    loading: 'lazy',
                    referrerPolicy: 'no-referrer-when-downgrade',
                    style: {
                      border: 0,
                      width: '100%',
                      height: '100%',
                      display: 'block',
                    },
                  })}
                </View>
              </View>
            ) : (
              <View style={styles.mapPlaceholder}>
                <MaterialIcons name="map" size={22} color={isDark ? '#E6E9EC' : '#0F172A'} />
                <ThemedText style={[styles.mapPlaceholderText, { color: isDark ? '#A3AAB3' : '#64748B' }]}>
                  {mapSummaryText}
                </ThemedText>
              </View>
            )}
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
              onPress={openPatientEmergency}
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
          <View style={styles.actionCol}>
            <AppButton
              label="Medical Profile"
              onPress={() => router.push('/patient-profile')}
              variant="secondary"
              fullWidth
              leftIcon={<MaterialIcons name="badge" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
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
  liveMapRoot: {
    flex: 1,
  },
  mapMetaRow: {
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.26)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mapMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  mapMetaLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  mapMetaValue: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  openMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  openMapText: {
    fontSize: 12,
    fontWeight: '700',
  },
  mapFrameWrap: {
    flex: 1,
    minHeight: 280,
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
});
