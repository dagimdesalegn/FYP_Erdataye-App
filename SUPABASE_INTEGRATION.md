# ErdAtaye Emergency Response System - Supabase Integration

## 🚑 Overview

The ErdAtaye Emergency Response System is now fully integrated with **Supabase** (PostgreSQL + PostGIS) for real-time emergency management, user authentication, and geolocation tracking.

## 🔒 Database Architecture

### Core Tables
- **profiles** - Role-based user management (patients, drivers, hospital_staff, admins)
- **medical_profiles** - Critical patient data (blood types, allergies, emergency contacts)
- **hospitals** - Hospital locations with geocoding
- **ambulances** - Fleet vehicles with driver assignments and status tracking
- **emergency_requests** - Complete incident workflow management
- **location_updates** - Real-time GPS streaming with PostGIS integration
- **chat_history** - AI-powered first-aid conversations

### Security
- **Row Level Security (RLS)** - 29 custom policies ensuring data isolation by user role
- **Real-time Replication** - Instant sync across all client apps on location_updates and emergency_requests

## 📋 Configuration

### Environment Variables
Create `.env.local` with your Supabase credentials:

```env
SUPABASE_URL=https://padezipdfcicydyncmkw.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 🚀 Features Implemented

### 1. Authentication (`utils/auth.ts`)
- User signup with email/password
- Email verification
- Session management
- Auth state listeners for auto-login

```typescript
import { signUp, signIn, signOut, getCurrentUser } from '@/utils/auth';

// Sign up patient
const { user, error } = await signUp(
  'patient@example.com',
  'password123',
  { role: 'patient', full_name: 'John Doe', phone: '+1234567890' }
);
```

### 2. User Profiles (`utils/profile.ts`)
- Create/update user profiles
- Manage medical information
- Fetch role-based user lists

```typescript
import { getUserProfile, upsertMedicalProfile } from '@/utils/profile';

// Get user profile
const { profile } = await getUserProfile(userId);

// Update medical profile
const { success } = await upsertMedicalProfile(userId, {
  blood_type: 'O+',
  allergies: ['Penicillin'],
  emergency_contact_name: 'Jane Doe',
  emergency_contact_phone: '+0987654321',
});
```

### 3. Emergency Requests (`utils/emergency.ts`)
- Create emergency requests with geolocation
- Find nearest available ambulances using PostGIS
- Assign ambulances and update status
- Real-time location tracking

```typescript
import { createEmergencyRequest, findNearestAmbulances } from '@/utils/emergency';

// Create emergency
const { request } = await createEmergencyRequest(
  patientId,
  latitude,
  longitude,
  'Severe chest pain',
  'critical'
);

// Find nearby ambulances (within 10km)
const { ambulances } = await findNearestAmbulances(latitude, longitude, 10000);
```

### 4. AI First-Aid Chat (`utils/chat.ts`)
- Store chat conversations
- Real-time message streaming
- Connect first-aid guidance to emergency incidents

```typescript
import { addChatMessage, getChatHistory } from '@/utils/chat';

// Add message
await addChatMessage(emergencyId, userId, 'What should I do?', false);
await addChatMessage(emergencyId, userId, 'Start CPR...', true);

// Get history
const { messages } = await getChatHistory(emergencyId);
```

## 📱 App Screens

### Emergency Screen (`app/emergency.tsx`)
- **Real-time geolocation** - Gets user's current location
- **Emergency call button** - Creates critical-level emergency request
- **Nearby ambulances** - Displays 5 closest ambulances from database
- **Real-time tracking**

### Registration (`app/register.tsx`)
- **Email/Password auth** - Sign up with Supabase Auth
- **Medical profile** - Store blood type, allergies, emergency contacts
- **Automatic RLS** - Users can only access their own data by default

## 🔗 Real-time Features

### Location Updates
```typescript
// Subscribe to ambulance locations
const subscription = subscribeToLocationUpdates(emergencyId, (locations) => {
  console.log('Ambulance moving to:', locations);
});

// Update ambulance GPS
await updateAmbulanceLocation(ambulanceId, lat, lon, emergencyId);
```

### Chat Messages
Live updates on first-aid guidance conversations during emergencies.

## 🗺️ PostGIS Integration

### Geospatial Queries
The `find_nearest_available_ambulance()` database function uses PostGIS for:
- Sub-second nearest ambulance searches
- Haversine distance calculations
- Efficient spatial indexing

### Example
```typescript
// Automatically finds ambulances within range using PostGIS
const { ambulances } = await findNearestAmbulances(12.5726, 9.0320, 15000);
```

## 📊 Data Flow

```
Patient Registration
    ↓
[profiles + medical_profiles tables]
    ↓
Emergency Request Created
    ↓
[emergency_requests table]
    ↓
Find Nearest Ambulances (PostGIS)
    ↓
Ambulance Assigned & En Route
    ↓
[location_updates table] ← Real-time GPS updates
    ↓
AI First-Aid Chat (if needed)
    ↓
[chat_history table]
    ↓
Ambulance Arrives & Transfers to Hospital
    ↓
Mark Complete
```

## 🔐 Row Level Security Example

Patients can only see their own emergencies:
```sql
CREATE POLICY "Patients see own emergencies"
ON emergency_requests FOR SELECT
USING (patient_id = auth.uid());
```

Drivers see only assigned emergencies:
```sql
CREATE POLICY "Drivers see assigned emergencies"
ON emergency_requests FOR SELECT
USING (ambulance_id IN (
  SELECT id FROM ambulances WHERE driver_id = auth.uid()
));
```

## 🛠️ Using the Services

### Global App State
The `AppStateProvider` manages authentication state globally:

```typescript
import { useAppState } from '@/components/app-state';

export default function MyScreen() {
  const { user, isRegistered, isLoading } = useAppState();
  
  if (isLoading) return <LoadingScreen />;
  if (!isRegistered) return <RegisterScreen />;
  
  return <MainApp />;
}
```

## 📦 Dependencies

```json
{
  "@supabase/supabase-js": "2.x",
  "expo-location": "~19.0.7",
  "expo-auth-session": "~15.0.0"
}
```

## 🚀 Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env.local
   # Add your Supabase credentials
   ```

3. **Run the app:**
   ```bash
   npm start
   npm run web      # or android/ios
   ```

4. **Test Emergency Creation:**
   - Register an account
   - Go to Emergency screen
   - Tap "CALL AMBULANCE"
   - Check Supabase for real emergency_request record

## 📈 Future Enhancements

- [ ] SMS notifications to ambulance drivers
- [ ] Push notifications for incoming emergencies
- [ ] Admin dashboard with analytics
- [ ] Telemedicine integration
- [ ] Payment processing for premium features
- [ ] Multi-language support

## 📞 Support

For issues or questions about the Supabase integration, check:
- Supabase Dashboard: https://app.supabase.com
- API Docs: https://supabase.com/docs
- Emergency Service Logs: Database logs in Supabase console

---

**Database Status:** ✅ Connected  
**Auth System:** ✅ Active  
**Real-time:** ✅ Enabled  
**PostGIS:** ✅ Available
