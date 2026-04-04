-- Harden org_active_user_count (explicit joins) and stop dashboard RPCs from 500'ing
-- when monthly MAU computation fails — member totals still return.

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
  INNER JOIN active_ids a ON a.user_id = u.id
  WHERE u.org_id = target_org_id;
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
  _mau integer := 0;
  _ids json;
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
  JOIN public.users u ON u.id = r.driver_id
  WHERE u.org_id = p_org_id
    AND r.depart_at >= _month_start
    AND r.depart_at < _month_end
    AND r.status IN ('scheduled', 'active', 'completed');

  _co2_saved_kg := round((_total_rides * 2.3)::numeric, 2);

  SELECT count(*)::integer
  INTO _pending_requests
  FROM public.ride_requests rr
  JOIN public.users u ON u.id = rr.passenger_id
  WHERE u.org_id = p_org_id
    AND rr.status = 'pending';

  SELECT count(*)::integer
  INTO _scheduled_rides
  FROM public.rides r
  JOIN public.users u ON u.id = r.driver_id
  WHERE u.org_id = p_org_id
    AND r.status = 'scheduled';

  RETURN json_build_object(
    'active_users', _active_users,
    'total_rides', _total_rides,
    'co2_saved_kg', _co2_saved_kg,
    'pending_requests', _pending_requests,
    'scheduled_rides', _scheduled_rides,
    'demand_supply_delta', (_pending_requests - _scheduled_rides)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_org_plan_usage(
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
  _plan text;
  _active_users integer := 0;
  _included integer := 0;
  _overage_users integer := 0;
  _overage_rate numeric := 0;
BEGIN
  SELECT plan INTO _plan FROM public.organisations WHERE id = p_org_id;

  BEGIN
    SELECT public.org_active_user_count(p_org_id, p_month) INTO _active_users;
  EXCEPTION
    WHEN OTHERS THEN
      _active_users := 0;
  END;

  _active_users := COALESCE(_active_users, 0);

  IF _plan = 'free' THEN
    _included := 10;
    _overage_rate := 0;
  ELSIF _plan = 'starter' THEN
    _included := 20;
    _overage_rate := 2.0;
  ELSIF _plan = 'business' THEN
    _included := 100;
    _overage_rate := 1.5;
  ELSE
    _included := 999999;
    _overage_rate := 0;
  END IF;

  _overage_users := GREATEST(_active_users - _included, 0);

  RETURN json_build_object(
    'plan', COALESCE(_plan, 'free'),
    'active_users', _active_users,
    'included_users', _included,
    'overage_users', _overage_users,
    'overage_rate', _overage_rate,
    'estimated_overage_cost', round((_overage_users * _overage_rate)::numeric, 2)
  );
END;
$$;
