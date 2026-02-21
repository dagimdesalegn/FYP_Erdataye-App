# 🚀 Quick Start Guide - ErdAtaye with Supabase

## ⚡ 30-Second Setup

```bash
# 1. Credentials already configured in .env.local ✓
# 2. Dependencies already installed ✓
# 3. Start dev server
npm start

# 4. Choose platform
# - Web: Press 'w'
# - Android: Press 'a'
# - iOS: Press 'i'
```

## ✅ What's Connected

| Component | Status | Details |
|-----------|--------|---------|
| Supabase URL | ✅ | Connected to production database |
| Authentication | ✅ | Email/password sign-up enabled |
| Profiles | ✅ | Patient, driver, staff management |
| Medical Data | ✅ | Blood type, allergies stored |
| Emergency Requests | ✅ | Real incident creation working |
| Location Tracking | ✅ | GPS updates to database |
| Ambulance Finder | ✅ | PostGIS nearest-search enabled |
| Real-time Chat | ✅ | First-aid conversations stored |

## 📱 Test the Emergency System

### 1. Register
- Open the app  
- Click "Register"
- Enter credentials (real email optional for testing)
- Fill medical info (blood type, phone, contacts)
- Submit

### 2. Call Emergency
- Go to Emergency screen
- Tap big red "CALL AMBULANCE" button
- App will:
  - Get your GPS location
  - Create emergency_request in Supabase
  - Find nearest ambulances
  - Show nearby vehicles

### 3. Verify in Supabase Dashboard
- Go to https://app.supabase.com
- Check `emergency_requests` table for your request
- Check `profiles` table for your user
- Check `location_updates` for GPS data

## 🔍 Check Real Data Connections

### Database Tables
```typescript
// Check these exist in your database:
profiles
medical_profiles
emergency_requests
ambulances
hospitals
location_updates
chat_history
```

### API Keys
```
SUPABASE_URL: https://padezipdfcicydyncmkw.supabase.co
SUPABASE_ANON_KEY: Configured ✓
```

## 🛠️ Development Workflow

```bash
# Watch for changes
npm start

# Run linter
npm run lint

# Type checking
npx tsc --noEmit

# Rebuild if needed
npm run reset-project
```

## 📍 File Structure

```
app/
├── emergency.tsx         ← Emergency request creation
├── register.tsx          ← User signup with Supabase Auth
└── (tabs)/              ← Main app screens

utils/
├── supabase.ts          ← Supabase client config
├── auth.ts              ← Authentication functions
├── emergency.ts         ← Emergency & ambulance logic
├── profile.ts           ← User profile management
└── chat.ts              ← AI first-aid chat

components/
└── app-state.tsx        ← Global auth state (with Supabase)
```

## 🤔 Troubleshooting

**"Cannot find module" errors?**
```bash
rm -rf node_modules
npm install
```

**Supabase connection failing?**
- Verify .env.local has correct credentials
- Check network connectivity
- Restart dev server with `npm start`

**Real-time updates not working?**
- Ensure `location_updates` table has real-time replication enabled
- Check RLS policies in Supabase dashboard

## 📞 Next Steps

1. **Deploy to test device:**
   ```bash
   npm run ios    # iPhone
   npm run android # Android
   ```

2. **Add more features:**
   - Driver app (claim emergencies)
   - Hospital dashboard (incoming patients)
   - Admin analytics

3. **Customize:**
   - Edit database schema in Supabase
   - Modify RLS policies
   - Add new tables

## 🎯 Key Features Ready

✨ **Real Authentication** - Supabase Auth  
✨ **Live GPS Tracking** - PostGIS enabled  
✨ **Instant Sync** - Real-time database  
✨ **Secure Data** - RLS policies active  
✨ **Medical Profiles** - Patient metadata  
✨ **Ambulance Routing** - Nearest-search ready  

You're all set! 🚀
