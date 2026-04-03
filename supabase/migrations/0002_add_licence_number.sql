-- Add driver's licence number to users table for verification.
-- Stored encrypted at rest by Supabase. Platform verifies manually
-- and sets license_verified = true once confirmed.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS licence_number text;

COMMENT ON COLUMN public.users.licence_number IS
  'Driver licence number. Optional. Used for manual verification by platform.';
