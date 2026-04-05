-- Pending pickup expiry (countdown + auto-cancel) + Realtime on matching tables so passenger UI updates without manual refresh.

ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.ride_requests
SET expires_at = created_at + interval '10 minutes'
WHERE expires_at IS NULL;

ALTER TABLE public.ride_requests
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '10 minutes');

CREATE OR REPLACE FUNCTION public.create_commute_ride_request(
  p_direction text DEFAULT 'to_work',
  p_leave_in_mins integer DEFAULT NULL,
  p_desired_depart_at timestamptz DEFAULT NULL,
  p_flexibility_mins integer DEFAULT 15,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  u_home geography;
  u_work geography;
  _origin geography;
  _dest geography;
  _id uuid;
  _depart timestamptz;
  _flex integer;
  _expires timestamptz;
  _immediate boolean;
BEGIN
  IF _uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ride_requests
    WHERE passenger_id = _uid AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'already_has_pending_request');
  END IF;

  IF p_direction NOT IN ('to_work', 'from_work', 'custom') THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_direction');
  END IF;

  SELECT home_location, work_location INTO u_home, u_work
  FROM public.users WHERE id = _uid;

  IF u_home IS NULL OR u_work IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'commute_not_set');
  END IF;

  IF p_direction = 'to_work' THEN
    _origin := u_home;
    _dest := u_work;
  ELSIF p_direction = 'from_work' THEN
    _origin := u_work;
    _dest := u_home;
  ELSE
    _origin := u_home;
    _dest := u_work;
  END IF;

  IF p_desired_depart_at IS NOT NULL THEN
    _depart := p_desired_depart_at;
    _flex := GREATEST(COALESCE(p_flexibility_mins, 15), 5);
  ELSIF p_leave_in_mins IS NULL THEN
    _depart := now();
    _flex := GREATEST(COALESCE(p_flexibility_mins, 10), 5);
  ELSE
    _depart := now() + make_interval(mins => GREATEST(p_leave_in_mins, 1));
    _flex := GREATEST(COALESCE(p_flexibility_mins, 15), 5);
  END IF;

  _immediate := p_leave_in_mins IS NULL AND p_desired_depart_at IS NULL;

  IF _immediate THEN
    _expires := now() + interval '8 minutes';
  ELSE
    _expires := LEAST(now() + interval '30 minutes', _depart - interval '2 minutes');
    IF _expires < now() + interval '3 minutes' THEN
      _expires := now() + interval '3 minutes';
    END IF;
  END IF;

  INSERT INTO public.ride_requests (
    passenger_id,
    origin,
    destination,
    direction,
    desired_depart_at,
    flexibility_mins,
    status,
    notes,
    expires_at
  )
  VALUES (
    _uid,
    _origin,
    _dest,
    p_direction,
    _depart,
    _flex,
    'pending',
    NULLIF(trim(p_notes), ''),
    _expires
  )
  RETURNING id INTO _id;

  RETURN json_build_object('ok', true, 'ride_request_id', _id);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_pending_ride_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH expired AS (
    UPDATE public.ride_requests
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < now()
    RETURNING id, passenger_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    passenger_id,
    'ride_request_expired',
    'Pickup request timed out',
    'No driver matched in time. Post again when you are ready.',
    jsonb_build_object('ride_request_id', id)
  FROM expired;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_pending_ride_requests() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_pending_ride_requests() TO authenticated;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ride_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ride_passengers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_passengers;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  END IF;
END
$do$;
