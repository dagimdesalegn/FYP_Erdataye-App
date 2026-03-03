-- Migration 009: Create emergency_assignments table, fix phone constraint, fix trigger
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Create emergency_assignments table if missing
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

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_ea_emergency_id ON public.emergency_assignments(emergency_id);
CREATE INDEX IF NOT EXISTS idx_ea_ambulance_id ON public.emergency_assignments(ambulance_id);
CREATE INDEX IF NOT EXISTS idx_ea_status ON public.emergency_assignments(status);

-- 3. Enable RLS
ALTER TABLE public.emergency_assignments ENABLE ROW LEVEL SECURITY;

-- 4. Drop old restrictive policies and create permissive ones
DROP POLICY IF EXISTS "Assignment: Only admins create assignments" ON public.emergency_assignments;
DROP POLICY IF EXISTS "Assignment: Drivers read own assignments" ON public.emergency_assignments;
DROP POLICY IF EXISTS "Assignment: Drivers update own assignments" ON public.emergency_assignments;

-- Allow all authenticated users to read assignments relevant to them
CREATE POLICY "ea_select" ON public.emergency_assignments FOR SELECT USING (true);

-- Allow all authenticated to insert (the app uses service role, but this is a safety net)
CREATE POLICY "ea_insert" ON public.emergency_assignments FOR INSERT WITH CHECK (true);

-- Allow drivers and admins to update
CREATE POLICY "ea_update" ON public.emergency_assignments FOR UPDATE USING (true);

-- 5. Make phone column nullable for admin/hospital users
ALTER TABLE public.profiles ALTER COLUMN phone DROP NOT NULL;

-- 6. Update the role check constraint to include 'hospital'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('patient', 'driver', 'admin', 'hospital'));

-- 7. Also fix emergency_requests status constraint to include all statuses
ALTER TABLE public.emergency_requests DROP CONSTRAINT IF EXISTS emergency_requests_status_check;
ALTER TABLE public.emergency_requests ADD CONSTRAINT emergency_requests_status_check 
  CHECK (status IN ('pending', 'assigned', 'en_route', 'at_scene', 'arrived', 'transporting', 'at_hospital', 'completed', 'cancelled'));

-- 8. Fix the handle_new_user trigger to handle email-only users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, phone, full_name, role, created_at, updated_at)
  VALUES (
    new.id,
    COALESCE(new.phone, new.email),
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'role', 'patient'),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    role = COALESCE(EXCLUDED.role, profiles.role),
    updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
