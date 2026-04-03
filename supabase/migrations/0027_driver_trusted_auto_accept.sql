-- Drivers who enable auto_accept only auto-confirm legacy ride requests for passengers in this list.
-- Same-org is already enforced in auto_assign candidates; UI will add rows after completed trips (later).

CREATE TABLE IF NOT EXISTS public.driver_trusted_passengers (
  driver_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, passenger_id),
  CHECK (driver_id <> passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_trusted_passengers_driver
  ON public.driver_trusted_passengers (driver_id);

ALTER TABLE public.driver_trusted_passengers ENABLE ROW LEVEL SECURITY;

CREATE POLICY driver_trusted_passengers_driver_rw ON public.driver_trusted_passengers
  FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

CREATE POLICY driver_trusted_passengers_passenger_read ON public.driver_trusted_passengers
  FOR SELECT
  USING (passenger_id = auth.uid());

GRANT ALL ON TABLE public.driver_trusted_passengers TO authenticated;

-- Align stored detour caps with 1–10 minute driver preference UI
UPDATE public.driver_preferences
SET max_detour_mins = LEAST(GREATEST(max_detour_mins, 1), 10);

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
      AND COALESCE(dp.auto_accept, false) = true
      AND EXISTS (
        SELECT 1 FROM public.driver_trusted_passengers tp
        WHERE tp.driver_id = r.driver_id
          AND tp.passenger_id = _request.passenger_id
      )
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
