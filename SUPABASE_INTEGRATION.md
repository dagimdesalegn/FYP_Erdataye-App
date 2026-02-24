# ErdAtaye Emergency Response System - Supabase Integration

## Overview

This app integrates Supabase for:

- Authentication
- PostgreSQL data storage
- PostGIS geospatial queries
- Realtime subscriptions

## Configuration

Create `.env.local` with:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
# Optional legacy fallback:
# EXPO_PUBLIC_SUPABASE_ANON_KEY=your_legacy_anon_key
```

Notes:

- In Expo client code, use `EXPO_PUBLIC_*` variables only.
- Do not use service role keys in the mobile app.

## Current Client Modules

- `utils/supabase.ts`: Supabase client initialization
- `utils/auth.ts`: sign-up, sign-in, sign-out, session helpers
- `utils/profile.ts`: profile and medical profile CRUD
- `utils/emergency.ts`: emergency workflows and location updates
- `utils/chat.ts`: chat history and realtime chat subscription
- `utils/diagnostics.ts`: diagnostic helpers

## Security Expectations

- Enable Row Level Security (RLS) on all user data tables.
- Use policies scoped by `auth.uid()` for patient/driver/admin access.
- Keep publishable/anon keys in client env only.
- Keep service role keys server-side only.

## Realtime Tables

Enable realtime replication for tables used by subscriptions, including:

- `location_updates`
- `chat_history`
- `emergency_requests` (if live status updates are needed)

## Smoke Test

1. Register a user in app.
2. Confirm a row is created in `auth.users` and `profiles`.
3. Submit emergency request.
4. Confirm a row appears in `emergency_requests`.
5. Validate location/chat subscriptions receive changes.
