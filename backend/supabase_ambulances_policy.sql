-- Enable row-level security for ambulances table
ALTER TABLE ambulances ENABLE ROW LEVEL SECURITY;

-- Policy: Allow drivers to insert ambulances
CREATE POLICY "Drivers can insert ambulances"
ON ambulances
FOR INSERT
USING (auth.role() = 'driver');

-- Policy: Allow service role to manage ambulances
CREATE POLICY "Service role can manage ambulances"
ON ambulances
FOR ALL
USING (auth.jwt() = '<YOUR_SERVICE_ROLE_KEY>');

-- Replace <YOUR_SERVICE_ROLE_KEY> with your actual service role key if needed.
-- Run this SQL in Supabase SQL editor or migration tool.