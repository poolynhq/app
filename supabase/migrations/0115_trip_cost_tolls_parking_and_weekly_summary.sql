-- Trip-level tolls & parking (driver-entered), per-rider share breakdown, weekly travel-cost summary.
-- Stripe Connect: unchanged PI flow; payment_captured_at for driver "this week" totals.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS adhoc_toll_cents integer NOT NULL DEFAULT 0
    CHECK (adhoc_toll_cents >= 0 AND adhoc_toll_cents <= 5000000),
  ADD COLUMN IF NOT EXISTS adhoc_parking_cents integer NOT NULL DEFAULT 0
    CHECK (adhoc_parking_cents >= 0 AND adhoc_parking_cents <= 5000000);

COMMENT ON COLUMN public.rides.adhoc_toll_cents IS
  'Total tolls for this trip (cents), shared across confirmed riders (see ride_passengers.trip_cost_share_breakdown).';
COMMENT ON COLUMN public.rides.adhoc_parking_cents IS
  'Total parking for this trip (cents), shared across confirmed riders.';

ALTER TABLE public.ride_passengers
  ADD COLUMN IF NOT EXISTS trip_cost_share_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_captured_at timestamptz;

COMMENT ON COLUMN public.ride_passengers.trip_cost_share_breakdown IS
  'UI + pricing: keys distance_cents, detour_cents, pickup_cents, tolls_cents, parking_cents (integers).';
COMMENT ON COLUMN public.ride_passengers.payment_captured_at IS
  'When payment_status became paid (Stripe succeeded or zero-amount path).';

-- ---------------------------------------------------------------------------
-- Mark paid: record capture time
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_mark_ride_passenger_payment_paid(
  p_ride_passenger_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (
    (SELECT auth.role()) = 'service_role'
    OR public.is_platform_super_admin()
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ride_passengers
  SET
    payment_status = 'paid',
    stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
    payment_captured_at = COALESCE(payment_captured_at, now())
  WHERE id = p_ride_passenger_id
    AND payment_status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_n > 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- Recompute ad-hoc per-rider shares (toll + parking proportional to distance leg
-- among payment-pending riders; paid rows unchanged; remainder to last pending).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_recompute_adhoc_ride_passenger_shares(p_ride_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_r public.rides;
  v_toll_total integer;
  v_park_total integer;
  v_tol_paid integer;
  v_park_paid integer;
BEGIN
  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id;
  IF NOT FOUND OR v_r.poolyn_context IS DISTINCT FROM 'adhoc' THEN
    RETURN;
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.rides r2 WHERE r2.id = p_ride_id AND r2.driver_id = auth.uid()) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_toll_total := GREATEST(0, COALESCE(v_r.adhoc_toll_cents, 0));
  v_park_total := GREATEST(0, COALESCE(v_r.adhoc_parking_cents, 0));

  SELECT
    COALESCE(SUM(
      CASE WHEN rp.payment_status = 'paid' THEN
        GREATEST(0, COALESCE((rp.trip_cost_share_breakdown->>'tolls_cents')::integer, 0))
      ELSE 0 END
    ), 0),
    COALESCE(SUM(
      CASE WHEN rp.payment_status = 'paid' THEN
        GREATEST(0, COALESCE((rp.trip_cost_share_breakdown->>'parking_cents')::integer, 0))
      ELSE 0 END
    ), 0)
  INTO v_tol_paid, v_park_paid
  FROM public.ride_passengers rp
  WHERE rp.ride_id = p_ride_id AND rp.status = 'confirmed';

  UPDATE public.ride_passengers rp
  SET
    expected_contribution_cents = x.gross_cents,
    network_fee_cents = x.network_fee_cents,
    cash_to_charge_cents = x.gross_cents + x.network_fee_cents,
    points_cost = x.gross_cents,
    fee_product_type = x.fee_product_type,
    trip_cost_share_breakdown = x.breakdown
  FROM (
    WITH legs AS (
      SELECT
        rp2.id AS rpid,
        rp2.passenger_id,
        rp2.payment_status,
        GREATEST(
          300,
          LEAST(
            2500000,
            ROUND(
              (
                ST_Distance(
                  rp2.pickup_point,
                  COALESCE(b.passenger_search_dest, r.destination)
                ) / 1000.0
              ) * 18.0
            )::integer
          )
        ) AS leg_cents
      FROM public.ride_passengers rp2
      INNER JOIN public.rides r ON r.id = rp2.ride_id
      LEFT JOIN public.adhoc_seat_bookings b
        ON b.ride_id = rp2.ride_id
       AND b.passenger_id = rp2.passenger_id
       AND b.status = 'accepted'
      WHERE rp2.ride_id = p_ride_id
        AND rp2.status = 'confirmed'
    ),
    pend AS (
      SELECT * FROM legs WHERE payment_status = 'pending'
    ),
    pend_meta AS (
      SELECT
        COUNT(*)::integer AS pend_n,
        COALESCE(SUM(leg_cents), 0)::integer AS pend_s
      FROM pend
    ),
    toll_rem AS (
      SELECT GREATEST(0, v_toll_total - v_tol_paid)::integer AS t
    ),
    park_rem AS (
      SELECT GREATEST(0, v_park_total - v_park_paid)::integer AS p
    ),
    pend_ranked AS (
      SELECT
        p.*,
        ROW_NUMBER() OVER (ORDER BY p.rpid) AS prn,
        (SELECT pend_n FROM pend_meta) AS pend_n,
        (SELECT pend_s FROM pend_meta) AS pend_s
      FROM pend p
    ),
    floors AS (
      SELECT
        pr.rpid,
        pr.passenger_id,
        pr.leg_cents,
        pr.prn,
        pr.pend_n,
        pr.pend_s,
        CASE
          WHEN pr.pend_s > 0 THEN
            FLOOR((SELECT t FROM toll_rem)::numeric * pr.leg_cents / pr.pend_s)::integer
          ELSE 0
        END AS toll_floor,
        CASE
          WHEN pr.pend_s > 0 THEN
            FLOOR((SELECT p FROM park_rem)::numeric * pr.leg_cents / pr.pend_s)::integer
          ELSE 0
        END AS park_floor
      FROM pend_ranked pr
    ),
    floors2 AS (
      SELECT
        f.*,
        SUM(f.toll_floor) OVER () AS toll_sum_f,
        SUM(f.park_floor) OVER () AS park_sum_f
      FROM floors f
    ),
    alloc_pend AS (
      SELECT
        f2.rpid,
        f2.passenger_id,
        f2.leg_cents,
        f2.toll_floor
          + CASE
              WHEN f2.pend_n > 0 AND f2.prn = f2.pend_n THEN
                GREATEST(0, (SELECT t FROM toll_rem) - f2.toll_sum_f)
              ELSE 0
            END AS toll_share,
        f2.park_floor
          + CASE
              WHEN f2.pend_n > 0 AND f2.prn = f2.pend_n THEN
                GREATEST(0, (SELECT p FROM park_rem) - f2.park_sum_f)
              ELSE 0
            END AS park_share
      FROM floors2 f2
    ),
    gross AS (
      SELECT
        a.rpid,
        a.passenger_id,
        a.leg_cents,
        a.toll_share,
        a.park_share,
        (a.leg_cents + a.toll_share + a.park_share) AS gross_cents
      FROM alloc_pend a
    ),
    fee AS (
      SELECT
        g.*,
        CASE
          WHEN public.is_user_org_member(g.passenger_id) THEN 0
          ELSE (ROUND(g.gross_cents * 0.15))::integer
        END AS network_fee_cents,
        CASE
          WHEN public.is_user_org_member(g.passenger_id) THEN 'organization_member'::text
          ELSE 'solo_driver'::text
        END AS fee_product_type
      FROM gross g
    )
    SELECT
      f.rpid,
      f.gross_cents,
      f.network_fee_cents,
      f.fee_product_type,
      jsonb_build_object(
        'distance_cents', f.leg_cents,
        'detour_cents', 0,
        'pickup_cents', 0,
        'tolls_cents', f.toll_share,
        'parking_cents', f.park_share
      ) AS breakdown
    FROM fee f
  ) x
  WHERE rp.id = x.rpid;
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_recompute_adhoc_ride_passenger_shares(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_recompute_adhoc_ride_passenger_shares(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Ad-hoc seat accept: insert passenger then recompute all pending shares
-- ---------------------------------------------------------------------------
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

  PERFORM public.poolyn_recompute_adhoc_ride_passenger_shares(v_r.id);

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

-- ---------------------------------------------------------------------------
-- Create listing: optional toll + parking (cents)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.poolyn_create_adhoc_listing(
  timestamptz,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  text,
  integer,
  integer,
  text,
  integer,
  text
);

CREATE OR REPLACE FUNCTION public.poolyn_create_adhoc_listing(
  p_depart_at timestamptz,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_origin_label text,
  p_dest_label text,
  p_passenger_seats_available integer,
  p_baggage_slots integer,
  p_trip_title text DEFAULT NULL,
  p_depart_flex_days integer DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_toll_cents integer DEFAULT NULL,
  p_parking_cents integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_veh record;
  v_seats integer;
  v_bag integer;
  v_flex integer;
  v_ride_id uuid;
  v_o geography;
  v_d geography;
  v_notes text;
  v_toll integer;
  v_park integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_depart_at IS NULL OR p_depart_at < (now() - interval '5 minutes') THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_depart_time');
  END IF;

  SELECT org_id INTO v_org FROM public.users WHERE id = v_uid;
  IF v_org IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_org');
  END IF;

  IF NOT public.user_trip_payouts_ready(v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'payouts_not_ready');
  END IF;

  SELECT id, seats INTO v_veh
  FROM public.vehicles
  WHERE user_id = v_uid AND active = true AND seats > 1
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_veh.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_vehicle');
  END IF;

  v_seats := LEAST(GREATEST(COALESCE(p_passenger_seats_available, 1), 1), GREATEST(v_veh.seats - 1, 1));
  v_bag := GREATEST(0, COALESCE(p_baggage_slots, 0));
  v_flex := LEAST(2, GREATEST(0, COALESCE(p_depart_flex_days, 0)));
  v_notes := left(trim(COALESCE(p_notes, '')), 500);
  v_toll := LEAST(5000000, GREATEST(0, COALESCE(p_toll_cents, 0)));
  v_park := LEAST(5000000, GREATEST(0, COALESCE(p_parking_cents, 0)));

  v_o := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326)::geography;
  v_d := ST_SetSRID(ST_MakePoint(p_dest_lng, p_dest_lat), 4326)::geography;

  INSERT INTO public.rides (
    driver_id,
    vehicle_id,
    depart_at,
    status,
    ride_type,
    direction,
    poolyn_context,
    origin,
    destination,
    seats_available,
    baggage_slots_available,
    adhoc_origin_label,
    adhoc_destination_label,
    adhoc_trip_title,
    adhoc_depart_flex_days,
    notes,
    adhoc_toll_cents,
    adhoc_parking_cents
  )
  VALUES (
    v_uid,
    v_veh.id,
    p_depart_at,
    'scheduled',
    'adhoc',
    'custom',
    'adhoc',
    v_o,
    v_d,
    v_seats,
    v_bag,
    NULLIF(trim(p_origin_label), ''),
    NULLIF(trim(p_dest_label), ''),
    NULLIF(left(trim(COALESCE(p_trip_title, '')), 120), ''),
    v_flex,
    NULLIF(v_notes, ''),
    v_toll,
    v_park
  )
  RETURNING id INTO v_ride_id;

  RETURN json_build_object('ok', true, 'ride_id', v_ride_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer, text, integer, text, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer, text, integer, text, integer, integer
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Search listings: add toll+park into preview (equal per offered seat)
-- ---------------------------------------------------------------------------
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
            'estimated_contribution_cents_preview',
              v_preview + ROUND(
                (COALESCE(r.adhoc_toll_cents, 0) + COALESCE(r.adhoc_parking_cents, 0))::numeric
                / GREATEST(1, COALESCE(r.seats_available, 1) + COALESCE((
                  SELECT COUNT(*)::integer FROM public.ride_passengers rp2
                  WHERE rp2.ride_id = r.id AND rp2.status = 'confirmed'
                ), 0))
              )::integer
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

-- ---------------------------------------------------------------------------
-- Pricing quote: rider breakdown (no driver-side labels)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_ride_passenger_pricing_quote(p_ride_passenger_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rp record;
  v_r record;
  v_org uuid;
  v_fee_label text;
  v_b jsonb;
  v_gross integer;
  v_dist integer;
  v_det integer;
  v_pick integer;
  v_tol integer;
  v_par integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT rp.* INTO v_rp
  FROM public.ride_passengers rp
  WHERE rp.id = p_ride_passenger_id;

  IF v_rp.id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_rp.passenger_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_r FROM public.rides r WHERE r.id = v_rp.ride_id;

  IF (
    COALESCE(v_rp.expected_contribution_cents, 0) + COALESCE(v_rp.network_fee_cents, 0)
  ) > 0
     AND NOT public.user_trip_payouts_ready(v_r.driver_id) THEN
    RAISE EXCEPTION 'driver_payouts_not_ready' USING ERRCODE = 'P0001';
  END IF;

  SELECT org_id INTO v_org FROM public.users u WHERE u.id = v_rp.passenger_id;

  v_fee_label := CASE COALESCE(v_rp.fee_product_type, '')
    WHEN 'organization_member' THEN 'none'
    WHEN 'group_trip' THEN 'coordination fee'
    WHEN 'solo_driver' THEN 'network fee'
    ELSE 'platform fee'
  END;

  v_b := COALESCE(v_rp.trip_cost_share_breakdown, '{}'::jsonb);
  v_gross := GREATEST(0, COALESCE(v_rp.expected_contribution_cents, 0));
  v_dist := GREATEST(0, COALESCE((v_b->>'distance_cents')::integer, v_gross));
  v_det := GREATEST(0, COALESCE((v_b->>'detour_cents')::integer, 0));
  v_pick := GREATEST(0, COALESCE((v_b->>'pickup_cents')::integer, 0));
  v_tol := GREATEST(0, COALESCE((v_b->>'tolls_cents')::integer, 0));
  v_par := GREATEST(0, COALESCE((v_b->>'parking_cents')::integer, 0));

  IF v_b = '{}'::jsonb OR v_b IS NULL THEN
    v_dist := v_gross;
    v_det := 0;
    v_pick := 0;
    v_tol := 0;
    v_par := 0;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'ride_id', v_r.id,
    'ride_passenger_id', v_rp.id,
    'poolyn_context', COALESCE(v_r.poolyn_context, 'mingle'),
    'gross_trip_amount_cents', v_gross,
    'platform_fee_cents', COALESCE(v_rp.network_fee_cents, 0),
    'total_payable_cents', COALESCE(v_rp.cash_to_charge_cents, 0),
    'fee_product_type', v_rp.fee_product_type,
    'platform_fee_label', v_fee_label,
    'driver_user_id', v_r.driver_id,
    'rider_user_id', v_rp.passenger_id,
    'organization_id', v_org,
    'distance_share_cents', v_dist,
    'detour_share_cents', v_det,
    'pickup_share_cents', v_pick,
    'tolls_share_cents', v_tol,
    'parking_share_cents', v_par
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_ride_passenger_pricing_quote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_ride_passenger_pricing_quote(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Driver: sum of travel-cost shares (driver portion) captured this local week
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_driver_this_week_travel_cost_cents()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_sum bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_start := date_trunc('week', now());

  SELECT COALESCE(SUM(rp.expected_contribution_cents::bigint), 0) INTO v_sum
  FROM public.ride_passengers rp
  INNER JOIN public.rides r ON r.id = rp.ride_id
  WHERE r.driver_id = v_uid
    AND rp.payment_status = 'paid'
    AND COALESCE(rp.payment_captured_at, rp.created_at) >= v_start
    AND COALESCE(rp.payment_captured_at, rp.created_at) < v_start + interval '7 days';

  RETURN json_build_object('ok', true, 'cents', v_sum);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_driver_this_week_travel_cost_cents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_driver_this_week_travel_cost_cents() TO authenticated;

-- Backfill capture time for existing paid legs (weekly summary; ride_passengers has no updated_at)
UPDATE public.ride_passengers
SET payment_captured_at = created_at
WHERE payment_status = 'paid'
  AND payment_captured_at IS NULL;
