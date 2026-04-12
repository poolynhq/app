-- Ad-hoc search: match rider "leaving near" along the driver's corridor (not only near the driver's start).
-- Ad-hoc accept: set ride_passengers.expected_contribution_cents from rider leg (pickup to search destination).
-- Backfill existing ad-hoc confirmed passengers that still have 0 contribution.

CREATE OR REPLACE FUNCTION public.poolyn_search_adhoc_listings(
  p_rider_date_from date,
  p_rider_date_to date,
  p_near_origin_lat double precision,
  p_near_origin_lng double precision,
  p_near_dest_lat double precision,
  p_near_dest_lng double precision,
  p_radius_km double precision DEFAULT 60,
  p_needs_baggage boolean DEFAULT false,
  p_depart_tz text DEFAULT 'Australia/Adelaide'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_o geography;
  v_d geography;
  v_tz text;
  v_rider_km double precision;
  v_preview integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_array();
  END IF;

  SELECT org_id INTO v_org FROM public.users WHERE id = v_uid;
  IF v_org IS NULL THEN
    RETURN json_build_array();
  END IF;

  v_tz := NULLIF(trim(p_depart_tz), '');
  IF v_tz IS NULL OR v_tz = '' THEN
    v_tz := 'Australia/Adelaide';
  END IF;

  v_o := ST_SetSRID(ST_MakePoint(p_near_origin_lng, p_near_origin_lat), 4326)::geography;
  v_d := ST_SetSRID(ST_MakePoint(p_near_dest_lng, p_near_dest_lat), 4326)::geography;
  v_rider_km := (ST_Distance(v_o, v_d)::double precision / 1000.0);
  v_preview := GREATEST(300, LEAST(2500000, ROUND(v_rider_km * 18.0)::integer));

  RETURN COALESCE(
    (
      SELECT json_agg(row_json ORDER BY depart_sort)
      FROM (
        SELECT
          r.depart_at AS depart_sort,
          json_build_object(
            'ride_id', r.id,
            'depart_at', r.depart_at,
            'adhoc_trip_title', r.adhoc_trip_title,
            'adhoc_origin_label', r.adhoc_origin_label,
            'adhoc_destination_label', r.adhoc_destination_label,
            'listing_notes', NULLIF(trim(r.notes), ''),
            'seats_available', r.seats_available,
            'baggage_slots_available', r.baggage_slots_available,
            'driver_first_name', split_part(COALESCE(NULLIF(trim(u.full_name), ''), 'Driver'), ' ', 1),
            'driver_full_name', NULLIF(trim(u.full_name), ''),
            'organisation_name', COALESCE(NULLIF(trim(o.name), ''), ''),
            'vehicle_make', COALESCE(NULLIF(trim(v.make), ''), ''),
            'vehicle_model', COALESCE(NULLIF(trim(v.model), ''), ''),
            'vehicle_label', trim(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '')),
            'vehicle_colour', v.colour,
            'driver_start_km_from_search_origin',
              ROUND((
                ST_Distance(r.origin, v_o)::double precision / 1000.0
              )::numeric, 1),
            'driver_end_km_from_search_dest',
              ROUND((
                ST_Distance(r.destination, v_d)::double precision / 1000.0
              )::numeric, 1),
            'rider_corridor_km', ROUND(v_rider_km::numeric, 1),
            'estimated_contribution_cents_preview', v_preview
          ) AS row_json
        FROM public.rides r
        JOIN public.users u ON u.id = r.driver_id
        JOIN public.vehicles v ON v.id = r.vehicle_id
        LEFT JOIN public.organisations o ON o.id = u.org_id
        WHERE r.poolyn_context = 'adhoc'
          AND r.status = 'scheduled'
          AND r.driver_id <> v_uid
          AND u.org_id IS NOT DISTINCT FROM v_org
          AND (NOT p_needs_baggage OR r.baggage_slots_available > 0)
          AND (
            (r.depart_at AT TIME ZONE v_tz)::date
              BETWEEN p_rider_date_from - COALESCE(r.adhoc_depart_flex_days, 0)
              AND p_rider_date_to + COALESCE(r.adhoc_depart_flex_days, 0)
          )
          AND (
            ST_DWithin(
              r.origin,
              v_o,
              LEAST(
                150000::double precision,
                GREATEST(
                  p_radius_km * 1000,
                  25000::double precision + (ST_Distance(r.origin, r.destination) / 1000.0) * 85
                )
              )
            )
            OR ST_Distance(
              v_o,
              ST_MakeLine(r.origin::geometry, r.destination::geometry)::geography
            ) <= LEAST(
              450000::double precision,
              GREATEST(
                100000::double precision,
                (ST_Distance(r.origin, r.destination) / 1000.0) * 280
              )
            )
          )
          AND (
            ST_DWithin(
              r.destination,
              v_d,
              LEAST(
                450000::double precision,
                GREATEST(
                  p_radius_km * 1000,
                  35000::double precision + (ST_Distance(r.origin, r.destination) / 1000.0) * 220
                )
              )
            )
            OR ST_Distance(
              v_d,
              ST_MakeLine(r.origin::geometry, r.destination::geometry)::geography
            ) <= LEAST(
              450000::double precision,
              GREATEST(
                100000::double precision,
                (ST_Distance(r.origin, r.destination) / 1000.0) * 280
              )
            )
          )
      ) sub
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_search_adhoc_listings(
  date, date,
  double precision, double precision, double precision, double precision,
  double precision, boolean, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_search_adhoc_listings(
  date, date,
  double precision, double precision, double precision, double precision,
  double precision, boolean, text
) TO authenticated;

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
  v_fee := CASE WHEN v_memb THEN 0 ELSE (ROUND(v_contrib * 0.10))::integer END;
  v_cash := v_contrib + v_fee;

  UPDATE public.ride_passengers
  SET
    expected_contribution_cents = v_contrib,
    network_fee_cents = v_fee,
    cash_to_charge_cents = v_cash,
    points_cost = v_contrib
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
      ELSE (ROUND(leg.contrib * 0.10))::integer
    END AS fee
  FROM leg
)
UPDATE public.ride_passengers rp
SET
  expected_contribution_cents = calc.contrib,
  network_fee_cents = calc.fee,
  cash_to_charge_cents = calc.contrib + calc.fee,
  points_cost = calc.contrib
FROM calc
WHERE rp.id = calc.rpid;
