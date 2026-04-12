-- My Rides: expose per-passenger expected_contribution_cents and driver per-rider shares.
-- Notify passengers when their share is recalculated after initial pricing (e.g. another rider joins).

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
            'expected_contribution_cents', COALESCE(rp.expected_contribution_cents, 0),
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

CREATE OR REPLACE FUNCTION public.poolyn_list_my_upcoming_driver_rides()
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
            'poolyn_context', r.poolyn_context,
            'adhoc_origin_label', r.adhoc_origin_label,
            'adhoc_destination_label', r.adhoc_destination_label,
            'adhoc_trip_title', r.adhoc_trip_title,
            'notes', r.notes,
            'seats_available', r.seats_available,
            'confirmed_passenger_count', (
              SELECT COUNT(*)::integer
              FROM public.ride_passengers rp2
              WHERE rp2.ride_id = r.id AND rp2.status = 'confirmed'
            ),
            'passenger_contributions', COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'passenger_id', rp3.passenger_id,
                    'full_name', pu.full_name,
                    'expected_contribution_cents', COALESCE(rp3.expected_contribution_cents, 0)
                  )
                  ORDER BY pu.full_name NULLS LAST, rp3.passenger_id
                )
                FROM public.ride_passengers rp3
                INNER JOIN public.users pu ON pu.id = rp3.passenger_id
                WHERE rp3.ride_id = r.id AND rp3.status = 'confirmed'
              ),
              '[]'::json
            )
          ) AS row_json
        FROM public.rides r
        WHERE r.driver_id = v_uid
          AND r.status IN ('scheduled', 'active')
        ORDER BY r.depart_at ASC
      ) ordered_rows
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_list_my_upcoming_driver_rides() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_list_my_upcoming_driver_rides() TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_notify_passenger_ride_contribution_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;
  IF NEW.expected_contribution_cents IS NOT DISTINCT FROM OLD.expected_contribution_cents THEN
    RETURN NEW;
  END IF;
  -- Skip first-time pricing (0 -> X); "seat confirmed" and My rides already cover that.
  IF COALESCE(OLD.expected_contribution_cents, 0) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.passenger_id,
    'ride_contribution_updated',
    'Ride payment estimate updated',
    'Your trip share was recalculated. This often happens when another rider joins. Open My rides for details.',
    jsonb_build_object('ride_id', NEW.ride_id::text)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_passenger_contribution_notify ON public.ride_passengers;

CREATE TRIGGER ride_passenger_contribution_notify
  AFTER UPDATE OF expected_contribution_cents ON public.ride_passengers
  FOR EACH ROW
  EXECUTE FUNCTION public.poolyn_notify_passenger_ride_contribution_updated();
