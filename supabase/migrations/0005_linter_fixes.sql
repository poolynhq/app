-- =============================================================
-- Migration 0005: Linter fixes (SQL-fixable items only)
-- =============================================================

-- Fix handle_updated_at missing SET search_path
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================
-- MANUAL STEP (cannot be done via SQL editor):
--
-- The spatial_ref_sys table is owned by supabase_admin and
-- PostGIS does not support SET SCHEMA. Fix it via the Dashboard:
--
--   1. Supabase Dashboard → Database → Tables
--   2. Select the "public" schema
--   3. Find "spatial_ref_sys"
--   4. Enable RLS toggle
--   5. Add policy: "Enable read access for all users"
-- =============================================================
