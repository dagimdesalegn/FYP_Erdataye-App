# Quick Start Guide - ErdAtaye with Supabase

## 30-Second Setup

```bash
# 1. Create local environment file
cp .env.example .env.local

# 2. Add Supabase credentials to .env.local
# EXPO_PUBLIC_SUPABASE_URL=...
# EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...

# 3. Install dependencies (if needed)
npm install

# 4. Start dev server
npm start

# 5. Choose platform
# - Web: Press 'w'
# - Android: Press 'a'
# - iOS: Press 'i'
```

## What's Connected

| Component | Status | Details |
|-----------|--------|---------|
| Supabase URL | Ready | Uses `EXPO_PUBLIC_SUPABASE_URL` |
| Authentication | Ready | Email/password sign-up enabled |
| Profiles | Ready | Patient, driver, and staff profile support |
| Medical Data | Ready | Blood type and allergies storage |
| Emergency Requests | Ready | Incident creation in database |
| Location Tracking | Ready | GPS updates to database |
| Ambulance Finder | Ready | PostGIS nearest-search integration |
| Real-time Chat | Ready | Message storage and subscriptions |

## Check Real Data Connections

### Database Tables

```text
profiles
medical_profiles
emergency_requests
ambulances
hospitals
location_updates
chat_history
```

### Environment Variables

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
# Optional legacy fallback:
# EXPO_PUBLIC_SUPABASE_ANON_KEY=your_legacy_anon_key
```

## Development Workflow

```bash
npm start
npm run lint
npx tsc --noEmit
```

## Troubleshooting

- Verify `.env.local` exists and has valid keys.
- Restart dev server after env changes.
- Ensure Supabase RLS policies allow the intended operations.
- Ensure realtime replication is enabled for tables that use subscriptions.
