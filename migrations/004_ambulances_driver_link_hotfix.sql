-- Ambulances Driver Link Hotfix
-- Run in Supabase SQL Editor if you see:
-- "column ambulances.driver_id does not exist"

ALTER TABLE public.ambulances
  ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill driver_id from legacy columns when available.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ambulances'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.ambulances a
    SET driver_id = p.id
    FROM public.profiles p
    WHERE a.driver_id IS NULL
      AND a.user_id IS NOT NULL
      AND p.id::text = a.user_id::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ambulances'
      AND column_name = 'driver_user_id'
  ) THEN
    UPDATE public.ambulances a
    SET driver_id = p.id
    FROM public.profiles p
    WHERE a.driver_id IS NULL
      AND a.driver_user_id IS NOT NULL
      AND p.id::text = a.driver_user_id::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ambulances'
      AND column_name = 'assigned_driver_id'
  ) THEN
    UPDATE public.ambulances a
    SET driver_id = p.id
    FROM public.profiles p
    WHERE a.driver_id IS NULL
      AND a.assigned_driver_id IS NOT NULL
      AND p.id::text = a.assigned_driver_id::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ambulances'
      AND column_name = 'driver'
  ) THEN
    UPDATE public.ambulances a
    SET driver_id = p.id
    FROM public.profiles p
    WHERE a.driver_id IS NULL
      AND a.driver IS NOT NULL
      AND p.id::text = a.driver::text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ambulances_driver_id ON public.ambulances(driver_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ambulances'
      AND policyname = 'Ambulance: Drivers update own ambulance'
  ) THEN
    CREATE POLICY "Ambulance: Drivers update own ambulance" ON public.ambulances
      FOR UPDATE
      USING (driver_id = auth.uid())
      WITH CHECK (driver_id = auth.uid());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
