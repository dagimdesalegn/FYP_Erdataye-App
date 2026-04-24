-- Database-backed ambulance registration approvals for hospital review workflow.

CREATE TABLE IF NOT EXISTS ambulance_registration_requests (
  user_id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  vehicle_number TEXT,
  registration_number TEXT,
  ambulance_type TEXT DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_ambulance_registration_requests_hospital_status
  ON ambulance_registration_requests (hospital_id, status, requested_at DESC);
