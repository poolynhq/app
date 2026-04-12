-- Reliable My Rides: list driver trips and pending ad-hoc bookings via SECURITY DEFINER.
-- Client .from("rides") can return empty when RLS policies or column grants misbehave; RPC uses auth.uid() server-side.

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
              FROM public.ride_passengers rp
              WHERE rp.ride_id = r.id AND rp.status = 'confirmed'
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

CREATE OR REPLACE FUNCTION public.poolyn_list_pending_adhoc_bookings_for_driver()
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
            'id', b.id,
            'ride_id', b.ride_id,
            'passenger_id', b.passenger_id,
            'passenger_message', b.passenger_message,
            'needs_checked_bag', b.needs_checked_bag,
            'pickup_km_from_ride_origin', b.pickup_km_from_ride_origin,
            'created_at', b.created_at,
            'ride', json_build_object(
              'depart_at', r.depart_at,
              'adhoc_origin_label', r.adhoc_origin_label,
              'adhoc_destination_label', r.adhoc_destination_label
            ),
            'passenger', json_build_object(
              'full_name', pu.full_name,
              'avatar_url', pu.avatar_url
            )
          ) AS row_json
        FROM public.adhoc_seat_bookings b
        INNER JOIN public.rides r ON r.id = b.ride_id
        INNER JOIN public.users pu ON pu.id = b.passenger_id
        WHERE r.driver_id = v_uid
          AND r.poolyn_context = 'adhoc'
          AND b.status = 'pending'
        ORDER BY b.created_at DESC
      ) sub
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_list_pending_adhoc_bookings_for_driver() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_list_pending_adhoc_bookings_for_driver() TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_get_my_ride_as_driver(p_ride_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.rides;
BEGIN
  IF v_uid IS NULL OR p_ride_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id;
  IF v_r.id IS NULL OR v_r.driver_id <> v_uid THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'ride_id', v_r.id,
    'depart_at', v_r.depart_at,
    'status', v_r.status,
    'direction', v_r.direction,
    'origin', ST_AsGeoJSON(v_r.origin::geometry)::json,
    'destination', ST_AsGeoJSON(v_r.destination::geometry)::json,
    'poolyn_context', v_r.poolyn_context,
    'adhoc_origin_label', v_r.adhoc_origin_label,
    'adhoc_destination_label', v_r.adhoc_destination_label,
    'adhoc_trip_title', v_r.adhoc_trip_title,
    'adhoc_depart_flex_days', v_r.adhoc_depart_flex_days,
    'notes', v_r.notes,
    'seats_available', v_r.seats_available,
    'baggage_slots_available', v_r.baggage_slots_available,
    'confirmed_passengers', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'passenger_id', rp.passenger_id,
            'full_name', u.full_name
          )
          ORDER BY u.full_name
        )
        FROM public.ride_passengers rp
        INNER JOIN public.users u ON u.id = rp.passenger_id
        WHERE rp.ride_id = v_r.id AND rp.status = 'confirmed'
      ),
      '[]'::json
    ),
    'pending_seat_requests', (
      SELECT COUNT(*)::integer
      FROM public.adhoc_seat_bookings ab
      WHERE ab.ride_id = v_r.id AND ab.status = 'pending'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_get_my_ride_as_driver(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_get_my_ride_as_driver(uuid) TO authenticated;
