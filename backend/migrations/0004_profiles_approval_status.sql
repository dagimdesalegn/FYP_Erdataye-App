-- Optional columns for ambulance onboarding + hospital staff linkage.
-- Run in Supabase SQL editor if migrations are not auto-applied.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status text;

COMMENT ON COLUMN public.profiles.approval_status IS
  'Ambulance/driver registration: pending | approved | rejected (NULL treated as pending in app).';

UPDATE public.profiles
SET approval_status = 'pending'
WHERE approval_status IS NULL
  AND lower(coalesce(role, '')) IN ('ambulance', 'driver');

-- Help hospital dashboard users: sync hospital_id from JWT-backed metadata is handled in API;
-- this only backfills when a profile row exists with NULL hospital_id but role is hospital.
UPDATE public.profiles p
SET hospital_id = h.id
FROM public.hospitals h
WHERE lower(coalesce(p.role, '')) = 'hospital'
  AND p.hospital_id IS NULL
  AND btrim(coalesce(p.phone, '')) <> ''
  AND h.phone = p.phone;
