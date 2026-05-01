-- Trip marketplace: payout readiness (Connect + onboarding) before receiving card funds.
-- Sync Express onboarding completion from Stripe account.updated webhooks.

-- ---------------------------------------------------------------------------
-- 1) Reusable: user can receive destination transfers for paid trips
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_trip_payouts_ready(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        NULLIF(trim(u.stripe_connect_account_id), '') IS NOT NULL
        AND COALESCE(u.stripe_connect_onboarding_complete, false) = true
      FROM public.users u
      WHERE u.id = p_user_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.user_trip_payouts_ready(uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.user_trip_payouts_ready(uuid) IS
  'True when the user has a Stripe Connect account id and onboarding is marked complete (webhook-driven).';

-- ---------------------------------------------------------------------------
-- 2) Dated workplace listings: host must be payout-ready (card settlements)
-- ---------------------------------------------------------------------------
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
  p_notes text DEFAULT NULL
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
  v_bag := GREATEST(COALESCE(p_baggage_slots, 0), 0);
  v_flex := LEAST(2, GREATEST(0, COALESCE(p_depart_flex_days, 0)));
  v_notes := left(trim(COALESCE(p_notes, '')), 500);

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
    NULLIF(v_notes, '')
  )
  RETURNING id INTO v_ride_id;

  RETURN json_build_object('ok', true, 'ride_id', v_ride_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer, text, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_create_adhoc_listing(
  timestamptz, double precision, double precision, double precision, double precision, text, text, integer, integer, text, integer, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Pricing quote: block paid flows when driver cannot receive transfers
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

  RETURN json_build_object(
    'ok', true,
    'ride_id', v_r.id,
    'ride_passenger_id', v_rp.id,
    'poolyn_context', COALESCE(v_r.poolyn_context, 'mingle'),
    'gross_trip_amount_cents', COALESCE(v_rp.expected_contribution_cents, 0),
    'platform_fee_cents', COALESCE(v_rp.network_fee_cents, 0),
    'total_payable_cents', COALESCE(v_rp.cash_to_charge_cents, 0),
    'fee_product_type', v_rp.fee_product_type,
    'platform_fee_label', v_fee_label,
    'driver_user_id', v_r.driver_id,
    'rider_user_id', v_rp.passenger_id,
    'organization_id', v_org,
    'net_payout_estimate_cents', GREATEST(0, COALESCE(v_rp.expected_contribution_cents, 0))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_ride_passenger_pricing_quote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_ride_passenger_pricing_quote(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Prepare payment: if any card amount remains, driver must be payout-ready
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_prepare_ride_passenger_for_payment(
  p_ride_passenger_id uuid,
  p_skip_commute_credits boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rp record;
  v_bal integer;
  v_use integer;
  v_cash integer;
  v_ded json;
  v_driver_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rp
  FROM public.ride_passengers
  WHERE id = p_ride_passenger_id;

  IF v_rp.id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_rp.passenger_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_rp.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'ride_passenger_not_pending';
  END IF;

  SELECT r.driver_id INTO v_driver_id FROM public.rides r WHERE r.id = v_rp.ride_id;

  IF v_rp.payment_status <> 'pending' THEN
    SELECT cash_to_charge_cents INTO v_cash
    FROM public.ride_passengers WHERE id = p_ride_passenger_id;
    IF COALESCE(v_cash, 0) > 0 AND NOT public.user_trip_payouts_ready(v_driver_id) THEN
      RAISE EXCEPTION 'driver_payouts_not_ready' USING ERRCODE = 'P0001';
    END IF;
    RETURN json_build_object(
      'ok', true,
      'cash_to_charge_cents', COALESCE(v_cash, 0),
      'already_prepared', true
    );
  END IF;

  IF p_skip_commute_credits THEN
    UPDATE public.ride_passengers
    SET cash_to_charge_cents =
      GREATEST(0, COALESCE(expected_contribution_cents, 0))
      + GREATEST(0, COALESCE(network_fee_cents, 0))
    WHERE id = p_ride_passenger_id
      AND payment_status = 'pending';
  ELSE
    SELECT commute_credits_balance INTO v_bal
    FROM public.users WHERE id = v_uid;

    v_use := LEAST(COALESCE(v_bal, 0), GREATEST(0, COALESCE(v_rp.expected_contribution_cents, 0)));

    SELECT public.poolyn_deduct_commute_credits_for_ride(p_ride_passenger_id, v_use) INTO v_ded;
  END IF;

  SELECT cash_to_charge_cents INTO v_cash
  FROM public.ride_passengers WHERE id = p_ride_passenger_id;

  IF COALESCE(v_cash, 0) > 0 AND NOT public.user_trip_payouts_ready(v_driver_id) THEN
    RAISE EXCEPTION 'driver_payouts_not_ready' USING ERRCODE = 'P0001';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'cash_to_charge_cents', COALESCE(v_cash, 0),
    'credits_applied_cents', CASE WHEN p_skip_commute_credits THEN 0 ELSE v_use END,
    'deduct_result', CASE WHEN p_skip_commute_credits THEN NULL ELSE v_ded END,
    'skip_commute_credits', p_skip_commute_credits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_prepare_ride_passenger_for_payment(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_prepare_ride_passenger_for_payment(uuid, boolean) TO authenticated;
