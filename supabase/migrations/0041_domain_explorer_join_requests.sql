-- Domain explorers (same email domain, not in org): dashboard count + admin → explorer join invite notifications.
-- Join invite is only sent when the org has an active network, a valid invite code, and at least one org admin.

CREATE OR REPLACE FUNCTION public.poolyn_org_admin_dashboard_stats(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total integer;
  _active integer;
  _onboarded integer;
  _mau integer := 0;
  _ids json;
  _domain text;
  _org_status text;
  _admin_count integer;
  _domain_explorers integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.org_id = p_org_id
      AND u.org_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO _total FROM public.users WHERE org_id = p_org_id;
  SELECT count(*)::integer INTO _active FROM public.users WHERE org_id = p_org_id AND active = true;
  SELECT count(*)::integer INTO _onboarded
  FROM public.users
  WHERE org_id = p_org_id AND onboarding_completed = true;

  SELECT
    lower(trim(o.domain)),
    o.status,
    (SELECT count(*)::integer FROM public.users u2 WHERE u2.org_id = p_org_id AND u2.org_role = 'admin')
  INTO _domain, _org_status, _admin_count
  FROM public.organisations o
  WHERE o.id = p_org_id;

  IF _domain IS NOT NULL
     AND _domain <> ''
     AND _org_status = 'active'
     AND COALESCE(_admin_count, 0) >= 1
  THEN
    SELECT count(*)::integer INTO _domain_explorers
    FROM public.users u
    WHERE lower(split_part(u.email, '@', 2)) = _domain
      AND u.org_id IS NULL
      AND u.active = true
      AND u.id <> auth.uid();
  END IF;

  BEGIN
    _mau := public.org_active_user_count(p_org_id, CURRENT_DATE);
  EXCEPTION
    WHEN OTHERS THEN
      _mau := 0;
  END;

  SELECT COALESCE(json_agg(u.id ORDER BY u.id), '[]'::json)
  INTO _ids
  FROM public.users u
  WHERE u.org_id = p_org_id;

  RETURN json_build_object(
    'total_members', _total,
    'active_members', _active,
    'onboarded_members', _onboarded,
    'domain_explorers_count', _domain_explorers,
    'monthly_active_commuters', _mau,
    'member_user_ids', COALESCE(_ids, '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_network_join_invite(p_target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _domain text;
  _org_name text;
  _invite text;
  _org_status text;
  _admin_count integer;
  _inviter_name text;
BEGIN
  IF p_target_user_id IS NULL OR p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT u.org_id INTO _org_id
  FROM public.users u
  WHERE u.id = auth.uid();

  IF _org_id IS NULL THEN
    RAISE EXCEPTION 'no organisation';
  END IF;

  SELECT
    lower(trim(o.domain)),
    o.name,
    CASE WHEN o.invite_code_active THEN o.invite_code ELSE NULL END,
    o.status,
    (SELECT count(*)::integer FROM public.users u2 WHERE u2.org_id = o.id AND u2.org_role = 'admin')
  INTO _domain, _org_name, _invite, _org_status, _admin_count
  FROM public.organisations o
  WHERE o.id = _org_id;

  IF _domain IS NULL OR _domain = '' THEN
    RAISE EXCEPTION 'organisation_has_no_domain';
  END IF;

  IF COALESCE(_admin_count, 0) < 1 THEN
    RAISE EXCEPTION 'no_domain_admin';
  END IF;

  IF _org_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Organisation network is not activated';
  END IF;

  IF _invite IS NULL OR length(trim(_invite)) < 8 THEN
    RAISE EXCEPTION 'invite_code_unavailable'
      USING DETAIL = 'Enable or rotate your organisation invite code before sending join requests.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_target_user_id
      AND u.active = true
      AND u.org_id IS NULL
      AND lower(split_part(u.email, '@', 2)) = _domain
  ) THEN
    RAISE EXCEPTION 'target_not_domain_explorer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = p_target_user_id
      AND n.type = 'network_join_invite'
      AND (n.data->>'organisation_id') = _org_id::text
      AND n.created_at > now() - interval '7 days'
  ) THEN
    RETURN json_build_object('ok', true, 'deduped', true);
  END IF;

  SELECT COALESCE(nullif(trim(u.full_name), ''), u.email) INTO _inviter_name
  FROM public.users u
  WHERE u.id = auth.uid();

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_target_user_id,
    'network_join_invite',
    format('%s invited you to join the workplace network', COALESCE(_org_name, 'Your organisation')),
    format(
      '%s asked you to join %s on Poolyn. Use the invite code below on the Join network screen.',
      COALESCE(_inviter_name, 'An admin'),
      COALESCE(_org_name, 'your organisation')
    ),
    jsonb_build_object(
      'organisation_id', _org_id,
      'organisation_name', COALESCE(_org_name, ''),
      'invite_code', upper(_invite),
      'invited_by_user_id', auth.uid(),
      'invited_by_name', COALESCE(_inviter_name, '')
    )
  );

  RETURN json_build_object('ok', true, 'deduped', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_network_join_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_send_network_join_invite(uuid) TO authenticated;
