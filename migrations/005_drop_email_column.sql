-- Migration 005: Drop email column from profiles table
-- Phone number is now the sole identifier (no more email in profiles)
-- Note: Supabase Auth (auth.users) still uses a synthetic email internally
--       e.g. 2519XXXXXXXX@phone.erdataye.app — that is NOT affected by this migration.

-- Drop the email column from the profiles table
ALTER TABLE profiles DROP COLUMN IF EXISTS email;
