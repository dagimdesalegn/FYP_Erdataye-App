# Database Setup Guide

## Required Steps to Initialize Database

Your registration is not saving because the database tables need to be created in your Supabase instance.

### Step 1: Run the Migration

1. Go to your Supabase Project: https://app.supabase.com
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the entire contents of `migrations/001_patient_schema.sql`
5. Paste it into the SQL editor
6. Click **Run** (or press Ctrl+Enter)

This will create:
- `profiles` table (for user profiles)
- `medical_profiles` table (for patient medical info)
- `emergency_requests` table (for emergency calls)
- `ambulances` table (for ambulance data)
- `emergency_assignments` table (for ambulance assignments)
- `ambulance_locations` table (for tracking ambulance locations)
- `hospitals` table (for hospital information)
- `hospital_assignments` table (for hospital assignments)
- All necessary indexes and RLS policies

### Step 2: Verify Tables Were Created

1. In Supabase, go to **Database > Tables**
2. You should see all 8 new tables listed
3. You can click on each table to verify the columns

### Step 3: Test Registration

1. Go back to the app
2. Try registering a new account
3. Check the browser console (F12) for logs showing:
   - "Starting signup with: ..."
   - "Profile created successfully" (if tables exist)
   - "User created: [user-id]"

### Troubleshooting

If you see "Profile creation error" in the console:

1. **Check RLS Policies**: The migration includes RLS policies that allow signup. If they're not applied:
   - Go to **Database > Tables > profiles > RLS Policies**
   - Verify these policies exist:
     - "Profiles: Create on signup"
     - "Profiles: Users read own profile"
     - "Profiles: Users update own profile"

2. **Check Table Structure**: Go to **Database > Tables > profiles** and verify columns:
   - id (UUID, Primary Key)
   - email (TEXT)
   - full_name (TEXT)
   - phone (TEXT)
   - role (TEXT)
   - avatar_url (TEXT, optional)
   - created_at (TIMESTAMP)
   - updated_at (TIMESTAMP)

3. **Check Logs**: In your terminal where `npm start` is running, look for detailed error messages from Supabase.

### After Setup

Once tables are created:
1. Registration will save user data to the `profiles` table
2. Patient medical info will save to `medical_profiles` table
3. Emergency requests will save to `emergency_requests` table
4. All data will be automatically synced via Supabase real-time subscriptions

## Database Schema Overview

```
auth.users (Supabase built-in)
    ↓
profiles (user roles: patient, driver, admin)
    ├── medical_profiles (patient medical history)
    └── emergency_requests (emergency SOS calls)
        ├── emergency_assignments (ambulance dispatch)
        └── hospital_assignments (hospital transfer)
```

## Additional Notes

- All tables use UUID primary keys
- Row Level Security (RLS) is enabled for data privacy
- Indexes are created for optimal query performance
- Timestamps are automatically managed
- Cascading deletes ensure data integrity
