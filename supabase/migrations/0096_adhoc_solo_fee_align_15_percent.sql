-- Align ad-hoc seat acceptance fee with solo_driver rate (15%) after 0095 marketplace fees.

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
  v_leg_m double precision;
  v_contrib integer;
  v_memb boolean;
  v_fee integer;
  v_cash integer;
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

  v_leg_m := ST_Distance(
    v_b.passenger_pickup,
    COALESCE(v_b.passenger_search_dest, v_r.destination)
  );
  v_contrib := GREATEST(300, LEAST(2500000, ROUND((v_leg_m / 1000.0) * 18.0)::integer));
  v_memb := public.is_user_org_member(v_b.passenger_id);
  v_fee := CASE WHEN v_memb THEN 0 ELSE (ROUND(v_contrib * 0.15))::integer END;
  v_cash := v_contrib + v_fee;

  UPDATE public.ride_passengers
  SET
    expected_contribution_cents = v_contrib,
    network_fee_cents = v_fee,
    cash_to_charge_cents = v_cash,
    points_cost = v_contrib,
    fee_product_type = CASE WHEN v_memb THEN 'organization_member'::text ELSE 'solo_driver'::text END
  WHERE ride_id = v_r.id
    AND passenger_id = v_b.passenger_id
    AND status = 'confirmed';

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

WITH leg AS (
  SELECT
    rp2.id AS rpid,
    rp2.passenger_id,
    GREATEST(
      300,
      LEAST(
        2500000,
        ROUND((ST_Distance(b.passenger_pickup, COALESCE(b.passenger_search_dest, r.destination)) / 1000.0) * 18.0)::integer
      )
    ) AS contrib
  FROM public.ride_passengers rp2
  INNER JOIN public.rides r ON r.id = rp2.ride_id
  INNER JOIN public.adhoc_seat_bookings b
    ON b.ride_id = r.id AND b.passenger_id = rp2.passenger_id AND b.status = 'accepted'
  WHERE r.poolyn_context = 'adhoc'
    AND rp2.status = 'confirmed'
    AND COALESCE(rp2.expected_contribution_cents, 0) = 0
),
calc AS (
  SELECT
    leg.rpid,
    leg.contrib,
    CASE
      WHEN public.is_user_org_member(leg.passenger_id) THEN 0
      ELSE (ROUND(leg.contrib * 0.15))::integer
    END AS fee
  FROM leg
)
UPDATE public.ride_passengers rp
SET
  expected_contribution_cents = calc.contrib,
  network_fee_cents = calc.fee,
  cash_to_charge_cents = calc.contrib + calc.fee,
  points_cost = calc.contrib,
  fee_product_type = CASE
    WHEN public.is_user_org_member(rp.passenger_id) THEN 'organization_member'::text
    ELSE 'solo_driver'::text
  END
FROM calc
WHERE rp.id = calc.rpid;
