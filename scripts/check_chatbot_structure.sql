-- Run this in Supabase SQL Editor to verify chatbot table structure

-- 1) Table columns
SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'chatbot_messages'
ORDER BY ordinal_position;

-- 2) Indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'chatbot_messages'
ORDER BY indexname;

-- 3) Row level security policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'chatbot_messages'
ORDER BY policyname;

-- 4) Quick stats
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT user_id) AS distinct_users
FROM public.chatbot_messages;
