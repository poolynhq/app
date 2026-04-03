-- =============================================================
-- Migration 0013: Map layers — include profile-based locations
--
-- The existing get_map_layers_for_discover() only queries rides
-- and ride_requests. When no rides have been posted yet the map
-- is completely empty, which is misleading.
--
-- This migration replaces the function so that:
--   • Demand points = pending ride_request origins
--                     UNION commuter home_locations (pickup demand)
--   • Supply points  = scheduled ride origins
--                     UNION driver home_locations (capacity supply)
--   • Route lines    = saved route_geometry (unchanged)
--
-- Profile-based points are de-duplicated against ride-based ones
-- so active users don't appear twice. All privacy guarantees are
-- unchanged — RLS still applies, and only users visible in the
-- current scope are included.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_map_layers_for_discover(
  p_user_id uuid,
  p_scope    text DEFAULT 'network'
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id  uuid;
  _demand  json;
  _supply  json;
  _routes  json;
BEGIN
  SELECT org_id INTO _org_id FROM public.users WHERE id = p_user_id;

  -- ── Demand: ride_request origins + commuter home_locations ─────────────
  WITH ride_demand AS (
    SELECT rr.origin AS pt
    FROM public.ride_requests rr
    JOIN public.users u ON u.id = rr.passenger_id
    WHERE rr.status = 'pending'
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  ),
  profile_demand AS (
    -- Commuters with a saved home_location (pickup zone demand)
    SELECT u.home_location AS pt
    FROM public.users u
    WHERE u.id <> p_user_id
      AND u.active = true
      AND u.onboarding_completed = true
      AND u.home_location IS NOT NULL
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
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

  -- ── Supply: scheduled ride origins + driver home_locations ─────────────
  WITH ride_supply AS (
    SELECT r.origin AS pt
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  ),
  profile_supply AS (
    -- Users who can drive and have a saved work_location (commute destination)
    SELECT u.work_location AS pt
    FROM public.users u
    WHERE u.id <> p_user_id
      AND u.active = true
      AND u.onboarding_completed = true
      AND u.role IN ('driver', 'both')
      AND u.work_location IS NOT NULL
      AND (
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
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

  -- ── Routes: saved ride geometries (unchanged) ───────────────────────────
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
        (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
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

-- Permissions unchanged — already granted in 0011
GRANT EXECUTE ON FUNCTION public.get_map_layers_for_discover(uuid, text) TO authenticated;
