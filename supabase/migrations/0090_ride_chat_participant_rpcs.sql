-- Reliable ride chat for drivers and confirmed passengers: bypass fragile chained RLS on rides/messages/bookings.

CREATE OR REPLACE FUNCTION public.poolyn_get_ride_chat_meta(p_ride_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.rides;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_r FROM public.rides WHERE id = p_ride_id;
  IF v_r.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_r.driver_id IS DISTINCT FROM v_uid AND NOT EXISTS (
    SELECT 1
    FROM public.ride_passengers rp
    WHERE rp.ride_id = p_ride_id
      AND rp.passenger_id = v_uid
      AND rp.status = 'confirmed'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'ride_id', v_r.id,
    'poolyn_context', v_r.poolyn_context,
    'notes', v_r.notes,
    'driver_id', v_r.driver_id,
    'created_at', v_r.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_get_ride_chat_meta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_get_ride_chat_meta(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_fetch_ride_messages_for_participant(p_ride_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT driver_id INTO v_driver FROM public.rides WHERE id = p_ride_id;
  IF v_driver IS NULL THEN
    RETURN '[]'::json;
  END IF;

  IF v_driver IS DISTINCT FROM v_uid AND NOT EXISTS (
    SELECT 1
    FROM public.ride_passengers rp
    WHERE rp.ride_id = p_ride_id
      AND rp.passenger_id = v_uid
      AND rp.status = 'confirmed'
  ) THEN
    RETURN '[]'::json;
  END IF;

  RETURN COALESCE(
    (
      SELECT json_agg(row_json ORDER BY sent_sort)
      FROM (
        SELECT
          json_build_object(
            'id', m.id::text,
            'sender_id', m.sender_id,
            'body', m.body,
            'sent_at', m.sent_at
          ) AS row_json,
          m.sent_at AS sent_sort
        FROM public.messages m
        WHERE m.ride_id = p_ride_id
      ) ordered_rows
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_fetch_ride_messages_for_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_fetch_ride_messages_for_participant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_fetch_adhoc_bookings_for_chat(p_ride_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT driver_id INTO v_driver FROM public.rides WHERE id = p_ride_id;
  IF v_driver IS NULL THEN
    RETURN '[]'::json;
  END IF;

  IF v_driver IS DISTINCT FROM v_uid AND NOT EXISTS (
    SELECT 1
    FROM public.ride_passengers rp
    WHERE rp.ride_id = p_ride_id
      AND rp.passenger_id = v_uid
      AND rp.status = 'confirmed'
  ) THEN
    RETURN '[]'::json;
  END IF;

  RETURN COALESCE(
    (
      SELECT json_agg(row_json ORDER BY created_sort)
      FROM (
        SELECT
          json_build_object(
            'id', b.id,
            'passenger_id', b.passenger_id,
            'passenger_message', b.passenger_message,
            'driver_response_message', b.driver_response_message,
            'created_at', b.created_at,
            'responded_at', b.responded_at,
            'status', b.status
          ) AS row_json,
          b.created_at AS created_sort
        FROM public.adhoc_seat_bookings b
        WHERE b.ride_id = p_ride_id
          AND b.status = 'accepted'
          AND (v_driver = v_uid OR b.passenger_id = v_uid)
      ) ordered_rows
    ),
    '[]'::json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_fetch_adhoc_bookings_for_chat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_fetch_adhoc_bookings_for_chat(uuid) TO authenticated;
