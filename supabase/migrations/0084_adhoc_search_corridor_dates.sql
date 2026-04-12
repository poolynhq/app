-- Ad-hoc search: fix calendar-day overlap (AU local) and match rider destination along driver corridor, not only near driver's end city.

DROP FUNCTION IF EXISTS public.poolyn_search_adhoc_listings(
  timestamptz, timestamptz,
  double precision, double precision, double precision, double precision,
  double precision, boolean
);

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
          AND (
            (r.depart_at AT TIME ZONE v_tz)::date
              BETWEEN p_rider_date_from - COALESCE(r.adhoc_depart_flex_days, 0)
              AND p_rider_date_to + COALESCE(r.adhoc_depart_flex_days, 0)
          )
          AND ST_DWithin(
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
