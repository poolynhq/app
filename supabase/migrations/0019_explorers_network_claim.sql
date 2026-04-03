-- Explorers: independent signups stay org_id NULL until an enterprise admin claims them.
-- Removes auto "community" orgs so domains are free for enterprise creation.

-- 1) Drop community orgs — users.org_id REFERENCES ... ON DELETE SET NULL will clear links.
DELETE FROM public.organisations WHERE org_type = 'community';

-- 2) Any user still wrongly tied to nothing gets explicit explorer state (safety).
UPDATE public.users
SET registration_type = 'independent',
    org_role = 'member',
    org_member_verified = false
WHERE org_id IS NULL;

-- 3) bootstrap_user_profile — no auto org; everyone starts as explorer (org_id NULL).
CREATE OR REPLACE FUNCTION public.bootstrap_user_profile()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id  uuid;
  _email    text;
  _name     text;
  _profile  public.users;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO _profile FROM public.users WHERE id = _user_id;
  IF FOUND THEN
    RETURN row_to_json(_profile);
  END IF;

  SELECT email, raw_user_meta_data ->> 'full_name'
    INTO _email, _name
    FROM auth.users
   WHERE id = _user_id;

  INSERT INTO public.users (
    id,
    email,
    org_id,
    registration_type,
    full_name,
    org_role,
    org_member_verified
  )
  VALUES (
    _user_id,
    _email,
    NULL,
    'independent',
    COALESCE(_name, ''),
    'member',
    false
  )
  RETURNING * INTO _profile;

  RETURN row_to_json(_profile);
END;
$$;

-- 4) Invite join: mark verified when joining enterprise via code.
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

  IF lower(_user_domain) <> lower(_org.domain) THEN
    RAISE EXCEPTION 'Email domain does not match organisation domain';
  END IF;

  UPDATE public.users
  SET org_id = _org.id,
      registration_type = 'enterprise',
      org_member_verified = true,
      org_role = 'member'
  WHERE id = auth.uid();

  RETURN row_to_json(_org);
END;
$$;

-- 5) List same-domain explorers for the current org admin (post–enterprise creation).
CREATE OR REPLACE FUNCTION public.admin_list_domain_explorers()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _domain text;
BEGIN
  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT lower(o.domain) INTO _domain
  FROM public.users u
  JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = auth.uid();

  IF _domain IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id, u.email, u.full_name, u.avatar_url
  FROM public.users u
  WHERE lower(split_part(u.email, '@', 2)) = _domain
    AND u.org_id IS NULL
    AND u.id <> auth.uid()
    AND u.active = true
  ORDER BY u.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_domain_explorers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_domain_explorers() TO authenticated;

-- 6) Claim explorers into admin’s enterprise org.
CREATE OR REPLACE FUNCTION public.admin_claim_explorers(p_user_ids uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _domain text;
  _n integer;
BEGIN
  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT u.org_id, lower(o.domain) INTO _org_id, _domain
  FROM public.users u
  JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = auth.uid();

  IF _org_id IS NULL OR _domain IS NULL THEN
    RAISE EXCEPTION 'no organisation';
  END IF;

  UPDATE public.users u
  SET org_id = _org_id,
      registration_type = 'enterprise',
      org_member_verified = true,
      org_role = 'member'
  WHERE u.id = ANY(p_user_ids)
    AND u.org_id IS NULL
    AND lower(split_part(u.email, '@', 2)) = _domain;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN json_build_object('claimed', _n);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_claim_explorers(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_claim_explorers(uuid[]) TO authenticated;

-- 7) Peer badge for discover (cross-network trust UI).
CREATE OR REPLACE FUNCTION public.get_peer_commute_badge(p_peer_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'explorer', (u.org_id IS NULL),
    'org_name', o.name,
    'org_type', o.org_type
  )
  FROM public.users u
  LEFT JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = p_peer_id;
$$;

REVOKE ALL ON FUNCTION public.get_peer_commute_badge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_peer_commute_badge(uuid) TO authenticated;

-- 8) Auth trigger: never auto-create community org or auto-attach to enterprise.
--    Joining a company network is invite-only or admin claim.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_uid  uuid := NEW.id;
  _new_name text := COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email);
BEGIN
  INSERT INTO public.users (
    id,
    email,
    org_id,
    registration_type,
    full_name,
    org_role,
    org_member_verified
  )
  VALUES (
    _new_uid,
    NEW.email,
    NULL,
    'independent',
    _new_name,
    'member',
    false
  );

  RETURN NEW;
END;
$$;
