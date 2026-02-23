-- Patient-Focused Schema
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'driver', 'admin')),
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Medical profiles for patients
CREATE TABLE IF NOT EXISTS public.medical_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  blood_type TEXT,
  allergies TEXT[],
  medical_conditions TEXT[],
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  medications TEXT[],
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Emergency requests from patients
CREATE TABLE IF NOT EXISTS public.emergency_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'en_route', 'arrived', 'at_hospital', 'completed', 'cancelled')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT,
  patient_condition TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ambulances available for dispatch
CREATE TABLE IF NOT EXISTS public.ambulances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_call', 'in_service', 'maintenance')),
  current_latitude DECIMAL(10, 8),
  current_longitude DECIMAL(11, 8),
  capacity INTEGER DEFAULT 2,
  equipment TEXT[],
  driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Assignment of ambulances to emergencies
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

-- Location tracking for ambulances
CREATE TABLE IF NOT EXISTS public.ambulance_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ambulance_id UUID NOT NULL REFERENCES public.ambulances(id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Hospital information
CREATE TABLE IF NOT EXISTS public.hospitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  phone TEXT,
  emergency_beds INTEGER,
  specialties TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Emergency request to hospital assignments
CREATE TABLE IF NOT EXISTS public.hospital_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  emergency_id UUID NOT NULL REFERENCES public.emergency_requests(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  arrival_eta_minutes INTEGER,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_medical_profiles_user_id ON public.medical_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_patient_id ON public.emergency_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_status ON public.emergency_requests(status);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_created_at ON public.emergency_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ambulances_driver_id ON public.ambulances(driver_id);
CREATE INDEX IF NOT EXISTS idx_ambulances_status ON public.ambulances(status);
CREATE INDEX IF NOT EXISTS idx_ambulance_locations_ambulance_id ON public.ambulance_locations(ambulance_id);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_emergency_id ON public.emergency_assignments(emergency_id);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_ambulance_id ON public.emergency_assignments(ambulance_id);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_status ON public.emergency_assignments(status);
CREATE INDEX IF NOT EXISTS idx_emergency_assignments_assigned_at ON public.emergency_assignments(assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_hospital_assignments_emergency_id ON public.hospital_assignments(emergency_id);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambulances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambulance_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES - PATIENT FOCUSED
-- ============================================

-- PROFILES: Users can read their own, drivers/admins can read all
CREATE POLICY "Profiles: Users read own profile" ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('driver', 'admin')
  );

CREATE POLICY "Profiles: Users update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Profiles: Users can signup" ON public.profiles
  FOR INSERT
  WITH CHECK (true);

-- MEDICAL PROFILES: Patients can read/update own, drivers/admins can read all
CREATE POLICY "Medical: Patients read own medical profile" ON public.medical_profiles
  FOR SELECT
  USING (
    auth.uid() = user_id OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('driver', 'admin')
  );

CREATE POLICY "Medical: Patients update own medical profile" ON public.medical_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Medical: Patients create own medical profile" ON public.medical_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- EMERGENCY REQUESTS: Patients can CRUD own, drivers/admins can read all
CREATE POLICY "Emergency: Patients read own requests" ON public.emergency_requests
  FOR SELECT
  USING (
    patient_id = auth.uid() OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('driver', 'admin')
  );

CREATE POLICY "Emergency: Patients create emergencies" ON public.emergency_requests
  FOR INSERT
  WITH CHECK (
    patient_id = auth.uid() AND
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'patient'
  );

CREATE POLICY "Emergency: Patients update own emergency status" ON public.emergency_requests
  FOR UPDATE
  USING (patient_id = auth.uid())
  WITH CHECK (patient_id = auth.uid());

CREATE POLICY "Emergency: Admins update any emergency" ON public.emergency_requests
  FOR UPDATE
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- AMBULANCES: All can read available ambulances, drivers can read/update own
CREATE POLICY "Ambulance: All read ambulances" ON public.ambulances
  FOR SELECT
  USING (true);

CREATE POLICY "Ambulance: Drivers update own ambulance" ON public.ambulances
  FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Ambulance: Admins manage all ambulances" ON public.ambulances
  FOR ALL
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- EMERGENCY ASSIGNMENTS: Drivers can read assignments for their ambulance
CREATE POLICY "Assignment: Drivers read own assignments" ON public.emergency_assignments
  FOR SELECT
  USING (
    ambulance_id IN (SELECT id FROM public.ambulances WHERE driver_id = auth.uid()) OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Assignment: Only admins create assignments" ON public.emergency_assignments
  FOR INSERT
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

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

-- AMBULANCE LOCATIONS: Only drivers can insert/update own, admins can manage all
CREATE POLICY "Location: Drivers update own location" ON public.ambulance_locations
  FOR INSERT
  WITH CHECK (
    ambulance_id IN (SELECT id FROM public.ambulances WHERE driver_id = auth.uid())
  );

CREATE POLICY "Location: All read ambulance locations" ON public.ambulance_locations
  FOR SELECT
  USING (true);

-- HOSPITALS: All can read hospital information
CREATE POLICY "Hospital: All read hospitals" ON public.hospitals
  FOR SELECT
  USING (true);

-- HOSPITAL ASSIGNMENTS: Patients read their assignments, admins manage
CREATE POLICY "Hospital Assignment: Patients read own assignments" ON public.hospital_assignments
  FOR SELECT
  USING (
    emergency_id IN (
      SELECT id FROM public.emergency_requests WHERE patient_id = auth.uid()
    ) OR
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );
