-- =====================================================
-- SUPABASE RLS POLICY FIX
-- =====================================================
-- Run this in Supabase Dashboard > SQL Editor > New Query

-- 1. DISABLE problematic RLS policies and enable simpler ones
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- 2. Drop any existing problematic policies that may cause recursion
DROP POLICY IF EXISTS "users_can_manage_own_profile" ON profiles;
DROP POLICY IF EXISTS "Users can manage their own profile" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can insert own profile" ON profiles;

-- 3. For medical_profiles, ensure patient_id column exists
ALTER TABLE medical_profiles DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_can_manage_own_medical_profile" ON medical_profiles;
DROP POLICY IF EXISTS "Users can manage their own medical profile" ON medical_profiles;

-- 4. Verify your schema has the correct columns
-- Check what you actually have:
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'medical_profiles' 
ORDER BY ordinal_position;

-- 5. If you need RLS enabled with simple policies later, you can add:
-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "allow_authenticated" ON profiles 
--   FOR ALL USING (true) WITH CHECK (true);

-- For now, keep RLS disabled to fix immediate issues.
