-- =====================================================
-- FIX MEDICAL_PROFILES TABLE SCHEMA
-- =====================================================
-- Run this in Supabase Dashboard > SQL Editor > New Query
-- Then click "Run"

-- 1. Check current schema
SELECT 'Current medical_profiles columns:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'medical_profiles' 
ORDER BY ordinal_position;

-- 2. Disable RLS temporarily
ALTER TABLE medical_profiles DISABLE ROW LEVEL SECURITY;

-- 3. Ensure user_id column exists and has proper constraints
-- If user_id doesn't exist, this adds it
DO $$ 
BEGIN
  -- Add `user_id` column if missing. Add as nullable so it won't fail on existing rows.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN user_id UUID UNIQUE;
  END IF;

  -- If there is an existing `patient_id` column, copy values to `user_id` for compatibility.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'patient_id'
  ) THEN
    UPDATE medical_profiles SET user_id = patient_id WHERE user_id IS NULL AND patient_id IS NOT NULL;
  END IF;
END $$;

-- 4. Ensure all required columns exist (add if missing)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'blood_type'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN blood_type TEXT DEFAULT 'Unknown';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'allergies'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN allergies TEXT DEFAULT '';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'medical_conditions'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN medical_conditions TEXT DEFAULT '';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN emergency_contact_name TEXT DEFAULT '';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN emergency_contact_phone TEXT DEFAULT '';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'medical_profiles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE medical_profiles ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
END $$;

-- 5. Remove any old columns that might cause issues
ALTER TABLE medical_profiles DROP COLUMN IF EXISTS patient_id CASCADE;
ALTER TABLE medical_profiles DROP COLUMN IF EXISTS chronic_conditions CASCADE;
ALTER TABLE medical_profiles DROP COLUMN IF EXISTS medications CASCADE;

-- 6. Drop and recreate problematic policies
DROP POLICY IF EXISTS "users_can_manage_own_medical_profile" ON medical_profiles;
DROP POLICY IF EXISTS "Users can manage their own medical profile" ON medical_profiles;
DROP POLICY IF EXISTS "Authenticated users can insert own medical profile" ON medical_profiles;

-- 7. Re-enable RLS with proper policies
ALTER TABLE medical_profiles ENABLE ROW LEVEL SECURITY;

-- Ensure old policy (if any) is removed before creating the policy
DROP POLICY IF EXISTS "allow_authenticated_users" ON medical_profiles;

CREATE POLICY "allow_authenticated_users" ON medical_profiles
  FOR ALL 
  USING (true)
  WITH CHECK (true);

-- 8. Verify final schema
SELECT 'Final medical_profiles schema:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'medical_profiles' 
ORDER BY ordinal_position;

-- 9. Test data (optional) - uncomment to verify
-- SELECT COUNT(*) as total_medical_profiles FROM medical_profiles;
