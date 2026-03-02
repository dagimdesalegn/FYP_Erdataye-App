-- Fix: emergency_requests_status_check constraint
-- The current constraint is missing some status values used by the app
-- ('pending' for patient inserts, 'at_scene' / 'transporting' for driver updates).
-- This migration drops the old constraint and recreates it with the full superset.

-- 1) Drop ALL check constraints on the status column (both named and unnamed)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attnum = ANY(con.conkey)
                         AND att.attrelid = con.conrelid
    WHERE con.conrelid = 'public.emergency_requests'::regclass
      AND att.attname = 'status'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.emergency_requests DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped constraint %', r.conname;
  END LOOP;
END $$;

-- 2) Recreate with the complete set of status values used across the app
ALTER TABLE public.emergency_requests
  ADD CONSTRAINT emergency_requests_status_check
  CHECK (status IN (
    'pending',       -- patient just created the request
    'assigned',      -- ambulance assigned
    'en_route',      -- driver heading to patient
    'at_scene',      -- driver arrived at patient location
    'arrived',       -- (legacy alias for at_scene)
    'transporting',  -- patient picked up, heading to hospital
    'at_hospital',   -- arrived at hospital
    'completed',     -- emergency resolved
    'cancelled'      -- cancelled by patient or admin
  ));

-- 3) Ensure the default is 'pending' so inserts without explicit status work
ALTER TABLE public.emergency_requests
  ALTER COLUMN status SET DEFAULT 'pending';
