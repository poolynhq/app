-- 1) Consumer (personal) email domains — cannot host a managed workplace network.
-- 2) Remove organisations tied to those domains (fixes bogus "Gmail/Google" networks).
-- 3) Harden create_enterprise_org: block consumer domains + duplicates (RLS-safe, server-side).
-- 4) Avatar storage: allow only exact object path {user_id}/avatar.jpg (no split_part/ltrim in policy).

CREATE OR REPLACE FUNCTION public.consumer_email_domains()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'gmail.com',
    'yahoo.com',
    'yahoo.com.au',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'icloud.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
    'mail.com',
    'zoho.com',
    'yandex.com',
    'gmx.com',
    'fastmail.com'
  ]::text[];
$$;

REVOKE ALL ON FUNCTION public.consumer_email_domains() FROM PUBLIC;

-- Pre-flight for business signup (bypasses organisations RLS).
CREATE OR REPLACE FUNCTION public.enterprise_org_domain_status(p_domain text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d text := lower(trim(p_domain));
BEGIN
  IF d = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'Domain is required.');
  END IF;

  IF d = ANY (public.consumer_email_domains()) THEN
    RETURN json_build_object(
      'ok', false,
      'reason', 'Personal email domains cannot create a managed workplace network. Use your company email.'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE lower(trim(o.domain)) = d
  ) THEN
    RETURN json_build_object(
      'ok', false,
      'reason', 'This domain already has a Poolyn organisation. Ask your admin for an invite code.'
    );
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_org_domain_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enterprise_org_domain_status(text) TO authenticated;

-- Current enterprise admin hands admin role to another member (same org).
CREATE OR REPLACE FUNCTION public.transfer_org_admin(p_new_admin_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_org uuid;
  _target_org uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT org_id INTO _my_org FROM public.users WHERE id = _me;
  IF _my_org IS NULL THEN
    RAISE EXCEPTION 'No organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = _my_org AND o.org_type = 'enterprise'
  ) THEN
    RAISE EXCEPTION 'Admin transfer applies only to managed workplace organisations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = _me AND org_id = _my_org AND org_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only organisation admins can transfer admin rights';
  END IF;

  SELECT org_id INTO _target_org FROM public.users WHERE id = p_new_admin_id AND active = true;
  IF _target_org IS DISTINCT FROM _my_org THEN
    RAISE EXCEPTION 'That person is not an active member of your organisation';
  END IF;

  IF p_new_admin_id = _me THEN
    RAISE EXCEPTION 'Choose another member to become admin';
  END IF;

  UPDATE public.users SET org_role = 'member' WHERE id = _me AND org_id = _my_org;
  UPDATE public.users
  SET org_role = 'admin',
      org_member_verified = true
  WHERE id = p_new_admin_id AND org_id = _my_org;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_org_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_org_admin(uuid) TO authenticated;

-- Remove invalid "workplace" rows for consumer domains (users.org_id becomes NULL via FK).
DELETE FROM public.organisations o
WHERE lower(trim(o.domain)) = ANY (public.consumer_email_domains());

-- Detach personal-email users only from consumer-domain orgs (keeps gmail users invited to a real company org).
UPDATE public.users u
SET org_id = NULL,
    org_role = 'member',
    registration_type = 'independent',
    org_member_verified = false
WHERE lower(trim(split_part(u.email, '@', 2))) = ANY (public.consumer_email_domains())
  AND (
    u.org_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.organisations o
      WHERE o.id = u.org_id
        AND lower(trim(o.domain)) = ANY (public.consumer_email_domains())
    )
  );

CREATE OR REPLACE FUNCTION public.create_enterprise_org(
  org_name text,
  org_domain text,
  admin_user_id uuid,
  plan_name text DEFAULT 'starter'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organisations;
  _d text := lower(trim(org_domain));
  _status json;
BEGIN
  _status := public.enterprise_org_domain_status(_d);
  IF (_status ->> 'ok') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '%', COALESCE(_status ->> 'reason', 'This domain cannot be used for a new organisation');
  END IF;

  INSERT INTO public.organisations (name, domain, org_type, plan, invite_code)
  VALUES (
    org_name,
    _d,
    'enterprise',
    plan_name,
    public.generate_invite_code()
  )
  RETURNING * INTO _org;

  UPDATE public.users
  SET org_id = _org.id,
      org_role = 'admin',
      registration_type = 'enterprise',
      org_member_verified = true
  WHERE id = admin_user_id;

  RETURN row_to_json(_org);
END;
$$;

-- Avatar policies: exact filename only (avoids expression quirks in some Storage API builds).
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Avatar images are publicly readable" ON storage.objects;

CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '/avatar.jpg'
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '/avatar.jpg'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '/avatar.jpg'
  );

CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name = auth.uid()::text || '/avatar.jpg'
  );

CREATE POLICY "Avatar images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
