-- Passenger upcoming RPC: include driver workplace and vehicle for My rides summary.

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
            END,
            'driver_organisation_name', NULLIF(trim(COALESCE(o.name, '')), ''),
            'vehicle_make', NULLIF(trim(COALESCE(v.make, '')), ''),
            'vehicle_model', NULLIF(trim(COALESCE(v.model, '')), ''),
            'vehicle_colour', NULLIF(trim(COALESCE(v.colour, '')), ''),
            'vehicle_plate', NULLIF(trim(COALESCE(v.plate, '')), '')
          ) AS row_json
        FROM public.ride_passengers rp
        INNER JOIN public.rides r ON r.id = rp.ride_id
        INNER JOIN public.users du ON du.id = r.driver_id
        LEFT JOIN public.organisations o ON o.id = du.org_id
        LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
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
