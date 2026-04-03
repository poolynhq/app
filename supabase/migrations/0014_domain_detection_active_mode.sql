-- =============================================================
-- Migration 0014: Domain-based network detection + active mode
--
-- 1. active_mode column — lets 'both' (flexible) users declare
--    whether they are driving or riding TODAY without changing
--    their permanent role.
--
-- 2. check_domain_org() — callable by anonymous/authenticated
--    users so the sign-up page can detect whether an enterprise
--    Poolyn account already exists for an email domain BEFORE
--    the user creates their account.
--
-- 3. Updated handle_new_user trigger logic — when a new user's
--    email domain matches an ENTERPRISE org, an in-app
--    notification is sent to all org admins informing them that
--    someone joined their network voluntarily.
--
-- 4. join_org_voluntarily() — explicit RPC for users who were
--    previously in a community org and want to upgrade to their
--    domain's enterprise org.
-- =============================================================

-- ── 1. Active mode ────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS active_mode text
    CHECK (active_mode IN ('driver', 'passenger'));

-- ── 2. check_domain_org ───────────────────────────────────────────────────────
-- Accessible to both anon (sign-up page) and authenticated users.
CREATE OR REPLACE FUNCTION public.check_domain_org(p_email_domain text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org  public.organisations;
  _admin_name text;
BEGIN
  SELECT * INTO _org
  FROM   public.organisations
  WHERE  lower(domain) = lower(trim(p_email_domain))
    AND  active = true
  LIMIT  1;

  IF _org.id IS NULL THEN
    RETURN json_build_object('has_org', false);
  END IF;

  -- Find an admin's display name (for a personalised message in the UI)
  SELECT full_name INTO _admin_name
  FROM   public.users
  WHERE  org_id   = _org.id
    AND  org_role = 'admin'
    AND  active   = true
  LIMIT  1;

  RETURN json_build_object(
    'has_org',            true,
    'org_id',             _org.id,
    'org_name',           _org.name,
    'org_type',           _org.org_type,
    'plan',               _org.plan,
    'invite_code',        CASE WHEN _org.invite_code_active
                               THEN _org.invite_code
                               ELSE null END,
    'admin_name',         _admin_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_domain_org(text) TO anon, authenticated;

-- ── 3. Updated handle_new_user trigger ────────────────────────────────────────
-- Adds admin notification when a new user's domain matches an enterprise org.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _domain   text;
  _org_id   uuid;
  _org_type text;
  _reg_type text;
  _new_uid  uuid := NEW.id;
  _new_name text := COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email);
BEGIN
  _domain := lower(split_part(NEW.email, '@', 2));

  SELECT id, org_type
  INTO   _org_id, _org_type
  FROM   public.organisations
  WHERE  lower(domain) = _domain
  LIMIT  1;

  IF _org_id IS NULL THEN
    -- No org yet — create a community org for this domain
    INSERT INTO public.organisations (name, domain, org_type)
    VALUES (
      initcap(split_part(_domain, '.', 1)) || ' Community',
      _domain,
      'community'
    )
    RETURNING id INTO _org_id;
    _reg_type := 'independent';
  ELSE
    _reg_type := CASE WHEN _org_type = 'enterprise' THEN 'enterprise' ELSE 'independent' END;
  END IF;

  INSERT INTO public.users (id, email, org_id, registration_type, full_name)
  VALUES (_new_uid, NEW.email, _org_id, _reg_type, _new_name);

  -- Notify org admins when someone with a matching domain joins an enterprise org
  IF _org_type = 'enterprise' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT
      u.id,
      'new_member_joined',
      'New member joined your network',
      _new_name || ' joined your Poolyn network.',
      jsonb_build_object('member_id', _new_uid, 'org_id', _org_id)
    FROM public.users u
    WHERE u.org_id   = _org_id
      AND u.org_role = 'admin'
      AND u.active   = true
      AND u.id      <> _new_uid;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. join_org_voluntarily ───────────────────────────────────────────────────
-- Called when a user (who ended up in a community org on signup) explicitly
-- joins their domain's enterprise org after seeing the banner.
CREATE OR REPLACE FUNCTION public.join_org_voluntarily(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id    uuid   := auth.uid();
  _user_email text;
  _user_name  text;
  _user_domain text;
  _org_domain text;
  _org_name   text;
BEGIN
  SELECT email, full_name, split_part(lower(email), '@', 2)
  INTO   _user_email, _user_name, _user_domain
  FROM   public.users
  WHERE  id = _user_id;

  SELECT domain, name
  INTO   _org_domain, _org_name
  FROM   public.organisations
  WHERE  id = p_org_id AND active = true;

  IF _org_domain IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'org_not_found');
  END IF;

  IF _user_domain != lower(_org_domain) THEN
    RETURN json_build_object('ok', false, 'reason', 'domain_mismatch');
  END IF;

  UPDATE public.users
  SET    org_id            = p_org_id,
         registration_type = 'enterprise',
         updated_at        = now()
  WHERE  id = _user_id;

  -- Notify all org admins
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    u.id,
    'new_member_joined',
    'New member joined your network',
    COALESCE(_user_name, _user_email) || ' joined your Poolyn network voluntarily.',
    jsonb_build_object('member_id', _user_id, 'org_id', p_org_id)
  FROM public.users u
  WHERE u.org_id   = p_org_id
    AND u.org_role = 'admin'
    AND u.active   = true
    AND u.id      <> _user_id;

  RETURN json_build_object('ok', true, 'org_name', _org_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_org_voluntarily(uuid) TO authenticated;
