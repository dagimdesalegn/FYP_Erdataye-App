-- Run in Supabase SQL Editor
-- Purpose: compare your DB tables with tables expected by this app project

WITH expected_tables AS (
  SELECT unnest(ARRAY[
    'profiles',
    'medical_profiles',
    'emergency_requests',
    'ambulances',
    'emergency_assignments',
    'ambulance_locations',
    'hospitals',
    'hospital_assignments',
    'chatbot_messages'
  ]) AS table_name
),
public_tables AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
),
matched AS (
  SELECT e.table_name
  FROM expected_tables e
  INNER JOIN public_tables p ON p.table_name = e.table_name
),
missing AS (
  SELECT e.table_name
  FROM expected_tables e
  LEFT JOIN public_tables p ON p.table_name = e.table_name
  WHERE p.table_name IS NULL
),
extra AS (
  SELECT p.table_name
  FROM public_tables p
  LEFT JOIN expected_tables e ON e.table_name = p.table_name
  WHERE e.table_name IS NULL
)
SELECT 'MATCHED' AS status, table_name FROM matched
UNION ALL
SELECT 'MISSING' AS status, table_name FROM missing
UNION ALL
SELECT 'EXTRA' AS status, table_name FROM extra
ORDER BY status, table_name;

-- Optional: generate drop commands for EXTRA public tables (review before running)
WITH expected_tables AS (
  SELECT unnest(ARRAY[
    'profiles',
    'medical_profiles',
    'emergency_requests',
    'ambulances',
    'emergency_assignments',
    'ambulance_locations',
    'hospitals',
    'hospital_assignments',
    'chatbot_messages'
  ]) AS table_name
)
SELECT
  'DROP TABLE IF EXISTS public.' || quote_ident(p.table_name) || ' CASCADE;' AS drop_sql
FROM information_schema.tables p
LEFT JOIN expected_tables e ON e.table_name = p.table_name
WHERE p.table_schema = 'public'
  AND p.table_type = 'BASE TABLE'
  AND e.table_name IS NULL
ORDER BY p.table_name;
