-- Run this in Supabase SQL Editor to inspect full public DB structure

-- 1) All public tables
SELECT
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2) Columns for all public tables
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 3) Constraints (PK/FK/UNIQUE/CHECK)
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
  AND tc.table_schema = ccu.table_schema
WHERE tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4) Indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 5) Triggers
SELECT
  trigger_schema,
  event_object_table AS table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 6) RLS enabled status
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 7) RLS policies
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 8) Approximate row counts per table
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS approx_rows
FROM pg_stat_user_tables
ORDER BY schemaname, relname;

-- 9) App-focused row counts (public schema only)
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;

-- 10) Critical app tables status snapshot
SELECT 'profiles' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.profiles
UNION ALL
SELECT 'medical_profiles' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.medical_profiles
UNION ALL
SELECT 'emergency_requests' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.emergency_requests
UNION ALL
SELECT 'emergency_assignments' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.emergency_assignments
UNION ALL
SELECT 'hospitals' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.hospitals
UNION ALL
SELECT 'chatbot_messages' AS table_name, COUNT(*)::BIGINT AS row_count FROM public.chatbot_messages;
