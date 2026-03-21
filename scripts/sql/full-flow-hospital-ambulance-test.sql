-- Full flow SQL: inspect locations, update hospital location, link ambulance, and verify ETA behavior.
-- Run this in Supabase SQL Editor.
-- Pre-filled IDs:
-- patient_id   = 0b08ccea-919a-4191-aed9-500c312e93cd
-- hospital_id  = 98c92944-f2bd-4ef5-b346-956fb06ec488
-- ambulance_id = f0f3b5e6-4a43-44c7-97d1-ecfa264a576e

-- =====================================================
-- 1) Inspect latest active emergency with patient + ambulance + hospital coordinates
-- =====================================================
WITH latest_emergency AS (
  SELECT
    e.id,
    e.patient_id,
    e.status,
    e.hospital_id,
    e.assigned_ambulance_id,
    e.created_at,
    e.updated_at,
    e.patient_location
  FROM emergency_requests e
  WHERE e.patient_id = '0b08ccea-919a-4191-aed9-500c312e93cd'
    AND e.status NOT IN ('completed', 'cancelled')
  ORDER BY e.created_at DESC
  LIMIT 1
)
SELECT
  le.id AS emergency_id,
  le.patient_id,
  le.status,
  ST_AsText(le.patient_location::geometry) AS patient_location_wkt,
  ST_Y(le.patient_location::geometry) AS patient_lat,
  ST_X(le.patient_location::geometry) AS patient_lng,

  a.id AS ambulance_id,
  a.vehicle_number,
  a.hospital_id AS ambulance_hospital_id,
  a.is_available,
  ST_AsText(a.last_known_location::geometry) AS ambulance_location_wkt,
  ST_Y(a.last_known_location::geometry) AS ambulance_lat,
  ST_X(a.last_known_location::geometry) AS ambulance_lng,

  h.id AS hospital_id,
  h.name AS hospital_name,
  h.is_accepting_emergencies,
  ST_AsText(h.location::geometry) AS hospital_location_wkt,
  ST_Y(h.location::geometry) AS hospital_lat,
  ST_X(h.location::geometry) AS hospital_lng
FROM latest_emergency le
LEFT JOIN ambulances a ON a.id = le.assigned_ambulance_id
LEFT JOIN hospitals h ON h.id = COALESCE(le.hospital_id, a.hospital_id);

-- =====================================================
-- 2) Update hospital to real location (example Addis Ababa)
-- =====================================================
UPDATE hospitals
SET
  location = ST_SetSRID(ST_MakePoint(38.7613, 9.0108), 4326),
  address = COALESCE(address, 'Addis Ababa'),
  is_accepting_emergencies = true,
  max_concurrent_emergencies = COALESCE(max_concurrent_emergencies, 20),
  updated_at = now()
WHERE id = '98c92944-f2bd-4ef5-b346-956fb06ec488';

-- =====================================================
-- 3) Link ambulance to hospital and set driver live location
-- =====================================================
UPDATE ambulances
SET
  hospital_id = '98c92944-f2bd-4ef5-b346-956fb06ec488',
  is_available = true,
  last_known_location = ST_SetSRID(ST_MakePoint(38.7520, 9.0200), 4326),
  updated_at = now()
WHERE id = 'f0f3b5e6-4a43-44c7-97d1-ecfa264a576e';

-- =====================================================
-- 4) Link latest active emergency to hospital (safety net)
-- =====================================================
WITH latest_emergency AS (
  SELECT id
  FROM emergency_requests
  WHERE patient_id = '0b08ccea-919a-4191-aed9-500c312e93cd'
    AND status NOT IN ('completed', 'cancelled')
  ORDER BY created_at DESC
  LIMIT 1
)
UPDATE emergency_requests e
SET
  hospital_id = '98c92944-f2bd-4ef5-b346-956fb06ec488',
  updated_at = now()
FROM latest_emergency le
WHERE e.id = le.id;

-- =====================================================
-- 5) Verify ETA-related distances
-- =====================================================
WITH latest_emergency AS (
  SELECT *
  FROM emergency_requests
  WHERE patient_id = '0b08ccea-919a-4191-aed9-500c312e93cd'
    AND status NOT IN ('completed', 'cancelled')
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  le.id AS emergency_id,
  le.status,
  a.id AS ambulance_id,
  h.id AS hospital_id,
  h.name AS hospital_name,
  ROUND(
    (ST_DistanceSphere(a.last_known_location::geometry, le.patient_location::geometry) / 1000.0)::numeric,
    2
  ) AS ambulance_to_patient_km,
  ROUND(
    (ST_DistanceSphere(le.patient_location::geometry, h.location::geometry) / 1000.0)::numeric,
    2
  ) AS patient_to_hospital_km,
  GREATEST(
    2,
    ROUND((ST_DistanceSphere(a.last_known_location::geometry, le.patient_location::geometry) / 1000.0 / 35.0) * 60.0 + 1.0)
  )::int AS eta_to_patient_min
FROM latest_emergency le
JOIN ambulances a ON a.id = le.assigned_ambulance_id
JOIN hospitals h ON h.id = COALESCE(le.hospital_id, a.hospital_id);

-- =====================================================
-- 6) Simulate movement to test ETA changes
-- =====================================================
-- Farther:
-- UPDATE ambulances
-- SET last_known_location = ST_SetSRID(ST_MakePoint(38.6800, 8.9500), 4326), updated_at = now()
-- WHERE id = 'f0f3b5e6-4a43-44c7-97d1-ecfa264a576e';

-- Nearer:
-- UPDATE ambulances
-- SET last_known_location = ST_SetSRID(ST_MakePoint(38.7605, 9.0110), 4326), updated_at = now()
-- WHERE id = 'f0f3b5e6-4a43-44c7-97d1-ecfa264a576e';
