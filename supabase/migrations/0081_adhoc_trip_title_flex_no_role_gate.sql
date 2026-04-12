-- Optional trip title, driver departure flex days, search date overlap (rider window x driver flex).
-- Posting no longer requires user.role in (driver, both); active vehicle with 2+ seats is enough.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS adhoc_trip_title text,
  ADD COLUMN IF NOT EXISTS adhoc_depart_flex_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_adhoc_depart_flex_days_check;
ALTER TABLE public.rides ADD CONSTRAINT rides_adhoc_depart_flex_days_check
  CHECK (adhoc_depart_flex_days >= 0 AND adhoc_depart_flex_days <= 2);

COMMENT ON COLUMN public.rides.adhoc_trip_title IS 'Optional label for ad-hoc listings (search only).';
COMMENT ON COLUMN public.rides.adhoc_depart_flex_days IS 'Driver: +/- whole days around depart_at date for matching search.';

DROP FUNCTION IF EXISTS public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer
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
  p_depart_flex_days integer DEFAULT 0
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
  v_flex := LEAST(2, GREATEST(0, COALESCE(p_depart_flex_days, 0)));

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
    NULLIF(left(trim(p_trip_title), 120), ''),
    v_flex,
    NULL
  )
  RETURNING id INTO v_ride_id;

  RETURN json_build_object('ok', true, 'ride_id', v_ride_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer, text, integer
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
  v_r0 date;
  v_r1 date;
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

  v_r0 := (p_window_start AT TIME ZONE 'UTC')::date;
  v_r1 := ((p_window_end - interval '1 microsecond') AT TIME ZONE 'UTC')::date;

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
              )::numeric, 1)
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
          AND ST_DWithin(r.origin, v_o, p_radius_km * 1000)
          AND ST_DWithin(r.destination, v_d, p_radius_km * 1000)
          AND (
            (timezone('UTC', r.depart_at)::date + COALESCE(r.adhoc_depart_flex_days, 0)) >= v_r0
            AND (timezone('UTC', r.depart_at)::date - COALESCE(r.adhoc_depart_flex_days, 0)) <= v_r1
          )
      ) sub
    ),
    '[]'::json
  );
END;
$$;
