-- Ad-hoc dated trips: passenger cancels confirmed seat; driver removes rider; driver cancels entire trip.
-- Inserts in-app notifications (push via existing webhook; email via optional Edge function).

CREATE OR REPLACE FUNCTION public.poolyn_passenger_cancel_confirmed_adhoc_seat(p_ride_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.rides;
  v_b public.adhoc_seat_bookings;
  v_rp public.ride_passengers;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'ride_not_found');
  END IF;
  IF v_r.poolyn_context <> 'adhoc' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_adhoc');
  END IF;
  IF v_r.status NOT IN ('scheduled', 'active') THEN
    RETURN json_build_object('ok', false, 'reason', 'ride_not_cancellable');
  END IF;

  SELECT * INTO v_rp
  FROM public.ride_passengers
  WHERE ride_id = p_ride_id AND passenger_id = v_uid AND status = 'confirmed'
  FOR UPDATE;
  IF v_rp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_confirmed_passenger');
  END IF;

  SELECT * INTO v_b
  FROM public.adhoc_seat_bookings
  WHERE ride_id = p_ride_id AND passenger_id = v_uid AND status = 'accepted'
  ORDER BY responded_at DESC NULLS LAST, created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_accepted_booking');
  END IF;

  UPDATE public.ride_passengers
  SET status = 'cancelled'
  WHERE id = v_rp.id;

  UPDATE public.adhoc_seat_bookings
  SET status = 'cancelled',
      responded_at = COALESCE(responded_at, now())
  WHERE id = v_b.id;

  UPDATE public.rides
  SET
    seats_available = seats_available + 1,
    baggage_slots_available = CASE
      WHEN v_b.needs_checked_bag THEN baggage_slots_available + 1
      ELSE baggage_slots_available
    END,
    updated_at = now()
  WHERE id = v_r.id;

  v_name := NULLIF(trim((SELECT full_name FROM public.users WHERE id = v_uid)), '');
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_r.driver_id,
    'adhoc_passenger_cancelled_seat',
    'Rider cancelled their seat',
    COALESCE(v_name, 'A rider') || ' cancelled their seat on your dated trip.',
    jsonb_build_object(
      'ride_id', v_r.id,
      'passenger_id', v_uid,
      'deep_link', '/(tabs)/rides/search-seat',
      'reason', 'passenger_cancelled'
    )
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_uid,
    'adhoc_you_cancelled_seat',
    'You left this trip',
    'You are no longer booked on this dated trip. Search for another ride anytime.',
    jsonb_build_object(
      'ride_id', v_r.id,
      'deep_link', '/(tabs)/rides/search-seat',
      'reason', 'self_cancelled'
    )
  );

  RETURN json_build_object('ok', true, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_passenger_cancel_confirmed_adhoc_seat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_passenger_cancel_confirmed_adhoc_seat(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_driver_remove_passenger_from_adhoc_ride(
  p_ride_id uuid,
  p_passenger_id uuid,
  p_message text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.rides;
  v_b public.adhoc_seat_bookings;
  v_rp public.ride_passengers;
  v_msg text;
  v_driver_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_r.id IS NULL OR v_r.driver_id IS DISTINCT FROM v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'not_driver');
  END IF;
  IF v_r.poolyn_context <> 'adhoc' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_adhoc');
  END IF;
  IF v_r.status NOT IN ('scheduled', 'active') THEN
    RETURN json_build_object('ok', false, 'reason', 'ride_not_active');
  END IF;
  IF p_passenger_id IS NULL OR p_passenger_id = v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_passenger');
  END IF;

  SELECT * INTO v_rp
  FROM public.ride_passengers
  WHERE ride_id = p_ride_id AND passenger_id = p_passenger_id AND status = 'confirmed'
  FOR UPDATE;
  IF v_rp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'passenger_not_confirmed');
  END IF;

  SELECT * INTO v_b
  FROM public.adhoc_seat_bookings
  WHERE ride_id = p_ride_id AND passenger_id = p_passenger_id AND status = 'accepted'
  ORDER BY responded_at DESC NULLS LAST, created_at DESC
  LIMIT 1
  FOR UPDATE;

  v_msg := LEFT(NULLIF(trim(p_message), ''), 500);

  UPDATE public.ride_passengers
  SET status = 'cancelled'
  WHERE id = v_rp.id;

  IF v_b.id IS NOT NULL THEN
    UPDATE public.adhoc_seat_bookings
    SET status = 'cancelled',
        driver_response_message = COALESCE(v_msg, driver_response_message),
        responded_at = COALESCE(responded_at, now())
    WHERE id = v_b.id;
  END IF;

  UPDATE public.rides
  SET
    seats_available = seats_available + 1,
    baggage_slots_available = CASE
      WHEN v_b.id IS NOT NULL AND COALESCE(v_b.needs_checked_bag, false) THEN baggage_slots_available + 1
      ELSE baggage_slots_available
    END,
    updated_at = now()
  WHERE id = v_r.id;

  v_driver_name := NULLIF(trim((SELECT full_name FROM public.users WHERE id = v_uid)), '');

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_passenger_id,
    'adhoc_driver_removed_you',
    'Removed from a dated trip',
    COALESCE(v_driver_name, 'The driver') || ' removed you from their dated trip.'
      || CASE WHEN v_msg IS NOT NULL THEN ' Note: ' || v_msg ELSE '' END,
    jsonb_build_object(
      'ride_id', v_r.id,
      'driver_id', v_uid,
      'deep_link', '/(tabs)/rides/search-seat',
      'driver_message', to_jsonb(COALESCE(v_msg, ''))
    )
  );

  RETURN json_build_object('ok', true, 'status', 'removed');
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_driver_remove_passenger_from_adhoc_ride(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_driver_remove_passenger_from_adhoc_ride(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_driver_cancel_adhoc_ride(
  p_ride_id uuid,
  p_reason_code text,
  p_reason_detail text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.rides;
  v_code text;
  v_detail text;
  v_label text;
  v_body text;
  rec record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_r.id IS NULL OR v_r.driver_id IS DISTINCT FROM v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'not_driver');
  END IF;
  IF v_r.poolyn_context <> 'adhoc' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_adhoc');
  END IF;
  IF v_r.status NOT IN ('scheduled', 'active') THEN
    RETURN json_build_object('ok', false, 'reason', 'already_finished');
  END IF;

  v_code := lower(trim(COALESCE(p_reason_code, '')));
  IF v_code NOT IN (
    'plans_changed',
    'vehicle_issue',
    'low_interest',
    'work_emergency',
    'weather',
    'other'
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_reason_code');
  END IF;

  v_detail := LEFT(NULLIF(trim(COALESCE(p_reason_detail, '')), ''), 500);

  IF v_code = 'other' AND v_detail IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'detail_required_for_other');
  END IF;

  v_label := CASE v_code
    WHEN 'plans_changed' THEN 'Plans changed'
    WHEN 'vehicle_issue' THEN 'Vehicle issue'
    WHEN 'low_interest' THEN 'Not enough riders or interest'
    WHEN 'work_emergency' THEN 'Work or personal emergency'
    WHEN 'weather' THEN 'Weather or conditions'
    WHEN 'other' THEN 'Other'
    ELSE v_code
  END;

  v_body := 'The driver cancelled this dated trip. Reason: ' || v_label
    || CASE WHEN v_code = 'other' AND v_detail IS NOT NULL THEN '. ' || v_detail
            WHEN v_code <> 'other' AND v_detail IS NOT NULL THEN ' (' || v_detail || ')'
            ELSE '' END
    || '. Search for another ride in Poolyn.';

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    sub.pid,
    'adhoc_trip_cancelled_by_driver',
    'Dated trip cancelled',
    v_body,
    jsonb_build_object(
      'ride_id', v_r.id,
      'reason_code', v_code,
      'reason_label', v_label,
      'reason_detail', to_jsonb(COALESCE(v_detail, '')),
      'deep_link', '/(tabs)/rides/search-seat'
    )
  FROM (
    SELECT rp.passenger_id AS pid
    FROM public.ride_passengers rp
    WHERE rp.ride_id = v_r.id AND rp.status = 'confirmed'
    UNION
    SELECT b.passenger_id AS pid
    FROM public.adhoc_seat_bookings b
    WHERE b.ride_id = v_r.id AND b.status = 'pending'
  ) sub;

  UPDATE public.rides
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_r.id;

  UPDATE public.adhoc_seat_bookings
  SET status = 'cancelled',
      responded_at = COALESCE(responded_at, now())
  WHERE ride_id = v_r.id
    AND status IN ('pending', 'accepted');

  UPDATE public.ride_passengers
  SET status = 'cancelled'
  WHERE ride_id = v_r.id AND status = 'confirmed';

  RETURN json_build_object('ok', true, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_driver_cancel_adhoc_ride(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_driver_cancel_adhoc_ride(uuid, text, text) TO authenticated;
