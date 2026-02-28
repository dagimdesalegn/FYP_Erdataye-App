import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';

// Web fallback – react-native-maps is native-only
export default function NativeMapView(props: {
  userLat: number;
  userLng: number;
  accuracy: number | null;
  ambulances: Array<{ id: string; vehicle_number: string; type?: string; lat: number; lng: number }>;
  emergencies: Array<{ id: string; emergency_type: string; status: string; description: string; latitude: number; longitude: number }>;
  hospitals: Array<{ id: string; name: string; address: string; phone: string; lat: number; lng: number }>;
  isDark: boolean;
  accentColor: string;
  textColor: string;
  subText: string;
}) {
  const { userLat, userLng, ambulances, emergencies, hospitals, isDark, textColor, subText } = props;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${userLng - 0.05}%2C${userLat - 0.05}%2C${userLng + 0.05}%2C${userLat + 0.05}&layer=mapnik&marker=${userLat}%2C${userLng}`;
  const cardBg = isDark ? '#1A2332' : '#FFFFFF';

  return (
    <View style={styles.container}>
      <View style={styles.mapFrame}>
        {/* @ts-ignore – iframe is valid on web */}
        <iframe src={mapUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="Map" />
      </View>

      <ScrollView style={[styles.panel, { backgroundColor: cardBg }]}>
        <ThemedText style={[styles.section, { color: textColor }]}>🚑 Ambulances ({ambulances.length})</ThemedText>
        {ambulances.map((a) => (
          <View key={a.id} style={[styles.card, { borderColor: isDark ? '#1E3A5F' : '#E2E8F0' }]}>
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>Ambulance {a.vehicle_number}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>Type: {a.type || 'Standard'} • {a.lat.toFixed(5)}, {a.lng.toFixed(5)}</ThemedText>
          </View>
        ))}

        <ThemedText style={[styles.section, { color: textColor }]}>⚠️ Emergencies ({emergencies.length})</ThemedText>
        {emergencies.filter(e => e.latitude !== 0 || e.longitude !== 0).map((e) => (
          <View key={e.id} style={[styles.card, { borderColor: '#EF4444' }]}>
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>{e.emergency_type} — {e.status}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>{e.description}</ThemedText>
          </View>
        ))}

        <ThemedText style={[styles.section, { color: textColor }]}>🏥 Hospitals ({hospitals.length})</ThemedText>
        {hospitals.map((h) => (
          <View key={h.id} style={[styles.card, { borderColor: isDark ? '#1E3A5F' : '#E2E8F0' }]}>
            <ThemedText style={[styles.cardTitle, { color: textColor }]}>{h.name}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: subText }]}>{h.address} • 📞 {h.phone}</ThemedText>
          </View>
        ))}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapFrame: { width: '100%', height: '50%' },
  panel: { flex: 1, padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, marginTop: -16 },
  section: { fontWeight: 'bold', fontSize: 16, fontFamily: Fonts.sans, marginTop: 12, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  cardTitle: { fontWeight: '600', fontSize: 14, fontFamily: Fonts.sans },
  cardSub: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },
});
