-- =============================================================
-- Migration 0006: Business features — invite codes & enterprise org management
-- =============================================================

-- Ensure pgcrypto functions are available (gen_random_bytes/gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------
-- 1. Add invite_code columns to organisations
-- ---------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organisations'
      AND column_name = 'invite_code'
  ) THEN
    ALTER TABLE public.organisations
      ADD COLUMN invite_code text UNIQUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organisations'
      AND column_name = 'invite_code_active'
  ) THEN
    ALTER TABLE public.organisations
      ADD COLUMN invite_code_active boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Index for fast invite code lookups
CREATE INDEX IF NOT EXISTS idx_organisations_invite_code
  ON public.organisations (invite_code)
  WHERE invite_code IS NOT NULL AND invite_code_active = true;

-- ---------------------------------------------------------
-- 2. generate_invite_code() — random 8-char alphanumeric
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT upper(substr(replace(replace(
    encode(extensions.gen_random_bytes(6), 'base64'),
    '+', ''), '/', ''), 1, 8));
$$;

-- ---------------------------------------------------------
-- 3. create_enterprise_org() — full enterprise org bootstrap
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_enterprise_org(
  org_name text,
  org_domain text,
  admin_user_id uuid,
  plan_name text DEFAULT 'free'
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organisations;
BEGIN
  INSERT INTO public.organisations (name, domain, org_type, plan, invite_code)
  VALUES (
    org_name,
    org_domain,
    'enterprise',
    plan_name,
    public.generate_invite_code()
  )
  RETURNING * INTO _org;

  UPDATE public.users
  SET org_id = _org.id,
      org_role = 'admin',
      registration_type = 'enterprise'
  WHERE id = admin_user_id;

  RETURN row_to_json(_org);
END;
$$;

-- ---------------------------------------------------------
-- 4. join_org_by_invite() — join an org via invite code
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_org_by_invite(code text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organisations;
  _user_email text;
  _user_domain text;
BEGIN
  SELECT * INTO _org
  FROM public.organisations
  WHERE invite_code = code
    AND invite_code_active = true;

  IF _org.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive invite code';
  END IF;

  SELECT email INTO _user_email
  FROM public.users
  WHERE id = auth.uid();

  _user_domain := split_part(_user_email, '@', 2);

  IF _user_domain <> _org.domain THEN
    RAISE EXCEPTION 'Email domain does not match organisation domain';
  END IF;

  UPDATE public.users
  SET org_id = _org.id,
      registration_type = 'enterprise'
  WHERE id = auth.uid();

  RETURN row_to_json(_org);
END;
$$;

-- ---------------------------------------------------------
-- 5. RLS — allow any authenticated user to look up an org
--    by invite code (needed for the join flow). The existing
--    "Admins can update own org" policy already covers
--    admin writes to invite_code / invite_code_active.
-- ---------------------------------------------------------

CREATE POLICY "Authenticated users can lookup org by invite code"
  ON public.organisations FOR SELECT
  USING (
    invite_code IS NOT NULL
    AND invite_code_active = true
    AND auth.uid() IS NOT NULL
  );
