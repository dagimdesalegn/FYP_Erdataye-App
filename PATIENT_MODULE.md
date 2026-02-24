# Patient Module - ErdAtaye Emergency Ambulance

Complete patient-focused emergency response system with medical profile management and real-time tracking.

## 📋 Overview

The patient module provides a complete emergency workflow:
1. **Patient Registration** - Email/phone signup with medical profile
2. **Emergency Dispatch** - One-touch SOS with severity selection
3. **Real-time Tracking** - Live ambulance location and ETA
4. **Medical Profile** - Manage health information and emergency contacts

## 🏗️ Architecture

### Database Schema (`migrations/001_patient_schema.sql`)

**Core Tables:**
- `profiles` - User accounts with roles
- `medical_profiles` - Patient medical information
- `emergency_requests` - Emergency calls from patients
- `ambulances` - Available ambulances and drivers
- `emergency_assignments` - Link emergencies to ambulances
- `ambulance_locations` - Real-time location tracking
- `hospitals` - Hospital information
- `hospital_assignments` - Patient routing to hospitals

**Key Features:**
- Row Level Security (RLS) for data privacy
- Role-based access control (patient/driver/admin)
- Foreign key relationships for data integrity
- Performance indexes on frequently queried columns

### Patient Utilities (`utils/patient.ts`)

TypeScript functions for patient emergency workflow:

```typescript
// Create emergency request
await createEmergency(patientId, lat, lng, severity, description, condition);

// Get active emergency
const { emergency } = await getActiveEmergency(patientId);

// Get emergency with assignment details
const { emergency, assignment, ambulance } = await getEmergencyDetails(emergencyId);

// Update emergency status
await updateEmergencyStatus(emergencyId, status);

// Find nearby hospitals
const { hospitals } = await getNearbyHospitals(lat, lng, radiusKm);

// Subscribe to real-time updates
const unsubscribe = subscribeToEmergency(emergencyId, (emergency) => {
  console.log('Emergency updated:', emergency);
});
```

## 🎨 Screens

### 1. Patient Profile (`app/patient-profile.tsx`)

Manage personal and medical information:
- **Personal Information** - Name, phone, email
- **Medical Information** - Blood type, allergies, conditions, medications
- **Emergency Contact** - Contact name and phone
- **Notes** - Additional medical information

**Features:**
- Load existing profile on mount
- Save changes to Supabase
- Dark/light theme support
- Form validation

**Usage:**
```tsx
import PatientProfileScreen from '@/app/patient-profile';
```

### 2. Emergency Dispatch (`app/patient-emergency.tsx`)

Request emergency ambulance service:
- **Severity Selection** - Low, Medium, High, Critical
- **Location** - Auto-detects current GPS location
- **Description** - Describe the emergency
- **Patient Condition** - Current health status
- **SOS Button** - Large red button to call ambulance

**Features:**
- Check for active emergency
- Confirm emergency call
- Location permission handling
- Real-time severity selection
- Animated SOS button

**Usage:**
```tsx
import PatientEmergencyScreen from '@/app/patient-emergency';

// Navigate to emergency screen
router.push('/patient-emergency');
```

### 3. Emergency Tracking (`app/patient-emergency-tracking.tsx`)

Track active emergency in real-time:
- **Current Status** - Live emergency status
- **Progress Timeline** - Visual timeline of emergency progression
- **Emergency Details** - Location, description, condition
- **Ambulance Information** - Vehicle number, ETA, driver
- **Support Options** - Call dispatcher, message support

**Features:**
- Real-time status updates
- Pull-to-refresh
- Timeline visualization
- ETA countdown
- Distance calculation
- Support contact buttons

**Usage:**
```tsx
import PatientEmergencyTrackingScreen from '@/app/patient-emergency-tracking';

// Navigate with emergency ID
router.push(`/patient-emergency-tracking?emergencyId=${emergencyId}`);
```

## 🔄 Patient Emergency Workflow

```
1. Patient Signs Up
   ↓
   [Register Screen] → Create account → Create medical profile

2. Patient Initiates Emergency
   ↓
   [Emergency Screen] → Select severity → Get location → SOS

3. Emergency Created
   ↓
   Status: "pending" → Awaiting ambulance assignment

4. Ambulance Assigned
   ↓
   Status: "assigned" → Dispatcher locates nearest ambulance

5. Ambulance En Route
   ↓
   Status: "en_route" → Driver notified, location tracking active

6. Ambulance Arrives
   ↓
   Status: "arrived" → Patient picked up

7. Transport to Hospital
   ↓
   Status: "at_hospital" → Patient admitted

8. Emergency Closed
   ↓
   Status: "completed" → Treatment started, emergency resolved
```

## 🔐 Row Level Security (RLS)

**Patient Data Access:**
```sql
-- Patients can read own medical profile
SELECT * FROM medical_profiles WHERE user_id = auth.uid();

-- Patients can create own emergencies
INSERT INTO emergency_requests (patient_id, ...) 
WHERE patient_id = auth.uid();

-- Patients can update own emergency status
UPDATE emergency_requests SET status = ...
WHERE patient_id = auth.uid();

-- Patients can view their assigned hospitals
SELECT * FROM hospital_assignments ha
WHERE ha.emergency_id IN (
  SELECT id FROM emergency_requests WHERE patient_id = auth.uid()
);
```

**Driver/Admin Access:**
```sql
-- Drivers can view assigned emergencies
SELECT * FROM emergency_requests
WHERE id IN (
  SELECT emergency_id FROM emergency_assignments
  WHERE ambulance_id IN (
    SELECT id FROM ambulances WHERE driver_id = auth.uid()
  )
);

-- Admins can view all data
SELECT * FROM emergency_requests; -- No WHERE clause for admins
```

## 📍 Location Tracking

**Get Current Location:**
```typescript
import * as Location from 'expo-location';

const { status } = await Location.requestForegroundPermissionsAsync();
if (status !== 'granted') {
  // Handle permission denied
}

const location = await Location.getCurrentPositionAsync();
const { latitude, longitude } = location.coords;
```

**Calculate Distance:**
```typescript
// Simple distance calculation (client-side)
const distance = calculateDistance(
  patientLat, patientLng,
  hospitalLat, hospitalLng
); // Returns km

// For production, use PostGIS in Supabase for accuracy
```

## 🔔 Real-time Updates

**Subscribe to Emergency Status:**
```typescript
const unsubscribe = subscribeToEmergency(emergencyId, (emergency) => {
  setEmergency(emergency); // Update UI with latest status
});

// Cleanup subscription
return () => unsubscribe();
```

**Subscribe to Ambulance Location:**
```typescript
const unsubscribe = subscribeToAmbulanceLocation(
  ambulanceId,
  (latitude, longitude) => {
    setAmbulanceLocation({ latitude, longitude }); // Update map
  }
);
```

## 📝 Patient Profile Data

**Medical Profile Fields:**
```typescript
interface PatientMedicalProfile {
  blood_type: string; // "A+", "O-", etc.
  allergies: string[]; // ["Penicillin", "Nuts", "Dairy"]
  medical_conditions: string[]; // ["Asthma", "Diabetes"]
  medications: string[]; // ["Aspirin", "Insulin"]
  emergency_contact_name: string;
  emergency_contact_phone: string;
  notes: string; // Additional medical information
}
```

## 🚨 Emergency Request Fields

```typescript
interface EmergencyRequest {
  id: UUID;
  patient_id: UUID;
  latitude: number; // GPS coordinates
  longitude: number;
  status: 'pending' | 'assigned' | 'en_route' | 'arrived' | 'at_hospital' | 'completed' | 'cancelled';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string; // What happened
  patient_condition?: string; // Patient's current state
  created_at: timestamp;
  updated_at: timestamp;
}
```

## 🎯 Integration Points

### With Auth Module
```typescript
import { signUp, signIn, getCurrentUserWithRole } from '@/utils/auth';

// After signup, create medical profile
const { user } = await signUp(email, password, 'patient', name, phone);
```

### With Navigation
```typescript
// In app/_layout.tsx
<Stack.Screen name="patient-profile" options={{ headerShown: false }} />
<Stack.Screen name="patient-emergency" options={{ headerShown: false }} />
<Stack.Screen name="patient-emergency-tracking" options={{ headerShown: false }} />
```

### With State Management
```typescript
import { useAppState } from '@/components/app-state';

const { user, setUser } = useAppState();
// Access user ID for queries
```

## 🧪 Testing Checklist

- [ ] Patient can create account with medical profile
- [ ] Patient profile displays saved medical information
- [ ] Patient can update blood type, allergies, conditions
- [ ] SOS button creates emergency in database
- [ ] Emergency displays current status
- [ ] Timeline shows progression through statuses
- [ ] Location permission request works
- [ ] Dark/light theme works on all screens
- [ ] Refresh button updates emergency details
- [ ] Navigation between screens works
- [ ] RLS policies prevent cross-patient data access

## 📚 Related Files

- `migrations/001_patient_schema.sql` - Database schema
- `utils/patient.ts` - Patient utilities
- `app/patient-profile.tsx` - Profile management
- `app/patient-emergency.tsx` - Emergency dispatch
- `app/patient-emergency-tracking.tsx` - Emergency tracking
- `utils/auth.ts` - Authentication
- `app/_layout.tsx` - App navigation

## 🚀 Next Steps

1. **Emergency Notifications** - Push notifications when emergency assigned
2. **Ambulance Map** - Show real-time ambulance location on map
3. **Chat with Dispatcher** - In-app messaging during emergency
4. **Emergency History** - View past emergencies and summaries
5. **Family Sharing** - Let emergency contacts access patient status
6. **Offline Support** - Queue emergencies if offline, sync when online
