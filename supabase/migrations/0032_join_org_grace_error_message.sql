-- Clearer errors when joining during grace (subscription not current) vs never activated.

CREATE OR REPLACE FUNCTION public.join_org_by_invite(code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF _org.status = 'grace' THEN
    RAISE EXCEPTION
      'This organisation''s subscription is not current. Ask your admin to update billing before new members can join.';
  END IF;

  IF _org.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'This organisation''s network is not active yet. Ask your admin to complete activation before you can join.';
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

-- Claim explorers: same messaging as invite join (grace = subscription not current).
CREATE OR REPLACE FUNCTION public.admin_claim_explorers(p_user_ids uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _domain text;
  _org_status text;
  _n integer;
BEGIN
  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT u.org_id, lower(o.domain), o.status
  INTO _org_id, _domain, _org_status
  FROM public.users u
  JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = auth.uid();

  IF _org_id IS NULL OR _domain IS NULL THEN
    RAISE EXCEPTION 'no organisation';
  END IF;

  IF _org_status = 'grace' THEN
    RAISE EXCEPTION
      'Your organisation''s subscription is not current. Update billing before you can add colleagues to the network.';
  END IF;

  IF _org_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'Organisation network is not activated. Complete activation before you can add colleagues.';
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
