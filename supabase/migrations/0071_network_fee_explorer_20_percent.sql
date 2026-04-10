-- Explorer / independent passenger platform fee: 20% of cash trip share (was 18%).
-- Waived when is_user_org_member(passenger) (active org subscription). Keep in sync with
-- src/lib/poolynPricingConfig.ts POOLYN_EXPLORER_NETWORK_FEE_FRACTION.

CREATE OR REPLACE FUNCTION public.poolyn_passenger_network_fee_preview(
  p_total_contribution_cents integer
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
  v_fee integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_contrib := GREATEST(0, COALESCE(p_total_contribution_cents, 0));
  v_memb := public.is_user_org_member(v_uid);
  v_fee := CASE
    WHEN v_memb THEN 0
    ELSE ROUND(v_contrib * 0.20)::integer
  END;

  RETURN json_build_object(
    'total_contribution', v_contrib,
    'network_fee_cents', v_fee,
    'final_charge_cents', v_contrib + v_fee,
    'is_org_member', v_memb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.poolyn_commit_commute_passenger_pricing(
  p_ride_passenger_id uuid,
  p_reservation_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rr record;
  v_rp record;
  v_contrib integer;
  v_fee integer;
  v_cash integer;
  v_memb boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rr
  FROM public.ride_reservations rr
  WHERE rr.id = p_reservation_id;

  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'reservation not found';
  END IF;

  IF v_rr.passenger_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_rr.status NOT IN ('reserved', 'confirmed') THEN
    RAISE EXCEPTION 'reservation not committable';
  END IF;

  SELECT rp.* INTO v_rp
  FROM public.ride_passengers rp
  JOIN public.rides r ON r.id = rp.ride_id
  WHERE rp.id = p_ride_passenger_id
    AND rp.passenger_id = v_rr.passenger_id
    AND r.driver_id = v_rr.driver_id;

  IF v_rp.id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found for reservation';
  END IF;

  v_contrib := GREATEST(0, COALESCE(v_rr.passenger_cost_cents, 0));
  v_memb := public.is_user_org_member(v_rr.passenger_id);
  v_fee := CASE
    WHEN v_memb THEN 0
    ELSE ROUND(v_contrib * 0.20)::integer
  END;
  v_cash := v_contrib + v_fee;

  UPDATE public.ride_passengers
  SET
    expected_contribution_cents = v_contrib,
    network_fee_cents = v_fee,
    cash_to_charge_cents = v_cash,
    points_cost = v_contrib
  WHERE id = p_ride_passenger_id;

  RETURN json_build_object(
    'ok', true,
    'expected_contribution_cents', v_contrib,
    'network_fee_cents', v_fee,
    'cash_to_charge_cents', v_cash,
    'is_org_member', v_memb
  );
END;
$$;
