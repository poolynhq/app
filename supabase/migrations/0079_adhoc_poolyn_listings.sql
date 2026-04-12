-- Ad-hoc Poolyn: driver-posted dated trips, passenger seat search, booking requests (no contact fields in-app).

ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_poolyn_context_check;
ALTER TABLE public.rides ADD CONSTRAINT rides_poolyn_context_check
  CHECK (poolyn_context IN ('mingle', 'crew', 'adhoc'));

COMMENT ON COLUMN public.rides.poolyn_context IS
  'mingle | crew | adhoc (dated listing: post trip / search for a seat).';

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS adhoc_origin_label text,
  ADD COLUMN IF NOT EXISTS adhoc_destination_label text,
  ADD COLUMN IF NOT EXISTS baggage_slots_available integer NOT NULL DEFAULT 0;

ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_baggage_slots_available_check;
ALTER TABLE public.rides ADD CONSTRAINT rides_baggage_slots_available_check
  CHECK (baggage_slots_available >= 0);

CREATE TABLE IF NOT EXISTS public.adhoc_seat_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides (id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  passenger_message text,
  driver_response_message text,
  passenger_pickup geography (Point, 4326) NOT NULL,
  needs_checked_bag boolean NOT NULL DEFAULT false,
  pickup_km_from_ride_origin real,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS adhoc_seat_bookings_one_pending_per_ride_passenger
  ON public.adhoc_seat_bookings (ride_id, passenger_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS adhoc_seat_bookings_ride_idx ON public.adhoc_seat_bookings (ride_id);
CREATE INDEX IF NOT EXISTS adhoc_seat_bookings_passenger_idx ON public.adhoc_seat_bookings (passenger_id);

ALTER TABLE public.adhoc_seat_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adhoc_seat_bookings_select_parties"
  ON public.adhoc_seat_bookings FOR SELECT TO authenticated
  USING (
    passenger_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id AND r.driver_id = auth.uid()
    )
  );

COMMENT ON TABLE public.adhoc_seat_bookings IS
  'Passenger requests a seat on an ad-hoc listing; driver accepts or declines in-app (no phone/email here).';

-- Treat adhoc like mingle for explorer fee preview
CREATE OR REPLACE FUNCTION public.poolyn_passenger_network_fee_preview(
  p_total_contribution_cents integer,
  p_poolyn_context text DEFAULT 'mingle'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_contrib integer;
  v_memb boolean;
  v_ctx text;
  v_rate real;
  v_fee integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_contrib := GREATEST(0, COALESCE(p_total_contribution_cents, 0));
  v_memb := public.is_user_org_member(v_uid);
  v_ctx := lower(trim(COALESCE(p_poolyn_context, 'mingle')));
  IF v_ctx NOT IN ('mingle', 'crew', 'adhoc') THEN
    v_ctx := 'mingle';
  END IF;

  v_rate := CASE
    WHEN v_memb THEN 0::real
    WHEN v_ctx = 'crew' THEN 0.04::real
    ELSE 0.10::real
  END;

  v_fee := (ROUND(v_contrib * v_rate))::integer;

  RETURN json_build_object(
    'total_contribution', v_contrib,
    'network_fee_cents', v_fee,
    'final_charge_cents', v_contrib + v_fee,
    'is_org_member', v_memb,
    'poolyn_context', v_ctx
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.poolyn_create_adhoc_listing(
  p_depart_at timestamptz,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_origin_label text,
  p_dest_label text,
  p_passenger_seats_available integer,
  p_baggage_slots integer
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
  v_ride_id uuid;
  v_o geography;
  v_d geography;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_uid AND u.role IN ('driver', 'both')
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_driver');
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
  v_bag := GREATEST(COALESCE(p_baggage_slots, 0), 0);

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
    notes
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
    NULL
  )
  RETURNING id INTO v_ride_id;

  RETURN json_build_object('ok', true, 'ride_id', v_ride_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer
) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_search_adhoc_listings(
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_near_origin_lat double precision,
  p_near_origin_lng double precision,
  p_near_dest_lat double precision,
  p_near_dest_lng double precision,
  p_radius_km double precision DEFAULT 35,
  p_needs_baggage boolean DEFAULT false
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_array();
  END IF;

  SELECT org_id INTO v_org FROM public.users WHERE id = v_uid;
  IF v_org IS NULL THEN
    RETURN json_build_array();
  END IF;

  v_o := ST_SetSRID(ST_MakePoint(p_near_origin_lng, p_near_origin_lat), 4326)::geography;
  v_d := ST_SetSRID(ST_MakePoint(p_near_dest_lng, p_near_dest_lat), 4326)::geography;

  RETURN COALESCE(
    (
      SELECT json_agg(row_json ORDER BY depart_sort)
      FROM (
        SELECT
          r.depart_at AS depart_sort,
          json_build_object(
            'ride_id', r.id,
            'depart_at', r.depart_at,
            'adhoc_origin_label', r.adhoc_origin_label,
            'adhoc_destination_label', r.adhoc_destination_label,
            'seats_available', r.seats_available,
            'baggage_slots_available', r.baggage_slots_available,
            'driver_first_name', split_part(COALESCE(NULLIF(trim(u.full_name), ''), 'Driver'), ' ', 1),
            'vehicle_label', trim(COALESCE(v.make, '') || ' ' || COALESCE(v.model, '')),
            'vehicle_colour', v.colour,
            'driver_start_km_from_search_origin',
              ROUND((
                ST_Distance(r.origin, v_o)::double precision / 1000.0
              )::numeric, 1),
            'driver_end_km_from_search_dest',
              ROUND((
                ST_Distance(r.destination, v_d)::double precision / 1000.0
              )::numeric, 1)
          ) AS row_json
        FROM public.rides r
        JOIN public.users u ON u.id = r.driver_id
        JOIN public.vehicles v ON v.id = r.vehicle_id
        WHERE r.poolyn_context = 'adhoc'
          AND r.status = 'scheduled'
          AND r.driver_id <> v_uid
          AND u.org_id IS NOT DISTINCT FROM v_org
          AND r.depart_at >= p_window_start
          AND r.depart_at < p_window_end
          AND (NOT p_needs_baggage OR r.baggage_slots_available > 0)
          AND ST_DWithin(r.origin, v_o, p_radius_km * 1000)
          AND ST_DWithin(r.destination, v_d, p_radius_km * 1000)
      ) sub
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_search_adhoc_listings(
  timestamptz, timestamptz,
  double precision, double precision, double precision, double precision,
  double precision, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_search_adhoc_listings(
  timestamptz, timestamptz,
  double precision, double precision, double precision, double precision,
  double precision, boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_request_adhoc_seat(
  p_ride_id uuid,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_message text,
  p_needs_baggage boolean
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
  v_km real;
  v_id uuid;
  v_msg text;
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

  INSERT INTO public.adhoc_seat_bookings (
    ride_id,
    passenger_id,
    status,
    passenger_message,
    passenger_pickup,
    needs_checked_bag,
    pickup_km_from_ride_origin
  )
  VALUES (
    p_ride_id,
    v_uid,
    'pending',
    v_msg,
    v_pickup,
    COALESCE(p_needs_baggage, false),
    v_km
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
  uuid, double precision, double precision, text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_request_adhoc_seat(
  uuid, double precision, double precision, text, boolean
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
