-- Reliable My Rides (passenger): list pending ad-hoc seat requests and cancel without depending on chained RLS selects.
-- Requires 0087 (passenger_search_* on adhoc_seat_bookings).

CREATE OR REPLACE FUNCTION public.poolyn_list_my_pending_adhoc_seat_requests()
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
        SELECT json_build_object(
          'booking_id', b.id,
          'ride_id', r.id,
          'created_at', b.created_at,
          'passenger_message', b.passenger_message,
          'needs_checked_bag', b.needs_checked_bag,
          'passenger_search_origin_label', b.passenger_search_origin_label,
          'passenger_search_dest_label', b.passenger_search_dest_label,
          'ride_depart_at', r.depart_at,
          'adhoc_origin_label', r.adhoc_origin_label,
          'adhoc_destination_label', r.adhoc_destination_label,
          'adhoc_trip_title', r.adhoc_trip_title,
          'listing_notes', r.notes,
          'driver_first_name', NULLIF(split_part(trim(COALESCE(du.full_name, '')), ' ', 1), '')
        ) AS row_json
        FROM public.adhoc_seat_bookings b
        INNER JOIN public.rides r ON r.id = b.ride_id
        INNER JOIN public.users du ON du.id = r.driver_id
        WHERE b.passenger_id = v_uid
          AND b.status = 'pending'
        ORDER BY r.depart_at ASC
      ) ordered_rows
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_list_my_pending_adhoc_seat_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_list_my_pending_adhoc_seat_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_cancel_my_adhoc_seat_request(p_booking_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b public.adhoc_seat_bookings;
  v_r public.rides;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_b FROM public.adhoc_seat_bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_b.passenger_id IS DISTINCT FROM v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'not_yours');
  END IF;
  IF v_b.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = v_b.ride_id;
  IF v_r.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'ride_not_found');
  END IF;

  UPDATE public.adhoc_seat_bookings
  SET status = 'cancelled',
      responded_at = now()
  WHERE id = v_b.id;

  v_name := NULLIF(trim((SELECT full_name FROM public.users WHERE id = v_uid)), '');
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_r.driver_id,
    'adhoc_seat_cancelled',
    'Seat request withdrawn',
    COALESCE(v_name, 'Someone') || ' cancelled their seat request for your posted trip.',
    jsonb_build_object('adhoc_booking_id', v_b.id, 'ride_id', v_r.id)
  );

  RETURN json_build_object('ok', true, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_cancel_my_adhoc_seat_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_cancel_my_adhoc_seat_request(uuid) TO authenticated;
