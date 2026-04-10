-- Snap owner's saved driving route onto each new crew so later profile route changes do not move the crew line.
-- Formation candidate RPC uses the caller's saved commute_routes line (not home–work straight line).

ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS locked_formation_route_geom geography(LineString) NULL,
  ADD COLUMN IF NOT EXISTS locked_route_distance_m double precision NULL,
  ADD COLUMN IF NOT EXISTS locked_route_duration_s integer NULL;

CREATE OR REPLACE FUNCTION public.poolyn_org_crew_route_candidates(
  p_detour_mins integer
)
RETURNS TABLE (
  id uuid,
  full_name text,
  home_lat double precision,
  home_lng double precision,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT u.org_id, u.home_location, u.work_location
    FROM public.users u
    WHERE u.id = auth.uid()
  ),
  my_corridor AS (
    SELECT COALESCE(
      (
        SELECT cr.route_geom
        FROM public.commute_routes cr
        WHERE cr.user_id = auth.uid()
          AND cr.direction = 'to_work'
        LIMIT 1
      ),
      (
        SELECT ST_MakeLine(me.home_location::geometry, me.work_location::geometry)::geography
        FROM me
        WHERE me.home_location IS NOT NULL
          AND me.work_location IS NOT NULL
      )
    ) AS g
  ),
  buf AS (
    SELECT GREATEST(500::double precision, LEAST(25000::double precision, COALESCE(p_detour_mins, 12)::double precision * 625)) AS m
  )
  SELECT u.id,
         COALESCE(NULLIF(trim(u.full_name), ''), 'Poolyn member')::text AS full_name,
         ST_Y(u.home_location::geometry)::double precision AS home_lat,
         ST_X(u.home_location::geometry)::double precision AS home_lng,
         u.avatar_url::text AS avatar_url
  FROM public.users u
  CROSS JOIN me
  CROSS JOIN my_corridor mc
  CROSS JOIN buf
  WHERE u.id <> auth.uid()
    AND u.active = true
    AND u.onboarding_completed = true
    AND u.home_location IS NOT NULL
    AND me.org_id IS NOT NULL
    AND u.org_id = me.org_id
    AND (
      (
        me.home_location IS NOT NULL
        AND me.work_location IS NOT NULL
        AND mc.g IS NOT NULL
        AND ST_DWithin(u.home_location, mc.g, (SELECT m FROM buf))
      )
      OR (
        me.home_location IS NOT NULL
        AND me.work_location IS NOT NULL
        AND mc.g IS NULL
        AND ST_DWithin(
          u.home_location,
          ST_MakeLine(me.home_location::geometry, me.work_location::geometry)::geography,
          (SELECT m FROM buf)
        )
      )
      OR (
        me.home_location IS NOT NULL
        AND me.work_location IS NULL
        AND ST_DWithin(u.home_location, me.home_location, (SELECT m * 1.5 FROM buf))
      )
    )
    AND (
      me.work_location IS NULL
      OR u.work_location IS NULL
      OR ST_DWithin(u.work_location, me.work_location, 15000)
    )
  ORDER BY u.full_name NULLS LAST
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_crew_route_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_crew_route_candidates(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_lock_crew_formation_route(p_crew_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crew_members cm
    WHERE cm.crew_id = p_crew_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'owner'
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.crews c
    WHERE c.id = p_crew_id AND c.locked_formation_route_geom IS NOT NULL
  ) THEN
    RETURN json_build_object('ok', true, 'reason', 'already_locked');
  END IF;

  UPDATE public.crews c
  SET
    locked_formation_route_geom = cr.route_geom,
    locked_route_distance_m = cr.distance_m,
    locked_route_duration_s = cr.duration_s,
    updated_at = now()
  FROM public.commute_routes cr
  WHERE c.id = p_crew_id
    AND c.locked_formation_route_geom IS NULL
    AND cr.user_id = auth.uid()
    AND cr.direction = 'to_work';

  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    RETURN json_build_object('ok', true);
  END IF;

  RETURN json_build_object('ok', false, 'reason', 'no_commute_route');
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_lock_crew_formation_route(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_lock_crew_formation_route(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_crew_routine_map_route_geojson(p_crew_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ST_AsGeoJSON(c.locked_formation_route_geom::geometry)::jsonb
      FROM public.crews c
      INNER JOIN public.crew_members cm ON cm.crew_id = c.id AND cm.user_id = auth.uid()
      WHERE c.id = p_crew_id
        AND c.locked_formation_route_geom IS NOT NULL
    ),
    (
      SELECT ST_AsGeoJSON(cr.route_geom::geometry)::jsonb
      FROM public.crew_members cm
      INNER JOIN public.commute_routes cr
        ON cr.user_id = auth.uid() AND cr.direction = 'to_work'
      WHERE cm.crew_id = p_crew_id
        AND cm.user_id = auth.uid()
      LIMIT 1
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_crew_routine_map_route_geojson(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_routine_map_route_geojson(uuid) TO authenticated;
