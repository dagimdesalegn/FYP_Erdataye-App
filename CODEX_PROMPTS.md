# ErdAtaye Sprint 1 - Codex Prompts

## Patient-Focused Development

### Codex Prompt 1: Patient Emergency Workflow

**Use this prompt to enhance patient emergency features:**

```
Implement complete patient emergency workflow in React Native with TypeScript:

Patient Features:
1. Emergency Request Creation
   - SOS button with severity selection (low/medium/high/critical)
   - Get current GPS location
   - Describe emergency and patient condition
   - Submit to emergency_requests table

2. Emergency Tracking
   - View active emergency status
   - See assigned ambulance details
   - Track ambulance location in real-time
   - View ETA updates
   - Contact dispatcher

3. Patient Profile
   - Medical information (blood type, allergies, conditions)
   - Emergency contact details
   - Current medications
   - Additional medical notes
   - Update via profile screen

Database Tables:
- emergency_requests (id, patient_id, latitude, longitude, status, severity, description)
- ambulances (id, vehicle_number, driver_id, status, latitude, longitude)
- emergency_assignments (id, emergency_id, ambulance_id, assigned_at, pickup_eta_minutes)
- ambulance_locations (id, ambulance_id, latitude, longitude, timestamp)
- medical_profiles (id, user_id, blood_type, allergies, conditions, medications)

Requirements:
- TypeScript strict mode
- Real-time status updates using subscriptions
- GPS location with permission handling
- Responsive UI with dark/light theme
- Error handling and loading states
```

### Codex Prompt 2: Patient Database Schema

**Use this prompt for patient-related database setup:**

```
Create Supabase SQL schema for patient emergency system:

Core Tables:
1. profiles - User accounts with roles (patient/driver/admin)
2. medical_profiles - Patient medical information
3. emergency_requests - Emergency calls from patients
4. ambulances - Available ambulances with drivers
5. emergency_assignments - Link emergencies to ambulances
6. ambulance_locations - Real-time location tracking
7. hospitals - Hospital information
8. hospital_assignments - Patient routing to hospitals

Features:
- UUID primary keys
- Timestamps (created_at, updated_at)
- Foreign key relationships
- Proper indexes on frequently queried columns
- Row Level Security (RLS) policies

RLS Policies:
- Patients can only see their own emergencies and medical profile
- Drivers can see assigned emergencies and update ambulance status
- Admins can see and manage all resources
- Location data accessible to authorized users only
```

### Codex Prompt 3: Patient Real-time Notifications

**Use this prompt for patient notification system:**

```
Implement real-time notifications for patient emergencies:

Features:
1. Emergency Status Updates
   - When emergency is assigned to ambulance
   - When ambulance is en route
   - When ambulance arrives
   - When patient is at hospital

2. Location Tracking
   - Real-time ambulance location updates
   - ETA countdown
   - Distance to patient

3. Message Notifications
   - Dispatcher messages
   - Driver updates
   - Hospital notifications

Implementation:
- Use Supabase real-time subscriptions
- Push notifications (expo-notifications)
- In-app toast/banner notifications
- Sound/vibration alerts for high-severity emergencies
- Notification persistence and history

Requirements:
- Background notification handling
- Permission requests
- Notification customization by severity
```
