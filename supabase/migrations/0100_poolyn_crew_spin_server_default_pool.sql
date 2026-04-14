-- Server-computed default wheel pool (two corridor ends) so all members see the same pair.
-- Pickup and route previews must not depend on spin pool; only driver selection uses the wheel.

DROP FUNCTION IF EXISTS public.poolyn_crew_driver_spin_open(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.poolyn_crew_spin_default_pool(p_crew_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pattern text;
  v_line geometry;
  v_owner uuid;
  v_home geometry;
  v_work geometry;
  r_min uuid;
  r_max uuid;
BEGIN
  SELECT COALESCE(c.commute_pattern, 'to_work')
  INTO v_pattern
  FROM public.crews c
  WHERE c.id = p_crew_id;

  IF v_pattern NOT IN ('to_work', 'to_home', 'round_trip') THEN
    v_pattern := 'to_work';
  END IF;

  SELECT c.locked_formation_route_geom::geometry
  INTO v_line
  FROM public.crews c
  WHERE c.id = p_crew_id
    AND c.locked_formation_route_geom IS NOT NULL;

  IF v_line IS NOT NULL THEN
    v_line := ST_LineMerge(v_line);
    IF ST_GeometryType(v_line) = 'ST_MultiLineString' THEN
      v_line := ST_GeometryN(v_line, 1);
    END IF;
    IF ST_GeometryType(v_line) <> 'ST_LineString' THEN
      v_line := NULL;
    END IF;
  END IF;

  IF v_line IS NULL THEN
    SELECT cm.user_id INTO v_owner
    FROM public.crew_members cm
    WHERE cm.crew_id = p_crew_id AND cm.role = 'owner'
    LIMIT 1;

    IF v_owner IS NULL THEN
      SELECT cm.user_id INTO v_owner
      FROM public.crew_members cm
      WHERE cm.crew_id = p_crew_id
      ORDER BY cm.joined_at ASC
      LIMIT 1;
    END IF;

    IF v_owner IS NULL THEN
      RETURN ARRAY[]::uuid[];
    END IF;

    SELECT u.home_location::geometry, u.work_location::geometry
    INTO v_home, v_work
    FROM public.users u
    WHERE u.id = v_owner;

    IF v_home IS NULL OR v_work IS NULL THEN
      RETURN ARRAY[]::uuid[];
    END IF;

    IF v_pattern = 'to_home' THEN
      v_line := ST_MakeLine(v_work, v_home);
    ELSE
      v_line := ST_MakeLine(v_home, v_work);
    END IF;

    IF v_line IS NULL OR ST_IsEmpty(v_line) THEN
      RETURN ARRAY[]::uuid[];
    END IF;
  END IF;

  WITH member_t AS (
    SELECT DISTINCT ON (cm.user_id)
      cm.user_id,
      ST_LineLocatePoint(v_line, u.home_location::geometry) AS t
    FROM public.crew_members cm
    INNER JOIN public.users u ON u.id = cm.user_id
    WHERE cm.crew_id = p_crew_id
      AND u.home_location IS NOT NULL
      AND ST_DWithin(
        u.home_location::geography,
        v_line::geography,
        15000::double precision
      )
    ORDER BY cm.user_id, ST_LineLocatePoint(v_line, u.home_location::geometry) ASC
  ),
  lo AS (
    SELECT user_id FROM member_t ORDER BY t ASC, user_id ASC LIMIT 1
  ),
  hi AS (
    SELECT user_id FROM member_t ORDER BY t DESC, user_id DESC LIMIT 1
  )
  SELECT l.user_id, h.user_id INTO r_min, r_max FROM lo l CROSS JOIN hi h;

  IF r_min IS NULL OR r_max IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  IF r_min = r_max THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  RETURN ARRAY[r_min, r_max];
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_spin_default_pool(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_spin_default_pool(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_crew_driver_spin_open(
  p_trip_instance_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_started timestamptz;
  v_finished timestamptz;
  v_pool uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id, cti.trip_started_at, cti.trip_finished_at
  INTO v_crew_id, v_started, v_finished
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_started IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_already_started');
  END IF;

  IF v_finished IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_already_finished');
  END IF;

  v_pool := public.poolyn_crew_spin_default_pool(v_crew_id);

  IF v_pool IS NULL OR array_length(v_pool, 1) < 2 THEN
    RETURN json_build_object('ok', false, 'reason', 'spin_pool_unavailable');
  END IF;

  INSERT INTO public.crew_driver_spin_sessions (
    crew_trip_instance_id,
    opened_by_user_id,
    pool_user_ids,
    phase,
    winner_user_id,
    winner_index,
    updated_at
  )
  VALUES (
    p_trip_instance_id,
    v_uid,
    v_pool,
    'open',
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (crew_trip_instance_id) DO UPDATE SET
    opened_by_user_id = EXCLUDED.opened_by_user_id,
    pool_user_ids = EXCLUDED.pool_user_ids,
    phase = 'open',
    winner_user_id = NULL,
    winner_index = NULL,
    updated_at = now();

  RETURN json_build_object(
    'ok', true,
    'opened_by_user_id', v_uid,
    'pool_user_ids', v_pool
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_driver_spin_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_driver_spin_open(uuid) TO authenticated;
