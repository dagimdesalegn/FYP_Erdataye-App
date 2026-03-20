-- Run this in Supabase SQL Editor to inspect all public tables and columns

select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- Optional: see table constraints (including checks and foreign keys)
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type
from information_schema.table_constraints tc
where tc.table_schema = 'public'
order by tc.table_name, tc.constraint_type, tc.constraint_name;
