-- Rider search context on seat bookings: labels + destination pin for My rides copy and steps (pickup → rider dest).

ALTER TABLE public.adhoc_seat_bookings
  ADD COLUMN IF NOT EXISTS passenger_search_origin_label text,
  ADD COLUMN IF NOT EXISTS passenger_search_dest_label text,
  ADD COLUMN IF NOT EXISTS passenger_search_dest geography(Point, 4326);

COMMENT ON COLUMN public.adhoc_seat_bookings.passenger_search_origin_label IS
  'Rider search "leaving near" label at request time.';
COMMENT ON COLUMN public.adhoc_seat_bookings.passenger_search_dest_label IS
  'Rider search "going near" label at request time.';
COMMENT ON COLUMN public.adhoc_seat_bookings.passenger_search_dest IS
  'Rider destination pin: steps and Navigate "to destination" use this when set.';

-- Extended request RPC (new params have defaults; old -arg calls still work).
DROP FUNCTION IF EXISTS public.poolyn_request_adhoc_seat(uuid, double precision, double precision, text, boolean);

CREATE OR REPLACE FUNCTION public.poolyn_request_adhoc_seat(
  p_ride_id uuid,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_message text,
  p_needs_baggage boolean,
  p_dest_lat double precision DEFAULT NULL,
  p_dest_lng double precision DEFAULT NULL,
  p_search_origin_label text DEFAULT NULL,
  p_search_dest_label text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.rides;
  v_org uuid;
  v_driver_org uuid;
  v_pickup geography;
  v_dest geography;
  v_km real;
  v_id uuid;
  v_msg text;
  v_sol text;
  v_sdl text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'ride_not_found');
  END IF;
  IF v_r.poolyn_context <> 'adhoc' OR v_r.status <> 'scheduled' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_available');
  END IF;
  IF v_r.driver_id = v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'own_ride');
  END IF;
  IF v_r.seats_available < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_seats');
  END IF;
  IF p_needs_baggage AND v_r.baggage_slots_available < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_baggage_slots');
  END IF;

  SELECT org_id INTO v_org FROM public.users WHERE id = v_uid;
  SELECT org_id INTO v_driver_org FROM public.users WHERE id = v_r.driver_id;
  IF v_org IS NULL OR v_org IS DISTINCT FROM v_driver_org THEN
    RETURN json_build_object('ok', false, 'reason', 'org_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.adhoc_seat_bookings b
    WHERE b.ride_id = p_ride_id AND b.passenger_id = v_uid AND b.status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'already_pending');
  END IF;

  v_pickup := ST_SetSRID(ST_MakePoint(p_pickup_lng, p_pickup_lat), 4326)::geography;
  v_km := (ST_Distance(v_r.origin, v_pickup)::double precision / 1000.0)::real;
  v_msg := LEFT(NULLIF(trim(p_message), ''), 500);

  IF p_dest_lat IS NOT NULL AND p_dest_lng IS NOT NULL THEN
    v_dest := ST_SetSRID(ST_MakePoint(p_dest_lng, p_dest_lat), 4326)::geography;
  ELSE
    v_dest := NULL;
  END IF;

  v_sol := LEFT(NULLIF(trim(p_search_origin_label), ''), 200);
  v_sdl := LEFT(NULLIF(trim(p_search_dest_label), ''), 200);

  INSERT INTO public.adhoc_seat_bookings (
    ride_id,
    passenger_id,
    status,
    passenger_message,
    passenger_pickup,
    needs_checked_bag,
    pickup_km_from_ride_origin,
    passenger_search_origin_label,
    passenger_search_dest_label,
    passenger_search_dest
  )
  VALUES (
    p_ride_id,
    v_uid,
    'pending',
    v_msg,
    v_pickup,
    COALESCE(p_needs_baggage, false),
    v_km,
    NULLIF(v_sol, ''),
    NULLIF(v_sdl, ''),
    v_dest
  )
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_r.driver_id,
    'adhoc_seat_request',
    'Seat request',
    COALESCE(NULLIF(trim((SELECT full_name FROM public.users WHERE id = v_uid)), ''), 'Someone')
      || ' asked for a seat on your posted trip. Open My rides to respond.',
    jsonb_build_object('adhoc_booking_id', v_id, 'ride_id', p_ride_id)
  );

  RETURN json_build_object('ok', true, 'booking_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_request_adhoc_seat(
  uuid, double precision, double precision, text, boolean,
  double precision, double precision, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_request_adhoc_seat(
  uuid, double precision, double precision, text, boolean,
  double precision, double precision, text, text
) TO authenticated;

-- Passenger upcoming RPC: include rider search labels + dest from accepted booking.
CREATE OR REPLACE FUNCTION public.poolyn_list_my_upcoming_passenger_rides()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::json;
  END IF;

  RETURN COALESCE(
    (
      SELECT json_agg(row_json)
      FROM (
        SELECT
          json_build_object(
            'ride_id', r.id,
            'depart_at', r.depart_at,
            'status', r.status,
            'direction', r.direction,
            'origin', ST_AsGeoJSON(r.origin::geometry)::json,
            'destination', ST_AsGeoJSON(r.destination::geometry)::json,
            'driver_id', r.driver_id,
            'driver_full_name', du.full_name,
            'poolyn_context', r.poolyn_context,
            'adhoc_origin_label', r.adhoc_origin_label,
            'adhoc_destination_label', r.adhoc_destination_label,
            'adhoc_trip_title', r.adhoc_trip_title,
            'notes', r.notes,
            'passenger_pickup', CASE
              WHEN rp.pickup_point IS NULL THEN NULL
              ELSE ST_AsGeoJSON(rp.pickup_point::geometry)::json
            END,
            'passenger_search_origin_label', ab.passenger_search_origin_label,
            'passenger_search_dest_label', ab.passenger_search_dest_label,
            'passenger_search_dest', CASE
              WHEN ab.passenger_search_dest IS NULL THEN NULL
              ELSE ST_AsGeoJSON(ab.passenger_search_dest::geometry)::json
            END
          ) AS row_json
        FROM public.ride_passengers rp
        INNER JOIN public.rides r ON r.id = rp.ride_id
        INNER JOIN public.users du ON du.id = r.driver_id
        LEFT JOIN LATERAL (
          SELECT
            b.passenger_search_origin_label,
            b.passenger_search_dest_label,
            b.passenger_search_dest
          FROM public.adhoc_seat_bookings b
          WHERE b.ride_id = r.id
            AND b.passenger_id = v_uid
            AND b.status = 'accepted'
          ORDER BY b.responded_at DESC NULLS LAST, b.created_at DESC
          LIMIT 1
        ) ab ON true
        WHERE rp.passenger_id = v_uid
          AND rp.status = 'confirmed'
          AND r.status IN ('scheduled', 'active')
        ORDER BY r.depart_at ASC
      ) ordered_rows
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_list_my_upcoming_passenger_rides() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_list_my_upcoming_passenger_rides() TO authenticated;
