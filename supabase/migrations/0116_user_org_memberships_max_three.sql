-- Multi-organisation membership: up to 3 workplace networks per user.
-- Primary org + org_role on public.users stay in sync via trigger (backward compatible).

-- ---------------------------------------------------------------------------
-- 1) Membership table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  org_role text NOT NULL DEFAULT 'member'
    CHECK (org_role IN ('member', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_user_org_memberships_user_id
  ON public.user_org_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_user_org_memberships_org_id
  ON public.user_org_memberships (organisation_id);

COMMENT ON TABLE public.user_org_memberships IS
  'Workplace network memberships; users.org_id is the derived primary row for legacy queries.';

ALTER TABLE public.user_org_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own org memberships" ON public.user_org_memberships;
CREATE POLICY "Users read own org memberships"
  ON public.user_org_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_org_memberships TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Sync primary org on users (called from trigger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_primary_org_from_memberships(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pick_org uuid;
  _pick_role text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_memberships m WHERE m.user_id = p_user_id
  ) THEN
    UPDATE public.users
    SET
      org_id = NULL,
      org_role = 'member',
      registration_type = 'independent',
      org_member_verified = false,
      pickup_location = NULL
    WHERE id = p_user_id;
    RETURN;
  END IF;

  SELECT m.organisation_id, m.org_role
  INTO _pick_org, _pick_role
  FROM public.user_org_memberships m
  INNER JOIN public.organisations o ON o.id = m.organisation_id
  WHERE m.user_id = p_user_id
  ORDER BY
    CASE WHEN m.org_role = 'admin' AND o.org_type = 'enterprise' THEN 0 ELSE 1 END,
    CASE WHEN o.org_type = 'enterprise' THEN 0 ELSE 1 END,
    CASE WHEN m.org_role = 'admin' THEN 0 ELSE 1 END,
    m.created_at ASC
  LIMIT 1;

  UPDATE public.users
  SET
    org_id = _pick_org,
    org_role = _pick_role,
    registration_type = 'enterprise',
    org_member_verified = true
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_primary_org_from_memberships(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.tg_user_org_memberships_sync_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_user_primary_org_from_memberships(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_max_three_org_memberships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::integer INTO _n
  FROM public.user_org_memberships
  WHERE user_id = NEW.user_id;

  IF _n >= 3 THEN
    RAISE EXCEPTION
      'You can belong to at most three organisations. Leave one before joining another.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_uom_max_three ON public.user_org_memberships;
CREATE TRIGGER tr_uom_max_three
  BEFORE INSERT ON public.user_org_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_three_org_memberships();

DROP TRIGGER IF EXISTS tr_uom_sync_primary ON public.user_org_memberships;
CREATE TRIGGER tr_uom_sync_primary
  AFTER INSERT OR UPDATE OR DELETE ON public.user_org_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_user_org_memberships_sync_primary();

-- ---------------------------------------------------------------------------
-- 3) Backfill from legacy users.org_id (trigger fires; rows already consistent)
-- ---------------------------------------------------------------------------
INSERT INTO public.user_org_memberships (user_id, organisation_id, org_role, created_at)
SELECT u.id, u.org_id, u.org_role, u.created_at
FROM public.users u
WHERE u.org_id IS NOT NULL
ON CONFLICT (user_id, organisation_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Core helpers used by RLS and RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_org_memberships m
    INNER JOIN public.users u ON u.id = m.user_id
    WHERE u.id = auth.uid()
      AND m.organisation_id = u.org_id
      AND m.org_role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_user_org_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT bool_or(o.status IN ('active', 'grace'))
      FROM public.user_org_memberships m
      INNER JOIN public.organisations o ON o.id = m.organisation_id
      WHERE m.user_id = p_user_id
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 5) Join via invite: insert membership (trigger syncs users)
-- ---------------------------------------------------------------------------
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

  IF EXISTS (
    SELECT 1
    FROM public.user_org_memberships m
    WHERE m.user_id = auth.uid()
      AND m.organisation_id = _org.id
  ) THEN
    RETURN row_to_json(_org);
  END IF;

  INSERT INTO public.user_org_memberships (user_id, organisation_id, org_role)
  VALUES (auth.uid(), _org.id, 'member');

  RETURN row_to_json(_org);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Claim explorers — membership rows instead of only users.org_id
-- ---------------------------------------------------------------------------
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

  SELECT m.organisation_id, lower(o.domain), o.status
  INTO _org_id, _domain, _org_status
  FROM public.user_org_memberships m
  INNER JOIN public.organisations o ON o.id = m.organisation_id
  WHERE m.user_id = auth.uid()
    AND m.org_role = 'admin'
  ORDER BY
    CASE WHEN o.org_type = 'enterprise' THEN 0 ELSE 1 END,
    m.created_at ASC
  LIMIT 1;

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

  INSERT INTO public.user_org_memberships (user_id, organisation_id, org_role)
  SELECT u.id, _org_id, 'member'
  FROM public.users u
  WHERE u.id = ANY(p_user_ids)
    AND u.active = true
    AND lower(split_part(u.email, '@', 2)) = _domain
    AND NOT EXISTS (
      SELECT 1 FROM public.user_org_memberships m
      WHERE m.user_id = u.id AND m.organisation_id = _org_id
    );

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN json_build_object('claimed', _n);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Enterprise org creation — admin membership row
-- ---------------------------------------------------------------------------
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

  INSERT INTO public.organisations (
    name,
    domain,
    org_type,
    plan,
    invite_code,
    status
  )
  VALUES (
    org_name,
    _d,
    'enterprise',
    plan_name,
    public.generate_invite_code(),
    'inactive'
  )
  RETURNING * INTO _org;

  INSERT INTO public.user_org_memberships (user_id, organisation_id, org_role)
  VALUES (admin_user_id, _org.id, 'admin');

  RETURN row_to_json(_org);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Transfer admin — membership roles for this organisation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_org_admin(p_new_admin_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_org uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT org_id INTO _my_org FROM public.users WHERE id = _me;
  IF _my_org IS NULL THEN
    RAISE EXCEPTION 'No organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_memberships m
    WHERE m.user_id = _me
      AND m.organisation_id = _my_org
      AND m.org_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only organisation admins can transfer admin rights';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_new_admin_id AND u.active = true
  ) THEN
    RAISE EXCEPTION 'That person is not an active member of your organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_memberships m
    WHERE m.user_id = p_new_admin_id AND m.organisation_id = _my_org
  ) THEN
    RAISE EXCEPTION 'That person is not an active member of your organisation';
  END IF;

  IF p_new_admin_id = _me THEN
    RAISE EXCEPTION 'Choose another member to become admin';
  END IF;

  UPDATE public.user_org_memberships
  SET org_role = 'member'
  WHERE user_id = _me AND organisation_id = _my_org;

  UPDATE public.user_org_memberships
  SET org_role = 'admin'
  WHERE user_id = p_new_admin_id AND organisation_id = _my_org;

  UPDATE public.users
  SET org_member_verified = true
  WHERE id = p_new_admin_id;

  RETURN json_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) Leave organisation — optional org id (defaults to primary / legacy behaviour)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_leave_organisation(p_org_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_org := COALESCE(
    p_org_id,
    (SELECT org_id FROM public.users WHERE id = v_me)
  );

  IF v_org IS NULL THEN
    RETURN json_build_object('ok', true, 'idempotent', true);
  END IF;

  SELECT m.org_role INTO v_role
  FROM public.user_org_memberships m
  WHERE m.user_id = v_me AND m.organisation_id = v_org;

  IF v_role IS NULL THEN
    RETURN json_build_object('ok', true, 'idempotent', true);
  END IF;

  IF v_role = 'admin' THEN
    RAISE EXCEPTION
      'organisation_admin_must_transfer'
      USING DETAIL = 'Transfer admin to another member (Admin → Transfer admin) before leaving the network.';
  END IF;

  SELECT name INTO v_name FROM public.organisations WHERE id = v_org;

  DELETE FROM public.user_org_memberships
  WHERE user_id = v_me AND organisation_id = v_org;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_me,
    'network_left',
    'You left a workplace network',
    format(
      'You left %s on Poolyn. Organisation benefits tied to that network no longer apply.',
      COALESCE(v_name, 'an organisation')
    ),
    jsonb_build_object('organisation_id', v_org)
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_leave_organisation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_leave_organisation(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10) Admin removes member — delete membership row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_admin_remove_org_member(p_target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_my_org uuid;
  v_target_role text;
  v_org_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id = v_me THEN
    RAISE EXCEPTION 'use_leave_flow' USING DETAIL = 'Use “Leave network” on your own account.';
  END IF;

  SELECT org_id INTO v_my_org FROM public.users WHERE id = v_me;
  IF v_my_org IS NULL OR NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT m.org_role INTO v_target_role
  FROM public.user_org_memberships m
  WHERE m.user_id = p_target_user_id
    AND m.organisation_id = v_my_org;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'target_not_in_org';
  END IF;

  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'cannot_remove_admin' USING DETAIL = 'Transfer admin away from this person before removing them.';
  END IF;

  SELECT name INTO v_org_name FROM public.organisations WHERE id = v_my_org;

  DELETE FROM public.user_org_memberships
  WHERE user_id = p_target_user_id AND organisation_id = v_my_org;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_target_user_id,
    'removed_from_network',
    'Removed from workplace network',
    format('Your admin removed you from %s on Poolyn. You are now an independent Explorer.', COALESCE(v_org_name, 'your organisation')),
    jsonb_build_object('organisation_id', v_my_org)
  );

  RETURN json_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 11) Org MAU + dashboard stats — count via memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_active_user_count(
  target_org_id uuid,
  ref_month date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH month_bounds AS (
    SELECT date_trunc('month', ref_month::timestamp) AS month_start,
           (date_trunc('month', ref_month::timestamp) + interval '1 month') AS month_end
  ),
  active_ids AS (
    SELECT r.driver_id AS user_id
    FROM public.rides r
    CROSS JOIN month_bounds mb
    WHERE r.depart_at >= mb.month_start
      AND r.depart_at < mb.month_end
      AND r.status IN ('scheduled', 'active', 'completed')
    UNION
    SELECT rp.passenger_id AS user_id
    FROM public.ride_passengers rp
    INNER JOIN public.rides r ON r.id = rp.ride_id
    CROSS JOIN month_bounds mb
    WHERE r.depart_at >= mb.month_start
      AND r.depart_at < mb.month_end
      AND rp.status IN ('confirmed', 'picked_up', 'dropped_off', 'completed')
    UNION
    SELECT rr.passenger_id AS user_id
    FROM public.ride_requests rr
    CROSS JOIN month_bounds mb
    WHERE rr.created_at >= mb.month_start
      AND rr.created_at < mb.month_end
      AND rr.status IN ('pending', 'matched')
  )
  SELECT count(DISTINCT u.id)::integer
  FROM public.users u
  INNER JOIN public.user_org_memberships mm ON mm.user_id = u.id AND mm.organisation_id = target_org_id
  INNER JOIN active_ids a ON a.user_id = u.id;
$$;

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
    FROM public.user_org_memberships m
    WHERE m.user_id = auth.uid()
      AND m.organisation_id = p_org_id
      AND m.org_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO _total
  FROM public.user_org_memberships WHERE organisation_id = p_org_id;

  SELECT count(*)::integer INTO _active
  FROM public.users u
  INNER JOIN public.user_org_memberships m ON m.user_id = u.id AND m.organisation_id = p_org_id
  WHERE u.active = true;

  SELECT count(*)::integer INTO _onboarded
  FROM public.users u
  INNER JOIN public.user_org_memberships m ON m.user_id = u.id AND m.organisation_id = p_org_id
  WHERE u.onboarding_completed = true;

  SELECT
    lower(trim(o.domain)),
    o.status,
    (SELECT count(*)::integer FROM public.user_org_memberships m2 WHERE m2.organisation_id = p_org_id AND m2.org_role = 'admin')
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
      AND u.active = true
      AND u.id <> auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.user_org_memberships mm
        WHERE mm.user_id = u.id AND mm.organisation_id = p_org_id
      );
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
  INNER JOIN public.user_org_memberships m ON m.user_id = u.id AND m.organisation_id = p_org_id;

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

CREATE OR REPLACE FUNCTION public.get_org_analytics_summary(
  p_org_id uuid,
  p_month date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _month_start timestamptz := date_trunc('month', p_month::timestamp);
  _month_end timestamptz := date_trunc('month', p_month::timestamp) + interval '1 month';
  _active_users integer := 0;
  _total_rides integer := 0;
  _co2_saved_kg numeric := 0;
  _pending_requests integer := 0;
  _scheduled_rides integer := 0;
BEGIN
  BEGIN
    SELECT public.org_active_user_count(p_org_id, p_month) INTO _active_users;
  EXCEPTION
    WHEN OTHERS THEN
      _active_users := 0;
  END;

  SELECT count(*)::integer
  INTO _total_rides
  FROM public.rides r
  INNER JOIN public.users u ON u.id = r.driver_id
  INNER JOIN public.user_org_memberships m ON m.user_id = u.id AND m.organisation_id = p_org_id
  WHERE r.depart_at >= _month_start
    AND r.depart_at < _month_end
    AND r.status IN ('scheduled', 'active', 'completed');

  _co2_saved_kg := round((_total_rides * 2.3)::numeric, 2);

  SELECT count(*)::integer
  INTO _pending_requests
  FROM public.ride_requests rr
  INNER JOIN public.users u ON u.id = rr.passenger_id
  INNER JOIN public.user_org_memberships m ON m.user_id = u.id AND m.organisation_id = p_org_id
  WHERE rr.status = 'pending';

  SELECT count(*)::integer
  INTO _scheduled_rides
  FROM public.rides r
  INNER JOIN public.users u ON u.id = r.driver_id
  INNER JOIN public.user_org_memberships m ON m.user_id = u.id AND m.organisation_id = p_org_id
  WHERE r.status = 'scheduled';

  RETURN json_build_object(
    'active_users', _active_users,
    'total_rides', _total_rides,
    'co2_saved_kg', _co2_saved_kg,
    'pending_requests', _pending_requests,
    'scheduled_rides', _scheduled_rides
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 12) Org dissolve trigger — admin counting via memberships
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_users_after_delete_dissolve_org_if_no_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  admins_left integer;
BEGIN
  oid := OLD.org_id;
  IF oid IS NULL THEN
    RETURN OLD;
  END IF;

  IF OLD.org_role IS DISTINCT FROM 'admin' THEN
    RETURN OLD;
  END IF;

  SELECT count(*)::integer
  INTO admins_left
  FROM public.user_org_memberships
  WHERE organisation_id = oid
    AND org_role = 'admin';

  IF admins_left > 0 THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.user_org_memberships WHERE organisation_id = oid;

  DELETE FROM public.organisations WHERE id = oid;

  RETURN OLD;
END;
$$;
