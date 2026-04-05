-- Targeted driver notifications (rides with seats, route corridor, home proximity)
-- + "leave now" vs minutes-from-now on create_commute_ride_request.
-- + Try trusted auto-assign immediately when rider asks for "now".

DROP FUNCTION IF EXISTS public.create_commute_ride_request(text, timestamptz, integer, text);

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

REVOKE ALL ON FUNCTION public.create_commute_ride_request(text, integer, timestamptz, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_commute_ride_request(text, integer, timestamptz, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_notify_drivers_on_ride_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p_org uuid;
  _p_name text;
  _immediate boolean;
  _title text;
  _body text;
  _inserted integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT org_id, NULLIF(trim(full_name), '') INTO _p_org, _p_name
  FROM public.users WHERE id = NEW.passenger_id;

  _immediate := NEW.desired_depart_at <= (now() + interval '3 minutes');
  _title := CASE
    WHEN _immediate THEN 'Pickup needed now'
    ELSE 'Scheduled pickup'
  END;
  _body := CASE
    WHEN _immediate THEN
      COALESCE(_p_name, 'A colleague') || ' needs a ride now. Tap here to accept.'
    ELSE
      COALESCE(_p_name, 'A colleague') || ' requested a pickup with advance notice. Tap here to accept.'
  END;

  IF _p_org IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT DISTINCT c.driver_id,
      'ride_request_pending',
      _title,
      _body,
      jsonb_build_object(
        'ride_request_id', NEW.id,
        'urgency', CASE WHEN _immediate THEN 'now' ELSE 'scheduled' END
      )
    FROM (
      SELECT r.driver_id AS driver_id
      FROM public.rides r
      JOIN public.users du ON du.id = r.driver_id
      WHERE r.status = 'scheduled'
        AND r.seats_available > 0
        AND r.driver_id <> NEW.passenger_id
        AND du.org_id IS NOT DISTINCT FROM _p_org
        AND du.role IN ('driver', 'both')
        AND du.active = true
        AND ABS(EXTRACT(EPOCH FROM (r.depart_at - NEW.desired_depart_at)) / 60)
            <= GREATEST(NEW.flexibility_mins, 40)
        AND (
          ST_DWithin(r.origin, NEW.origin, 12000)
          OR ST_DWithin(r.destination, NEW.destination, 15000)
          OR ST_DWithin(r.origin, NEW.destination, 10000)
        )
      UNION
      SELECT cr.user_id AS driver_id
      FROM public.commute_routes cr
      JOIN public.users du ON du.id = cr.user_id
      JOIN public.vehicles v ON v.user_id = cr.user_id AND v.active = true AND v.seats > 1
      WHERE cr.user_id <> NEW.passenger_id
        AND cr.direction = NEW.direction
        AND du.org_id IS NOT DISTINCT FROM _p_org
        AND du.role IN ('driver', 'both')
        AND du.active = true
        AND ST_DWithin(cr.route_geom, NEW.origin, 9000)
      UNION
      SELECT du.id AS driver_id
      FROM public.users du
      JOIN public.vehicles v ON v.user_id = du.id AND v.active = true AND v.seats > 1
      WHERE du.id <> NEW.passenger_id
        AND du.org_id IS NOT DISTINCT FROM _p_org
        AND du.role IN ('driver', 'both')
        AND du.active = true
        AND du.home_location IS NOT NULL
        AND ST_DWithin(du.home_location, NEW.origin, 15000)
      UNION
      SELECT s.id AS driver_id
      FROM (
        SELECT du2.id AS id,
          ST_Distance(du2.home_location, NEW.origin) AS d
        FROM public.users du2
        JOIN public.vehicles v2 ON v2.user_id = du2.id AND v2.active = true AND v2.seats > 1
        WHERE du2.id <> NEW.passenger_id
          AND du2.org_id IS NOT DISTINCT FROM _p_org
          AND du2.role IN ('driver', 'both')
          AND du2.active = true
          AND du2.home_location IS NOT NULL
        ORDER BY d
        LIMIT 8
      ) s
    ) c
    WHERE c.driver_id IS NOT NULL;

    GET DIAGNOSTICS _inserted = ROW_COUNT;

    IF COALESCE(_inserted, 0) = 0 THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      SELECT du5.id,
        'ride_request_pending',
        _title,
        _body,
        jsonb_build_object(
          'ride_request_id', NEW.id,
          'urgency', CASE WHEN _immediate THEN 'now' ELSE 'scheduled' END,
          'fallback', true
        )
      FROM public.users du5
      JOIN public.vehicles v5 ON v5.user_id = du5.id AND v5.active = true AND v5.seats > 1
      WHERE du5.id <> NEW.passenger_id
        AND du5.org_id IS NOT DISTINCT FROM _p_org
        AND du5.role IN ('driver', 'both')
        AND du5.active = true
      LIMIT 20;
    END IF;
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT x.id,
      'ride_request_pending',
      _title,
      _body,
      jsonb_build_object(
        'ride_request_id', NEW.id,
        'urgency', CASE WHEN _immediate THEN 'now' ELSE 'scheduled' END
      )
    FROM (
      SELECT u2.id,
        ST_Distance(u2.home_location, NEW.origin) AS d
      FROM public.users u2
      JOIN public.vehicles v2 ON v2.user_id = u2.id AND v2.active = true AND v2.seats > 1
      WHERE u2.id <> NEW.passenger_id
        AND u2.role IN ('driver', 'both')
        AND u2.active = true
        AND u2.home_location IS NOT NULL
        AND ST_DWithin(u2.home_location, NEW.origin, 25000)
      ORDER BY d
      LIMIT 12
    ) x;
  END IF;

  IF _immediate THEN
    PERFORM public.auto_assign_driver_for_request(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;
