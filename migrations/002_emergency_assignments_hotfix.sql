-- Emergency Assignments Hotfix
-- Run this in Supabase SQL Editor if your project is missing public.emergency_assignments
-- or if the table exists but does not match app expectations.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.emergency_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  emergency_id UUID NOT NULL REFERENCES public.emergency_requests(id) ON DELETE CASCADE,
  ambulance_id UUID NOT NULL REFERENCES public.ambulances(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  pickup_eta_minutes INTEGER,
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.emergency_assignments
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS pickup_eta_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.emergency_assignments
  ALTER COLUMN status SET DEFAULT 'pending';

UPDATE public.emergency_assignments
SET status = 'pending'
WHERE status IS NULL;

ALTER TABLE public.emergency_assignments
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'emergency_assignments_status_check'
      AND conrelid = 'public.emergency_assignments'::regclass
  ) THEN
    ALTER TABLE public.emergency_assignments
      ADD CONSTRAINT emergency_assignments_status_check
      CHECK (status IN ('pending', 'accepted', 'declined'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

CREATE INDEX IF NOT EXISTS idx_emergency_assignments_emergency_id
  ON public.emergency_assignments(emergency_id);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_ambulance_id
  ON public.emergency_assignments(ambulance_id);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_status
  ON public.emergency_assignments(status);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_assigned_at
  ON public.emergency_assignments(assigned_at DESC);

ALTER TABLE public.emergency_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_assignments'
      AND policyname = 'Assignment: Drivers read own assignments'
  ) THEN
    CREATE POLICY "Assignment: Drivers read own assignments" ON public.emergency_assignments
      FOR SELECT
      USING (
        ambulance_id IN (SELECT id FROM public.ambulances WHERE driver_id = auth.uid()) OR
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_assignments'
      AND policyname = 'Assignment: Only admins create assignments'
  ) THEN
    CREATE POLICY "Assignment: Only admins create assignments" ON public.emergency_assignments
      FOR INSERT
      WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'emergency_assignments'
      AND policyname = 'Assignment: Drivers update own assignments'
  ) THEN
    CREATE POLICY "Assignment: Drivers update own assignments" ON public.emergency_assignments
      FOR UPDATE
      USING (
        ambulance_id IN (SELECT id FROM public.ambulances WHERE driver_id = auth.uid()) OR
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      )
      WITH CHECK (
        ambulance_id IN (SELECT id FROM public.ambulances WHERE driver_id = auth.uid()) OR
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
      );
  END IF;
END $$;
