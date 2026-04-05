-- One open pickup request per passenger (stops spam + confusing multi-accept).
-- Richer passenger notification when a driver accepts.

CREATE OR REPLACE FUNCTION public.create_commute_ride_request(
  p_direction text DEFAULT 'to_work',
  p_leave_in_mins integer DEFAULT NULL,
  p_desired_depart_at timestamptz DEFAULT NULL,
  p_flexibility_mins integer DEFAULT 15,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  u_home geography;
  u_work geography;
  _origin geography;
  _dest geography;
  _id uuid;
  _depart timestamptz;
  _flex integer;
BEGIN
  IF _uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ride_requests
    WHERE passenger_id = _uid AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'already_has_pending_request');
  END IF;

  IF p_direction NOT IN ('to_work', 'from_work', 'custom') THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_direction');
  END IF;

  SELECT home_location, work_location INTO u_home, u_work
  FROM public.users WHERE id = _uid;

  IF u_home IS NULL OR u_work IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'commute_not_set');
  END IF;

  IF p_direction = 'to_work' THEN
    _origin := u_home;
    _dest := u_work;
  ELSIF p_direction = 'from_work' THEN
    _origin := u_work;
    _dest := u_home;
  ELSE
    _origin := u_home;
    _dest := u_work;
  END IF;

  IF p_desired_depart_at IS NOT NULL THEN
    _depart := p_desired_depart_at;
    _flex := GREATEST(COALESCE(p_flexibility_mins, 15), 5);
  ELSIF p_leave_in_mins IS NULL THEN
    _depart := now();
    _flex := GREATEST(COALESCE(p_flexibility_mins, 10), 5);
  ELSE
    _depart := now() + make_interval(mins => GREATEST(p_leave_in_mins, 1));
    _flex := GREATEST(COALESCE(p_flexibility_mins, 15), 5);
  END IF;

  INSERT INTO public.ride_requests (
    passenger_id,
    origin,
    destination,
    direction,
    desired_depart_at,
    flexibility_mins,
    status,
    notes
  )
  VALUES (
    _uid,
    _origin,
    _dest,
    p_direction,
    _depart,
    _flex,
    'pending',
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO _id;

  RETURN json_build_object('ok', true, 'ride_request_id', _id);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_ride_request_as_driver(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _req public.ride_requests;
  _p public.users;
  _d public.users;
  _veh record;
  _ride_id uuid;
  _seats_avail integer;
  _driver_display text;
BEGIN
  IF _uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO _d FROM public.users WHERE id = _uid;
  IF _d.role NOT IN ('driver', 'both') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_driver');
  END IF;

  SELECT * INTO _req FROM public.ride_requests WHERE id = p_request_id FOR UPDATE;
  IF _req.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'request_not_found');
  END IF;
  IF _req.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  SELECT * INTO _p FROM public.users WHERE id = _req.passenger_id;
  IF _p.org_id IS DISTINCT FROM _d.org_id THEN
    RETURN json_build_object('ok', false, 'reason', 'org_mismatch');
  END IF;

  IF _req.passenger_id = _uid THEN
    RETURN json_build_object('ok', false, 'reason', 'cannot_accept_own');
  END IF;

  SELECT id, seats INTO _veh
  FROM public.vehicles
  WHERE user_id = _uid AND active = true AND seats > 1
  ORDER BY created_at ASC
  LIMIT 1;

  IF _veh.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_vehicle');
  END IF;

  _seats_avail := GREATEST(_veh.seats - 2, 0);

  INSERT INTO public.rides (
    driver_id,
    vehicle_id,
    depart_at,
    status,
    ride_type,
    direction,
    origin,
    destination,
    seats_available
  )
  VALUES (
    _uid,
    _veh.id,
    _req.desired_depart_at,
    'scheduled',
    'adhoc',
    _req.direction,
    _req.origin,
    _req.destination,
    _seats_avail
  )
  RETURNING id INTO _ride_id;

  INSERT INTO public.ride_passengers (ride_id, passenger_id, status, points_cost)
  VALUES (_ride_id, _req.passenger_id, 'confirmed', 0)
  ON CONFLICT (ride_id, passenger_id) DO NOTHING;

  UPDATE public.ride_requests
  SET status = 'matched', matched_ride_id = _ride_id
  WHERE id = _req.id;

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
    _ride_id,
    _req.id,
    _uid,
    _req.passenger_id,
    1,
    'accepted',
    'accepted',
    'accepted',
    'network'
  );

  _driver_display := COALESCE(NULLIF(trim(_d.full_name), ''), 'Your driver');

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    _req.passenger_id,
    'ride_request_accepted',
    'Driver matched',
    _driver_display || ' accepted your pickup. Depart '
      || to_char(_req.desired_depart_at AT TIME ZONE 'UTC', 'HH24:MI')
      || ' UTC — check Home for your trip card.',
    jsonb_build_object('ride_id', _ride_id, 'ride_request_id', _req.id, 'driver_name', _driver_display)
  );

  RETURN json_build_object('ok', true, 'ride_id', _ride_id, 'ride_request_id', _req.id);
END;
$$;
