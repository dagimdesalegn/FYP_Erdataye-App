-- Migration 006: Add registration_number column to ambulances table
-- Stores the ambulance registration number entered during driver signup.

ALTER TABLE public.ambulances
  ADD COLUMN IF NOT EXISTS registration_number TEXT;
