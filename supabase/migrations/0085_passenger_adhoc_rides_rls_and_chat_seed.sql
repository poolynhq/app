-- 1) Let riders read a ride row while their ad-hoc seat request is still pending (needed for My rides + client joins).
DROP POLICY IF EXISTS "Passengers can view rides for pending adhoc seat requests" ON public.rides;
CREATE POLICY "Passengers can view rides for pending adhoc seat requests"
  ON public.rides FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.adhoc_seat_bookings b
      WHERE b.ride_id = id
        AND b.passenger_id = auth.uid()
        AND b.status = 'pending'
    )
  );

-- 2) Upcoming rides as passenger (same reliability pattern as poolyn_list_my_upcoming_driver_rides).
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
            'notes', r.notes
          ) AS row_json
        FROM public.ride_passengers rp
        INNER JOIN public.rides r ON r.id = rp.ride_id
        INNER JOIN public.users du ON du.id = r.driver_id
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

-- 3) On accept: seed ride chat with passenger request note and driver response note (if non-empty).
CREATE OR REPLACE FUNCTION public.poolyn_respond_adhoc_seat_booking(
  p_booking_id uuid,
  p_accept boolean,
  p_message text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.adhoc_seat_bookings;
  v_r public.rides;
  v_msg text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_b FROM public.adhoc_seat_bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_b.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = v_b.ride_id FOR UPDATE;
  IF v_r.driver_id <> v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'not_driver');
  END IF;

  v_msg := LEFT(NULLIF(trim(p_message), ''), 500);

  IF NOT p_accept THEN
    UPDATE public.adhoc_seat_bookings
    SET status = 'declined',
        driver_response_message = v_msg,
        responded_at = now()
    WHERE id = v_b.id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_b.passenger_id,
      'adhoc_seat_declined',
      'Seat request update',
      'The driver declined this time. You can search for another trip.',
      jsonb_build_object('adhoc_booking_id', v_b.id, 'ride_id', v_r.id)
    );

    RETURN json_build_object('ok', true, 'status', 'declined');
  END IF;

  IF v_r.seats_available < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_seats');
  END IF;
  IF v_b.needs_checked_bag AND v_r.baggage_slots_available < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_baggage_slots');
  END IF;

  UPDATE public.rides
  SET
    seats_available = seats_available - 1,
    baggage_slots_available = CASE
      WHEN v_b.needs_checked_bag THEN baggage_slots_available - 1
      ELSE baggage_slots_available
    END,
    updated_at = now()
  WHERE id = v_r.id;

  INSERT INTO public.ride_passengers (ride_id, passenger_id, status, pickup_point, points_cost)
  VALUES (v_r.id, v_b.passenger_id, 'confirmed', v_b.passenger_pickup, 0);

  IF NULLIF(trim(COALESCE(v_b.passenger_message, '')), '') IS NOT NULL THEN
    INSERT INTO public.messages (ride_id, sender_id, body, sent_at)
    VALUES (v_r.id, v_b.passenger_id, trim(v_b.passenger_message), now());
  END IF;

  IF v_msg IS NOT NULL THEN
    INSERT INTO public.messages (ride_id, sender_id, body, sent_at)
    VALUES (v_r.id, v_uid, v_msg, now() + interval '2 milliseconds');
  END IF;

  UPDATE public.adhoc_seat_bookings
  SET status = 'accepted',
      driver_response_message = v_msg,
      responded_at = now()
  WHERE id = v_b.id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_b.passenger_id,
    'adhoc_seat_accepted',
    'Seat confirmed',
    'Your seat request was accepted. Open Messages for this ride to coordinate in Poolyn.',
    jsonb_build_object('adhoc_booking_id', v_b.id, 'ride_id', v_r.id)
  );

  RETURN json_build_object('ok', true, 'status', 'accepted', 'ride_id', v_r.id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_respond_adhoc_seat_booking(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_respond_adhoc_seat_booking(uuid, boolean, text) TO authenticated;
