-- Run this in Supabase SQL Editor
-- Goal: make profiles.role store 'ambulance' instead of 'driver'

begin;

-- 1) Drop old role check constraint (name may vary across projects)
alter table public.profiles
  drop constraint if exists profiles_role_check;

-- 2) Normalize existing role values BEFORE adding the new constraint
update public.profiles
set role = 'ambulance'
where lower(role) = 'driver';

-- 3) Add new role check with ambulance
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('patient','ambulance','admin','hospital'));

commit;
