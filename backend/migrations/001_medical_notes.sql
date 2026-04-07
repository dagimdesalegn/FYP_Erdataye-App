-- Medical Notes table for Erdataye Emergency App
-- Run this SQL in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)

CREATE TABLE IF NOT EXISTS medical_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id  UUID NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL,
  author_role   TEXT NOT NULL CHECK (author_role IN ('ambulance', 'driver', 'hospital', 'admin')),
  author_name   TEXT,
  note_type     TEXT NOT NULL CHECK (note_type IN ('initial_assessment', 'transport_observation', 'treatment', 'discharge', 'general')),
  content       TEXT NOT NULL,
  vitals        JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by emergency
CREATE INDEX IF NOT EXISTS idx_medical_notes_emergency ON medical_notes(emergency_id);

-- Index for audit trail by author
CREATE INDEX IF NOT EXISTS idx_medical_notes_author ON medical_notes(author_id);

-- RLS: Enable Row Level Security
ALTER TABLE medical_notes ENABLE ROW LEVEL SECURITY;

-- Policy: Allow service role full access (backend uses service role key)
CREATE POLICY "Service role full access" ON medical_notes
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Policy: Allow authenticated users to read notes for emergencies they're involved in
CREATE POLICY "Authenticated users can read" ON medical_notes
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Allow authenticated users to insert their own notes
CREATE POLICY "Authenticated users can insert own" ON medical_notes
  FOR INSERT
  WITH CHECK (auth.uid() = author_id);
