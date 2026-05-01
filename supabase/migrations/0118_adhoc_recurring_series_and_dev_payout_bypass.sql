-- ---------------------------------------------------------------
-- Adhoc recurring series: group dated outings from one recurring post.
-- Dev bypass: optional flag on singleton settings (enable only on dev DB).
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.poolyn_dev_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  allow_adhoc_without_stripe_payout boolean NOT NULL DEFAULT false
);

INSERT INTO public.poolyn_dev_settings (id, allow_adhoc_without_stripe_payout)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.poolyn_dev_settings IS
  'Singleton flags for development only. Set allow_adhoc_without_stripe_payout true only on trusted dev Supabase projects.';

ALTER TABLE public.poolyn_dev_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY poolyn_dev_settings_no_client_writes
  ON public.poolyn_dev_settings FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.adhoc_recurring_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  recurrence_pattern text NOT NULL CHECK (
    recurrence_pattern IN ('weekly', 'fortnightly', 'monthly')
  ),
  anchor_date date NOT NULL,
  repeat_until_date date NOT NULL,
  is_round_trip boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adhoc_recurring_series_dates_ok CHECK (repeat_until_date >= anchor_date)
);

CREATE INDEX IF NOT EXISTS idx_adhoc_recurring_series_driver
  ON public.adhoc_recurring_series (driver_id);

COMMENT ON TABLE public.adhoc_recurring_series IS
  'Groups dated adhoc rides posted as one recurring driver action (batch editing and messaging may key off this later).';

ALTER TABLE public.adhoc_recurring_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY adhoc_recurring_series_driver_select
  ON public.adhoc_recurring_series FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS adhoc_recurring_series_id uuid REFERENCES public.adhoc_recurring_series (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rides_adhoc_recurring_series
  ON public.rides (adhoc_recurring_series_id)
  WHERE adhoc_recurring_series_id IS NOT NULL;

-- ----------------------
-- poolyn_create_adhoc_recurring_series
-- ----------------------

CREATE OR REPLACE FUNCTION public.poolyn_create_adhoc_recurring_series(
  p_recurrence_pattern text,
  p_anchor_date date,
  p_repeat_until_date date,
  p_is_round_trip boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_anchor_date IS NULL OR p_repeat_until_date IS NULL OR p_repeat_until_date < p_anchor_date THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_dates');
  END IF;

  IF p_recurrence_pattern IS NULL OR p_recurrence_pattern NOT IN ('weekly', 'fortnightly', 'monthly') THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_pattern');
  END IF;

  INSERT INTO public.adhoc_recurring_series (
    driver_id,
    recurrence_pattern,
    anchor_date,
    repeat_until_date,
    is_round_trip
  )
  VALUES (
    v_uid,
    p_recurrence_pattern,
    p_anchor_date,
    p_repeat_until_date,
    COALESCE(p_is_round_trip, false)
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'series_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_create_adhoc_recurring_series(text, date, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_create_adhoc_recurring_series(text, date, date, boolean) TO authenticated;

-- ----------------------
-- poolyn_create_adhoc_listing (optional series id + payout bypass via poolyn_dev_settings)
-- ----------------------

DROP FUNCTION IF EXISTS public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision,
  text, text, integer, integer, text, integer, text, integer, integer
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
  p_parking_cents integer DEFAULT NULL,
  p_adhoc_recurring_series_id uuid DEFAULT NULL
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
  v_series_driver uuid;
  v_bypass_payout boolean;
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

  SELECT COALESCE(allow_adhoc_without_stripe_payout, false)
  INTO v_bypass_payout
  FROM public.poolyn_dev_settings
  WHERE id = 1;

  IF NOT public.user_trip_payouts_ready(v_uid) THEN
    IF COALESCE(v_bypass_payout, false) IS NOT TRUE THEN
      RETURN json_build_object('ok', false, 'reason', 'payouts_not_ready');
    END IF;
  END IF;

  IF p_adhoc_recurring_series_id IS NOT NULL THEN
    SELECT driver_id INTO v_series_driver
    FROM public.adhoc_recurring_series
    WHERE id = p_adhoc_recurring_series_id;

    IF v_series_driver IS NULL THEN
      RETURN json_build_object('ok', false, 'reason', 'bad_series');
    END IF;

    IF v_series_driver IS DISTINCT FROM v_uid THEN
      RETURN json_build_object('ok', false, 'reason', 'series_not_owned');
    END IF;
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
    adhoc_parking_cents,
    adhoc_recurring_series_id
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
    v_park,
    p_adhoc_recurring_series_id
  )
  RETURNING id INTO v_ride_id;

  RETURN json_build_object('ok', true, 'ride_id', v_ride_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision,
  text, text, integer, integer, text, integer, text, integer, integer, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision,
  text, text, integer, integer, text, integer, text, integer, integer, uuid
) TO authenticated;

-- Client env EXPO_PUBLIC_POOLYN_BYPASS_PAYOUT_REQUIREMENT hides the Stripe banner only.
-- To let poolyn_create_adhoc_listing succeed without Connect onboarding on a dev database, run once:
-- UPDATE public.poolyn_dev_settings SET allow_adhoc_without_stripe_payout = true WHERE id = 1;
