-- Allow drivers to accept pickup requests across organisations when both orgs permit
-- cross-network commuting (allow_cross_org) and the driver has opted into outer riders.
-- Aligns accept_ride_request_as_driver with prefilter_commute_match_pairs / RLS.

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
  _d_org_allow boolean;
  _p_org_allow boolean;
  _network_scope text;
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

  IF _p.org_id IS NOT DISTINCT FROM _d.org_id THEN
    _network_scope := 'network';
  ELSE
    _network_scope := 'extended';
    IF _d.org_id IS NOT NULL THEN
      SELECT o.allow_cross_org INTO _d_org_allow
      FROM public.organisations o
      WHERE o.id = _d.org_id;
      IF COALESCE(_d_org_allow, false) IS NOT TRUE THEN
        RETURN json_build_object('ok', false, 'reason', 'driver_org_closed_network');
      END IF;
      IF COALESCE(_d.driver_show_outer_network_riders, false) IS NOT TRUE THEN
        RETURN json_build_object('ok', false, 'reason', 'driver_outer_riders_disabled');
      END IF;
    END IF;

    IF _p.org_id IS NOT NULL THEN
      SELECT o.allow_cross_org INTO _p_org_allow
      FROM public.organisations o
      WHERE o.id = _p.org_id;
      IF COALESCE(_p_org_allow, false) IS NOT TRUE THEN
        RETURN json_build_object('ok', false, 'reason', 'passenger_org_closed_network');
      END IF;
    END IF;
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
    _network_scope
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
