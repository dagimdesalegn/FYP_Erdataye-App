-- Ambulances table schema for Supabase
CREATE TABLE IF NOT EXISTS ambulances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_number text NOT NULL,
    registration_number text,
    type text,
    is_available boolean NOT NULL DEFAULT true,
    hospital_id uuid,
    current_driver_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_ambulances_vehicle_number ON ambulances(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_ambulances_current_driver_id ON ambulances(current_driver_id);
CREATE INDEX IF NOT EXISTS idx_ambulances_is_available ON ambulances(is_available);

-- Foreign key example (if hospital_id links to hospitals table)
-- ALTER TABLE ambulances ADD CONSTRAINT fk_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(id);
