-- =============================================================
-- Migration 0011: Admin analytics and map layer payloads
-- =============================================================

-- 1) Org analytics summary for admin dashboards
CREATE OR REPLACE FUNCTION public.get_org_analytics_summary(
  p_org_id uuid,
  p_month date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
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
  SELECT public.org_active_user_count(p_org_id, p_month)
  INTO _active_users;

  SELECT count(*)::integer
  INTO _total_rides
  FROM public.rides r
  JOIN public.users u ON u.id = r.driver_id
  WHERE u.org_id = p_org_id
    AND r.depart_at >= _month_start
    AND r.depart_at < _month_end
    AND r.status IN ('scheduled', 'active', 'completed');

  -- Approximate CO2 benefit; replace with exact emissions model later.
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

-- 2) Monetization metrics by plan and active-user overage
CREATE OR REPLACE FUNCTION public.get_org_plan_usage(
  p_org_id uuid,
  p_month date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan text;
  _active_users integer;
  _included integer := 0;
  _overage_users integer := 0;
  _overage_rate numeric := 0;
BEGIN
  SELECT plan INTO _plan FROM public.organisations WHERE id = p_org_id;
  SELECT public.org_active_user_count(p_org_id, p_month) INTO _active_users;

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
    'plan', _plan,
    'active_users', _active_users,
    'included_users', _included,
    'overage_users', _overage_users,
    'overage_rate', _overage_rate,
    'estimated_overage_cost', round((_overage_users * _overage_rate)::numeric, 2)
  );
END;
$$;

-- 3) GeoJSON payload for discover map layers (heat, clusters, routes)
CREATE OR REPLACE FUNCTION public.get_map_layers_for_discover(
  p_user_id uuid,
  p_scope text DEFAULT 'network'
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _demand json;
  _supply json;
  _routes json;
BEGIN
  SELECT org_id INTO _org_id FROM public.users WHERE id = p_user_id;

  WITH demand AS (
    SELECT
      json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(rr.origin::geometry)::json,
        'properties', json_build_object('kind', 'demand')
      ) AS feature
    FROM public.ride_requests rr
    JOIN public.users u ON u.id = rr.passenger_id
    WHERE rr.status = 'pending'
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (p_scope = 'extended')
      )
  )
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _demand
  FROM demand;

  WITH supply AS (
    SELECT
      json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(r.origin::geometry)::json,
        'properties', json_build_object('kind', 'supply')
      ) AS feature
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (p_scope = 'extended')
      )
  )
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _supply
  FROM supply;

  WITH routes AS (
    SELECT
      json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(r.route_geometry::geometry)::json,
        'properties', json_build_object('kind', 'route')
      ) AS feature
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND r.route_geometry IS NOT NULL
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (p_scope = 'extended')
      )
  )
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _routes
  FROM routes;

  RETURN json_build_object(
    'demand_points', COALESCE(_demand, json_build_object('type','FeatureCollection','features','[]'::json)),
    'supply_points', COALESCE(_supply, json_build_object('type','FeatureCollection','features','[]'::json)),
    'route_lines', COALESCE(_routes, json_build_object('type','FeatureCollection','features','[]'::json))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_analytics_summary(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_plan_usage(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_map_layers_for_discover(uuid, text) TO authenticated;
