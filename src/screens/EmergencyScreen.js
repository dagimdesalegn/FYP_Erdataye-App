import { Alert, StyleSheet, Text, View } from 'react-native';
import EmergencyButton from '../components/EmergencyButton';

export default function EmergencyScreen() {
  const handleEmergency = () => {
    Alert.alert(
      "Emergency Alert!",
      "Ambulance has been notified. Help is on the way!",
      [{ text: "OK" }]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Emergency Ambulance Service</Text>
      <EmergencyButton onPress={handleEmergency} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 50,
  },
});
