-- =============================================================
-- Migration 0010: Supply balancing and auto-assign driver logic
-- =============================================================

CREATE TABLE IF NOT EXISTS public.driver_assignment_stats (
  driver_id uuid PRIMARY KEY REFERENCES public.users ON DELETE CASCADE,
  assignments_30d integer NOT NULL DEFAULT 0,
  accepted_30d integer NOT NULL DEFAULT 0,
  declined_30d integer NOT NULL DEFAULT 0,
  participation_score real NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_assignment_participation
  ON public.driver_assignment_stats (participation_score DESC);

CREATE OR REPLACE FUNCTION public.recompute_driver_assignment_stats()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.driver_assignment_stats (
    driver_id,
    assignments_30d,
    accepted_30d,
    declined_30d,
    participation_score,
    updated_at
  )
  SELECT
    ms.driver_id,
    count(*) FILTER (WHERE ms.created_at >= now() - interval '30 day')::integer AS assignments_30d,
    count(*) FILTER (
      WHERE ms.created_at >= now() - interval '30 day'
        AND ms.driver_status = 'accepted'
    )::integer AS accepted_30d,
    count(*) FILTER (
      WHERE ms.created_at >= now() - interval '30 day'
        AND ms.driver_status = 'declined'
    )::integer AS declined_30d,
    (
      count(*) FILTER (
        WHERE ms.created_at >= now() - interval '30 day'
          AND ms.driver_status = 'accepted'
      )::real
      -
      count(*) FILTER (
        WHERE ms.created_at >= now() - interval '30 day'
          AND ms.driver_status = 'declined'
      )::real * 0.5
    ) AS participation_score,
    now()
  FROM public.match_suggestions ms
  GROUP BY ms.driver_id
  ON CONFLICT (driver_id) DO UPDATE SET
    assignments_30d = EXCLUDED.assignments_30d,
    accepted_30d = EXCLUDED.accepted_30d,
    declined_30d = EXCLUDED.declined_30d,
    participation_score = EXCLUDED.participation_score,
    updated_at = now();
END;
$$;

-- Select best driver by fairness + reliability + detour constraints
CREATE OR REPLACE FUNCTION public.auto_assign_driver_for_request(
  p_request_id uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _request public.ride_requests;
  _selected record;
  _match_id uuid;
BEGIN
  SELECT * INTO _request
  FROM public.ride_requests
  WHERE id = p_request_id
    AND status = 'pending';

  IF _request.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'request_not_pending');
  END IF;

  PERFORM public.recompute_driver_assignment_stats();

  WITH candidates AS (
    SELECT
      r.id AS ride_id,
      r.driver_id,
      COALESCE(u.reliability_score, 70) AS reliability,
      COALESCE(ds.participation_score, 0) AS participation_score,
      COALESCE(ds.assignments_30d, 0) AS assignments_30d,
      (
        LEAST(ST_Distance(r.origin, _request.origin), 30000) +
        LEAST(ST_Distance(r.destination, _request.destination), 30000)
      )::real AS distance_meters,
      ABS(EXTRACT(EPOCH FROM (r.depart_at - _request.desired_depart_at)) / 60)::integer AS time_gap_mins
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    LEFT JOIN public.driver_assignment_stats ds ON ds.driver_id = r.driver_id
    LEFT JOIN public.driver_preferences dp ON dp.user_id = r.driver_id
    WHERE r.status = 'scheduled'
      AND r.seats_available > 0
      AND r.driver_id <> _request.passenger_id
      AND (
        u.org_id IS NOT DISTINCT FROM (
          SELECT org_id FROM public.users WHERE id = _request.passenger_id
        )
        OR (
          u.org_id IS NULL
          AND (SELECT org_id FROM public.users WHERE id = _request.passenger_id) IS NULL
        )
      )
      AND ABS(EXTRACT(EPOCH FROM (r.depart_at - _request.desired_depart_at)) / 60)
            <= GREATEST(_request.flexibility_mins, 15)
      AND (
        dp.max_detour_mins IS NULL
        OR (
          (
            LEAST(ST_Distance(r.origin, _request.origin), 30000) +
            LEAST(ST_Distance(r.destination, _request.destination), 30000)
          ) / 1000.0
        ) <= dp.max_detour_mins
      )
  )
  SELECT
    c.ride_id,
    c.driver_id,
    (
      (c.reliability / 100.0) * 0.45
      + (GREATEST(0, 1 - LEAST(c.assignments_30d, 30) / 30.0) * 0.30)
      + (GREATEST(0, 1 - LEAST(c.time_gap_mins, 30) / 30.0) * 0.15)
      + (GREATEST(0, 1 - LEAST(c.distance_meters, 30000) / 30000.0) * 0.10)
    ) AS total_score
  INTO _selected
  FROM candidates c
  ORDER BY total_score DESC, c.participation_score DESC
  LIMIT 1;

  IF _selected.ride_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_driver_found');
  END IF;

  INSERT INTO public.ride_passengers (
    ride_id,
    passenger_id,
    status,
    points_cost
  )
  VALUES (
    _selected.ride_id,
    _request.passenger_id,
    'confirmed',
    0
  )
  ON CONFLICT (ride_id, passenger_id) DO NOTHING;

  UPDATE public.rides
  SET seats_available = GREATEST(seats_available - 1, 0)
  WHERE id = _selected.ride_id;

  UPDATE public.ride_requests
  SET status = 'matched',
      matched_ride_id = _selected.ride_id
  WHERE id = _request.id;

  INSERT INTO public.match_suggestions (
    ride_id,
    ride_request_id,
    driver_id,
    passenger_id,
    match_score,
    driver_status,
    passenger_status,
    status,
    network_scope
  )
  VALUES (
    _selected.ride_id,
    _request.id,
    _selected.driver_id,
    _request.passenger_id,
    1,
    'accepted',
    'accepted',
    'accepted',
    'network'
  )
  RETURNING id INTO _match_id;

  RETURN json_build_object(
    'ok', true,
    'ride_id', _selected.ride_id,
    'driver_id', _selected.driver_id,
    'request_id', _request.id,
    'match_id', _match_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_driver_assignment_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_driver_for_request(uuid) TO authenticated;
