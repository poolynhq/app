-- Extended ("Any commuter") map scope: only peers whose points / routes intersect a buffer
-- around the viewer's home→work commute (or a radius around home if work missing).
-- Prevents map from fitting unrelated cities (e.g. Melbourne + Sydney) when widened.
-- If the viewer has no saved home location, extended returns no peer layers (pins only on client).

CREATE OR REPLACE FUNCTION public.get_map_layers_for_discover(
  p_user_id uuid,
  p_scope    text DEFAULT 'network'
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id   uuid;
  _net_ok   boolean;
  _demand   json;
  _supply   json;
  _routes   json;
  _corridor geography;
  _ext_ok   boolean;
BEGIN
  SELECT
    u.org_id,
    EXISTS (
      SELECT 1
      FROM public.organisations o
      WHERE o.id = u.org_id
        AND o.status IN ('active', 'grace')
    )
  INTO _org_id, _net_ok
  FROM public.users u
  WHERE u.id = p_user_id;

  _ext_ok := false;
  _corridor := NULL;

  IF p_scope = 'extended' THEN
    SELECT
      CASE
        WHEN uh.home_location IS NOT NULL AND uh.work_location IS NOT NULL THEN
          ST_Buffer(
            ST_MakeLine(uh.home_location::geometry, uh.work_location::geometry)::geography,
            35000
          )
        WHEN uh.home_location IS NOT NULL THEN
          ST_Buffer(uh.home_location, 45000)
        ELSE NULL
      END
    INTO _corridor
    FROM public.users uh
    WHERE uh.id = p_user_id;

    _ext_ok := (_corridor IS NOT NULL);
  END IF;

  WITH ride_demand AS (
    SELECT rr.origin AS pt
    FROM public.ride_requests rr
    JOIN public.users u ON u.id = rr.passenger_id
    WHERE rr.status = 'pending'
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (
          p_scope = 'extended'
          AND _ext_ok
          AND ST_Intersects(rr.origin::geometry, _corridor::geometry)
        )
      )
  ),
  profile_demand AS (
    SELECT u.home_location AS pt
    FROM public.users u
    WHERE u.id <> p_user_id
      AND u.active = true
      AND u.onboarding_completed = true
      AND u.home_location IS NOT NULL
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (
          p_scope = 'extended'
          AND _ext_ok
          AND ST_Intersects(u.home_location::geometry, _corridor::geometry)
        )
      )
  ),
  all_demand AS (
    SELECT pt FROM ride_demand
    UNION ALL
    SELECT pt FROM profile_demand
  ),
  demand_features AS (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(pt::geometry)::json,
      'properties', json_build_object('kind', 'demand')
    ) AS feature
    FROM all_demand
    WHERE pt IS NOT NULL
  )
  SELECT json_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _demand
  FROM demand_features;

  WITH ride_supply AS (
    SELECT r.origin AS pt
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (
          p_scope = 'extended'
          AND _ext_ok
          AND ST_Intersects(r.origin::geometry, _corridor::geometry)
        )
      )
  ),
  profile_supply AS (
    SELECT u.work_location AS pt
    FROM public.users u
    WHERE u.id <> p_user_id
      AND u.active = true
      AND u.onboarding_completed = true
      AND u.role IN ('driver', 'both')
      AND u.work_location IS NOT NULL
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (
          p_scope = 'extended'
          AND _ext_ok
          AND ST_Intersects(u.work_location::geometry, _corridor::geometry)
        )
      )
  ),
  all_supply AS (
    SELECT pt FROM ride_supply
    UNION ALL
    SELECT pt FROM profile_supply
  ),
  supply_features AS (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(pt::geometry)::json,
      'properties', json_build_object('kind', 'supply')
    ) AS feature
    FROM all_supply
    WHERE pt IS NOT NULL
  )
  SELECT json_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _supply
  FROM supply_features;

  WITH route_features AS (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(r.route_geometry::geometry)::json,
      'properties', json_build_object('kind', 'route')
    ) AS feature
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND r.route_geometry IS NOT NULL
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR (
          p_scope = 'extended'
          AND _ext_ok
          AND ST_Intersects(r.route_geometry::geometry, _corridor::geometry)
        )
      )
  )
  SELECT json_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _routes
  FROM route_features;

  RETURN json_build_object(
    'demand_points', COALESCE(_demand, json_build_object('type','FeatureCollection','features','[]'::json)),
    'supply_points', COALESCE(_supply, json_build_object('type','FeatureCollection','features','[]'::json)),
    'route_lines',   COALESCE(_routes, json_build_object('type','FeatureCollection','features','[]'::json))
  );
END;
$$;
