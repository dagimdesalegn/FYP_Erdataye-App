-- Migration 007: Drop the ambulances_type_check constraint
-- The type column has a CHECK constraint that only allows specific enum values,
-- but we don't use the type field during registration.
-- Run this in Supabase SQL Editor to remove the restrictive constraint.

ALTER TABLE public.ambulances DROP CONSTRAINT IF EXISTS ambulances_type_check;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
