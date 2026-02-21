# 🔧 Fix 400 Bad Request Error on Medical Profiles

## Problem

Your app is getting a **400 Bad Request** error when trying to register:

```
POST https://padezipdfcicydyncmkw.supabase.co/rest/v1/medical_profiles?on_conflict=patient_id
Status: 400 Bad Request
```

This happens because the `medical_profiles` table schema doesn't match what your app is trying to send.

## Root Causes

1. **Wrong column name**: Code used `patient_id`, but table expects `user_id`
2. **Wrong field names**: Code tried to insert `chronic_conditions` and `medications`, but table has `medical_conditions`
3. **Invalid upsert**: Tried using `onConflict: 'patient_id'` but column doesn't have proper unique constraint
4. **Schema mismatch**: Possible missing columns in the table

## Solution

### Step 1: Fix the Database Schema

1. **Open Supabase Dashboard**: https://app.supabase.com
2. **Select your project**: `padezipdfcicydyncmkw`
3. **Go to**: SQL Editor → New Query
4. **Copy all SQL** from: [FIX_MEDICAL_PROFILES_SCHEMA.sql](./FIX_MEDICAL_PROFILES_SCHEMA.sql)
5. **Click**: "Run"
6. **Wait** for ✅ green checkmark

### Step 2: Verify the Fix in Your Code

The app code has been updated to:
- Use `user_id` instead of `patient_id`
- Use `medical_conditions` instead of `chronic_conditions`
- Remove `medications` field
- Use a safer insert/update pattern instead of upsert

### Step 3: Test Registration

1. **Clear app cache** (if on mobile):
   - iOS: Delete app and reinstall
   - Android: Settings → Apps → Erdataye → Clear Cache
   - Web: Browser dev tools → Storage → Clear All

2. **Try registering again** with an email address (use a new one each time)

3. **Check success**:
   - Should see smooth loading animation
   - Redirected to home screen after 2.5 seconds
   - In Supabase, check:
     - `auth` → `users`: Your email should be there
     - `profiles` table: Your name, phone, role
     - `medical_profiles` table: Your blood type, allergies, emergency contact

## What Changed

### Code Changes (Already Applied)

**File**: [utils/profile.ts](utils/profile.ts)

**Changes**:
- ✅ Use `user_id` instead of `patient_id`
- ✅ Use `medical_conditions` instead of `chronic_conditions`
- ✅ Remove `medications` field (doesn't exist in schema)
- ✅ Replace problematic `upsert()` with safer check-then-insert/update pattern

### Database Changes (Required)

**File**: [FIX_MEDICAL_PROFILES_SCHEMA.sql](FIX_MEDICAL_PROFILES_SCHEMA.sql)

This SQL script:
- ✅ Verifies all required columns exist
- ✅ Adds missing columns
- ✅ Removes old columns that cause issues
- ✅ Sets up proper RLS policies
- ✅ Ensures proper constraints and defaults

## Troubleshooting

If you still get errors:

1. **Verify columns in Supabase**:
   - Dashboard → Database → Tables → `medical_profiles` → Columns tab
   - Should have: `id`, `user_id`, `blood_type`, `allergies`, `medical_conditions`, `emergency_contact_name`, `emergency_contact_phone`, `created_at`, `updated_at`

2. **Check RLS is enabled**:
   - Dashboard → Database → Tables → `medical_profiles` → Auth Policies tab
   - Should have policy: `allow_authenticated_users`

3. **Clear and retry**:
   - Close app completely
   - Clear cache (settings)
   - Try registering with a NEW email address

4. **Check browser console** (web):
   - Open DevTools (F12)
   - Check Console tab for detailed error messages
   - Look for network tab to see actual response body

## Reference

- **Supabase Dashboard**: https://app.supabase.com/project/padezipdfcicydyncmkw
- **Related Files**:
  - [utils/profile.ts](utils/profile.ts) - Fixed upsertMedicalProfile function
  - [FIX_MEDICAL_PROFILES_SCHEMA.sql](FIX_MEDICAL_PROFILES_SCHEMA.sql) - Database fixes
  - [REGISTRATION_FIX_GUIDE.md](REGISTRATION_FIX_GUIDE.md) - Previous registration fixes
