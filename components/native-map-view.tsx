import React, { useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Callout, Marker, Region } from 'react-native-maps';
import { ThemedText } from '@/components/themed-text';
import { MaterialIcons } from '@expo/vector-icons';
import { Fonts } from '@/constants/theme';

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
  onRegionChange?: (region: Region) => void;
  onCenterUser?: () => void;
}) {
  const { userLat, userLng, ambulances, emergencies, hospitals, isDark, textColor, subText, accentColor, onRegionChange } = props;

  const mapRef = useRef<MapView>(null);

  const initialRegion: Region = {
    latitude: userLat,
    longitude: userLng,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChange}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        showsScale
        showsTraffic
        loadingEnabled
        mapType="standard"
      >
        {ambulances.map((amb) => (
          <Marker
            key={amb.id}
            coordinate={{ latitude: amb.lat, longitude: amb.lng }}
            title={`Ambulance ${amb.vehicle_number}`}
            description={`Type: ${amb.type || 'Standard'}`}
          >
            <View style={styles.ambulanceMarker}>
              <ThemedText style={styles.markerEmoji}>🚑</ThemedText>
            </View>
            <Callout>
              <View style={styles.callout}>
                <ThemedText style={styles.calloutTitle}>Ambulance {amb.vehicle_number}</ThemedText>
                <ThemedText style={styles.calloutText}>Type: {amb.type || 'Standard'}</ThemedText>
                <ThemedText style={styles.calloutText}>{amb.lat.toFixed(5)}, {amb.lng.toFixed(5)}</ThemedText>
              </View>
            </Callout>
          </Marker>
        ))}

        {emergencies.filter(e => e.latitude !== 0 || e.longitude !== 0).map((emergency) => (
          <Marker
            key={emergency.id}
            coordinate={{ latitude: emergency.latitude, longitude: emergency.longitude }}
            title="Emergency"
            description={emergency.description}
          >
            <View style={styles.emergencyMarker}>
              <MaterialIcons name="warning" size={22} color="#FFFFFF" />
            </View>
            <Callout>
              <View style={styles.callout}>
                <ThemedText style={styles.calloutTitle}>Emergency</ThemedText>
                <ThemedText style={styles.calloutText}>Status: {emergency.status}</ThemedText>
                <ThemedText style={styles.calloutText}>Type: {emergency.emergency_type}</ThemedText>
                <ThemedText style={styles.calloutText}>{emergency.description}</ThemedText>
              </View>
            </Callout>
          </Marker>
        ))}

        {hospitals.map((hospital) => (
          <Marker
            key={hospital.id}
            coordinate={{ latitude: hospital.lat, longitude: hospital.lng }}
            title={hospital.name}
            description={hospital.address}
          >
            <View style={styles.hospitalMarker}>
              <ThemedText style={styles.markerEmoji}>🏥</ThemedText>
            </View>
            <Callout>
              <View style={styles.callout}>
                <ThemedText style={styles.calloutTitle}>{hospital.name}</ThemedText>
                <ThemedText style={styles.calloutText}>{hospital.address}</ThemedText>
                <ThemedText style={styles.calloutText}>📞 {hospital.phone}</ThemedText>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* Legend */}
      <View style={[styles.legend, { backgroundColor: isDark ? '#0B1220' : '#FFFFFF' }]}>
        <ThemedText style={[styles.legendTitle, { color: textColor }]}>Map Legend</ThemedText>
        <View style={styles.legendItem}>
          <ThemedText style={styles.legendEmoji}>🚑</ThemedText>
          <ThemedText style={[styles.legendText, { color: subText }]}>Ambulance</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <MaterialIcons name="warning" size={16} color="#EF4444" />
          <ThemedText style={[styles.legendText, { color: subText }]}>Emergency</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <ThemedText style={styles.legendEmoji}>🏥</ThemedText>
          <ThemedText style={[styles.legendText, { color: subText }]}>Hospital</ThemedText>
        </View>
      </View>

      {/* Info bar */}
      <View style={[styles.infoBar, { backgroundColor: isDark ? '#0B1220' : '#FFFFFF' }]}>
        <ThemedText style={[styles.infoBarText, { color: subText }]}>
          📍 {userLat.toFixed(5)}, {userLng.toFixed(5)}
          {'  '}• Accuracy: {props.accuracy?.toFixed(0) ?? '?'}m
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  ambulanceMarker: { backgroundColor: 'white', borderRadius: 20, padding: 4, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
  emergencyMarker: { backgroundColor: '#EF4444', borderRadius: 20, padding: 6, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
  hospitalMarker: { backgroundColor: 'white', borderRadius: 20, padding: 4, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
  markerEmoji: { fontSize: 26 },
  callout: { minWidth: 150, maxWidth: 250, padding: 4 },
  calloutTitle: { fontWeight: 'bold', fontSize: 14, marginBottom: 4, fontFamily: Fonts.sans },
  calloutText: { fontSize: 12, fontFamily: Fonts.sans },
  legend: { position: 'absolute', left: 16, bottom: 80, padding: 12, borderRadius: 12, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4 },
  legendTitle: { fontWeight: 'bold', fontSize: 13, marginBottom: 8, fontFamily: Fonts.sans },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginVertical: 3, gap: 6 },
  legendEmoji: { fontSize: 16 },
  legendText: { fontSize: 12, fontFamily: Fonts.sans },
  infoBar: { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 16, left: 16, right: 16, padding: 10, borderRadius: 10, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, alignItems: 'center' },
  infoBarText: { fontSize: 12, fontFamily: Fonts.sans },
});
