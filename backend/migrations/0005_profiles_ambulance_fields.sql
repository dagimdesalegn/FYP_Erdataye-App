-- Ambulance/driver registration fields on profiles (used by hospital approvals + /profiles/me).
-- Run in Supabase SQL editor if not applied automatically.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vehicle_number text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registration_number text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ambulance_type text DEFAULT 'standard';

COMMENT ON COLUMN public.profiles.vehicle_number IS
  'Plate / fleet id; mirrored from registration request for hospital review.';
COMMENT ON COLUMN public.profiles.registration_number IS
  'Vehicle registration document number.';
COMMENT ON COLUMN public.profiles.ambulance_type IS
  'standard | advanced | icu';
