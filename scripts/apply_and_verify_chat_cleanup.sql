-- Run in Supabase SQL Editor
-- Purpose: remove legacy chat_history and verify chatbot table + required users

-- 1) Drop legacy table
DROP TABLE IF EXISTS public.chat_history CASCADE;

-- 2) Verify legacy table removed
SELECT
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('chat_history', 'chatbot_messages')
ORDER BY table_name;

-- 3) Verify chatbot table basic health
SELECT
  COUNT(*) AS chatbot_rows,
  COUNT(DISTINCT user_id) AS chatbot_distinct_users
FROM public.chatbot_messages;

-- 4) Verify role constraint allows hospital
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND conname = 'profiles_role_check';

-- 5) Verify admin and hospital profile rows
SELECT
  p.id,
  u.phone,
  p.full_name,
  p.phone,
  p.role,
  p.created_at
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.role IN ('admin', 'hospital')
ORDER BY p.role, p.created_at DESC;

-- 6) Verify matching auth users exist (phone-based setup; id join)
SELECT
  u.id AS auth_user_id,
  u.phone,
  p.id AS profile_id,
  p.role,
  u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.role IN ('admin', 'hospital')
ORDER BY p.role, u.created_at DESC;
