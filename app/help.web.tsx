import { AppButton } from '@/components/app-button';
import { AppHeader } from '@/components/app-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const [helpOpen, setHelpOpen] = React.useState(false);

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
              onPress={() => {}}
              variant="secondary"
              fullWidth
              leftIcon={<MaterialIcons name="phone-in-talk" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
              style={[styles.actionBtn, styles.directPrimary]}
            />
          </View>
        </View>

        <Modal transparent visible={helpOpen} animationType="fade" onRequestClose={() => setHelpOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setHelpOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) + 14, backgroundColor: isDark ? '#0B1220' : '#FFFFFF', borderColor: isDark ? '#2E3236' : '#E6ECF2' }]}>
            <View style={styles.sheetHeader}>
              <ThemedText style={styles.sheetTitle}>Choose help type</ThemedText>
              <Pressable onPress={() => setHelpOpen(false)} style={({ pressed }) => [styles.sheetClose, pressed ? { opacity: 0.7 } : null]}>
                <MaterialIcons name="close" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />
              </Pressable>
            </View>

            <View style={styles.modalActionsRow}>
              <View style={styles.actionCol}>
                <AppButton
                  label="For me"
                  onPress={() => {}}
                  variant="ghost"
                  fullWidth
                  leftIcon={<MaterialIcons name="person" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
                  style={[styles.actionBtn, styles.modalMeBtn]}
                />
              </View>
              <View style={styles.actionCol}>
                <AppButton
                  label="For other"
                  onPress={() => {}}
                  variant="ghost"
                  fullWidth
                  leftIcon={<MaterialIcons name="groups" size={18} color={isDark ? '#E6E9EC' : '#11181C'} />}
                  style={[styles.actionBtn, styles.modalOtherBtn]}
                />
              </View>
            </View>
          </View>
        </Modal>
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
