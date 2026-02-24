-- Emergency Requests Location Hotfix
-- Run this in Supabase SQL Editor if emergency_requests is missing latitude/longitude
-- or if the table shape is from an older schema.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.emergency_requests
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS patient_condition TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

UPDATE public.emergency_requests
SET status = 'pending'
WHERE status IS NULL;

UPDATE public.emergency_requests
SET severity = 'medium'
WHERE severity IS NULL;

ALTER TABLE public.emergency_requests
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN severity SET DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'emergency_requests_status_check'
      AND conrelid = 'public.emergency_requests'::regclass
  ) THEN
    ALTER TABLE public.emergency_requests
      ADD CONSTRAINT emergency_requests_status_check
      CHECK (status IN ('pending', 'assigned', 'en_route', 'arrived', 'at_hospital', 'completed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'emergency_requests_severity_check'
      AND conrelid = 'public.emergency_requests'::regclass
  ) THEN
    ALTER TABLE public.emergency_requests
      ADD CONSTRAINT emergency_requests_severity_check
      CHECK (severity IN ('low', 'medium', 'high', 'critical'));
  END IF;
END $$;

-- Backfill latitude/longitude from legacy location fields when available.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'emergency_requests'
      AND column_name = 'location'
      AND data_type IN ('json', 'jsonb')
  ) THEN
    UPDATE public.emergency_requests
    SET
      latitude = COALESCE(
        latitude,
        CASE WHEN (location->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (location->>'lat')::numeric END,
        CASE WHEN (location->>'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (location->>'latitude')::numeric END
      ),
      longitude = COALESCE(
        longitude,
        CASE WHEN (location->>'lon') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (location->>'lon')::numeric END,
        CASE WHEN (location->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (location->>'lng')::numeric END,
        CASE WHEN (location->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (location->>'longitude')::numeric END
      )
    WHERE latitude IS NULL OR longitude IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'emergency_requests' AND column_name = 'location_lat'
  ) THEN
    UPDATE public.emergency_requests
    SET latitude = COALESCE(latitude, location_lat::numeric)
    WHERE latitude IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'emergency_requests' AND column_name = 'location_lon'
  ) THEN
    UPDATE public.emergency_requests
    SET longitude = COALESCE(longitude, location_lon::numeric)
    WHERE longitude IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'emergency_requests' AND column_name = 'location_lng'
  ) THEN
    UPDATE public.emergency_requests
    SET longitude = COALESCE(longitude, location_lng::numeric)
    WHERE longitude IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_emergency_requests_patient_id
  ON public.emergency_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_status
  ON public.emergency_requests(status);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_created_at
  ON public.emergency_requests(created_at DESC);

ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_requests'
      AND policyname = 'Emergency: Patients read own requests'
  ) THEN
    CREATE POLICY "Emergency: Patients read own requests" ON public.emergency_requests
      FOR SELECT
      USING (
        patient_id = auth.uid() OR
        (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('driver', 'admin')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_requests'
      AND policyname = 'Emergency: Patients create emergencies'
  ) THEN
    CREATE POLICY "Emergency: Patients create emergencies" ON public.emergency_requests
      FOR INSERT
      WITH CHECK (
        patient_id = auth.uid() AND
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'patient'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_requests'
      AND policyname = 'Emergency: Patients update own emergency status'
  ) THEN
    CREATE POLICY "Emergency: Patients update own emergency status" ON public.emergency_requests
      FOR UPDATE
      USING (patient_id = auth.uid())
      WITH CHECK (patient_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_requests'
      AND policyname = 'Emergency: Admins update any emergency'
  ) THEN
    CREATE POLICY "Emergency: Admins update any emergency" ON public.emergency_requests
      FOR UPDATE
      USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
