-- Route people directory: expose peer commute pin (same geometry used for distance) for map accuracy.
-- Open lane: exclude members of organisations with allow_cross_org = false from everyone outside that org
-- (they remain visible in Squad lane to same-org teammates).

CREATE OR REPLACE FUNCTION public.poolyn_route_people_directory(
  p_pool_scope text DEFAULT 'team',
  p_sort text DEFAULT 'nearest',
  p_max_distance_m integer DEFAULT 50000
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_home geography;
  v_org_id uuid;
  v_net_ok boolean;
  v_corridor geography;
  v_scope text;
  v_sort text;
  v_max_m integer;
  v_allow_cross boolean;
  v_restricted boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_scope := lower(trim(COALESCE(p_pool_scope, 'team')));
  IF v_scope NOT IN ('team', 'open') THEN
    v_scope := 'team';
  END IF;

  v_sort := lower(trim(COALESCE(p_sort, 'nearest')));
  IF v_sort NOT IN ('nearest', 'farthest') THEN
    v_sort := 'nearest';
  END IF;

  v_max_m := GREATEST(1000, LEAST(COALESCE(p_max_distance_m, 50000), 200000));

  SELECT u.home_location, u.org_id,
    EXISTS (
      SELECT 1 FROM public.organisations o
      WHERE o.id = u.org_id AND o.status IN ('active', 'grace')
    )
  INTO v_home, v_org_id, v_net_ok
  FROM public.users u
  WHERE u.id = v_uid;

  IF v_home IS NULL THEN
    RETURN json_build_object(
      'ok', true,
      'restricted', false,
      'people', '[]'::json,
      'reason', 'no_home'
    );
  END IF;

  SELECT COALESCE(o.allow_cross_org, false)
  INTO v_allow_cross
  FROM public.organisations o
  WHERE o.id = v_org_id;

  IF v_org_id IS NOT NULL AND NOT COALESCE(v_allow_cross, false) AND v_scope = 'open' THEN
    v_restricted := true;
  END IF;

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
  INTO v_corridor
  FROM public.users uh
  WHERE uh.id = v_uid;

  RETURN (
    WITH peers AS (
      SELECT
        u.id AS user_id,
        u.full_name,
        u.role::text AS user_role,
        u.org_id AS peer_org_id,
        o.name AS org_name,
        (o.settings->>'logo_path')::text AS org_logo_path,
        ROUND(
          ST_Distance(
            v_home,
            COALESCE(u.home_location, u.work_location)::geography
          )
        )::integer AS distance_m,
        CASE
          WHEN u.role IN ('driver', 'both') AND u.work_location IS NOT NULL THEN 'driver_pin'
          ELSE 'rider_pin'
        END AS pin_kind,
        ST_X(COALESCE(u.home_location, u.work_location)::geometry)::double precision AS pin_lng,
        ST_Y(COALESCE(u.home_location, u.work_location)::geometry)::double precision AS pin_lat
      FROM public.users u
      LEFT JOIN public.organisations o ON o.id = u.org_id
      WHERE u.id <> v_uid
        AND u.active = true
        AND COALESCE(u.onboarding_completed, false) = true
        AND COALESCE(u.home_location, u.work_location) IS NOT NULL
        AND ST_Distance(
          v_home,
          COALESCE(u.home_location, u.work_location)::geography
        ) <= v_max_m
        AND (
          (
            v_scope = 'team'
            AND v_net_ok
            AND v_org_id IS NOT NULL
            AND u.org_id IS NOT DISTINCT FROM v_org_id
            AND (
              v_corridor IS NULL
              OR (
                (u.home_location IS NOT NULL AND ST_Intersects(u.home_location::geometry, v_corridor::geometry))
                OR (u.work_location IS NOT NULL AND ST_Intersects(u.work_location::geometry, v_corridor::geometry))
              )
            )
          )
          OR (
            v_scope = 'open'
            AND NOT v_restricted
            AND v_corridor IS NOT NULL
            AND (
              u.org_id IS NULL
              OR COALESCE(o.allow_cross_org, false) = true
            )
            AND (
              (u.home_location IS NOT NULL AND ST_Intersects(u.home_location::geometry, v_corridor::geometry))
              OR (u.work_location IS NOT NULL AND ST_Intersects(u.work_location::geometry, v_corridor::geometry))
            )
          )
        )
    ),
    ranked AS (
      SELECT *
      FROM peers
      ORDER BY
        CASE WHEN v_sort = 'farthest' THEN -distance_m ELSE distance_m END ASC,
        full_name ASC
    )
    SELECT json_build_object(
      'ok', true,
      'restricted', v_restricted,
      'people', COALESCE(
        (SELECT json_agg(
          json_build_object(
            'user_id', user_id,
            'full_name', full_name,
            'user_role', user_role,
            'org_id', peer_org_id,
            'org_name', org_name,
            'org_logo_path', NULLIF(trim(org_logo_path), ''),
            'distance_m', distance_m,
            'pin_kind', pin_kind,
            'pin_lng', pin_lng,
            'pin_lat', pin_lat
          )
        ) FROM ranked),
        '[]'::json
      )
    )
  );
END;
$$;
