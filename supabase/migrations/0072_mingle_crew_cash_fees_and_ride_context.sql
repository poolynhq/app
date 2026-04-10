-- Mingle vs Crew cash fees on trip share (explorers only; org members: 0 via is_user_org_member).
-- Mingle: 10% on contribution. Crew: 4% per rider (lower individually; sums across riders).
-- Driver Poolyn Credits = expected_contribution_cents (unchanged trigger poolyn_try_issue_driver_commute_credits).
-- Client: poolynPricingConfig POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION, POOLYN_CREW_EXPLORER_ADMIN_FEE_FRACTION.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS poolyn_context text NOT NULL DEFAULT 'mingle'
  CHECK (poolyn_context IN ('mingle', 'crew'));

COMMENT ON COLUMN public.rides.poolyn_context IS
  'poolyn_commit_commute_passenger_pricing uses this to pick explorer cash fee rate (mingle vs crew).';

COMMENT ON COLUMN public.ride_passengers.network_fee_cents IS
  'Explorer cash surcharge on trip share (Mingle service fee or Crew admin fee). 0 for active workplace members. Not paid with Poolyn Credits.';

DROP FUNCTION IF EXISTS public.poolyn_passenger_network_fee_preview(integer);

CREATE OR REPLACE FUNCTION public.poolyn_passenger_network_fee_preview(
  p_total_contribution_cents integer,
  p_poolyn_context text DEFAULT 'mingle'
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
  v_ctx text;
  v_rate real;
  v_fee integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_contrib := GREATEST(0, COALESCE(p_total_contribution_cents, 0));
  v_memb := public.is_user_org_member(v_uid);
  v_ctx := lower(trim(COALESCE(p_poolyn_context, 'mingle')));
  IF v_ctx NOT IN ('mingle', 'crew') THEN
    v_ctx := 'mingle';
  END IF;

  v_rate := CASE
    WHEN v_memb THEN 0::real
    WHEN v_ctx = 'crew' THEN 0.04::real
    ELSE 0.10::real
  END;

  v_fee := (ROUND(v_contrib * v_rate))::integer;

  RETURN json_build_object(
    'total_contribution', v_contrib,
    'network_fee_cents', v_fee,
    'final_charge_cents', v_contrib + v_fee,
    'is_org_member', v_memb,
    'poolyn_context', v_ctx
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_passenger_network_fee_preview(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_passenger_network_fee_preview(integer, text) TO authenticated;

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
  v_ctx text;
  v_contrib integer;
  v_fee integer;
  v_cash integer;
  v_memb boolean;
  v_rate real;
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

  SELECT COALESCE(r.poolyn_context, 'mingle') INTO v_ctx
  FROM public.rides r
  WHERE r.id = v_rp.ride_id;

  v_ctx := lower(trim(COALESCE(v_ctx, 'mingle')));
  IF v_ctx NOT IN ('mingle', 'crew') THEN
    v_ctx := 'mingle';
  END IF;

  v_contrib := GREATEST(0, COALESCE(v_rr.passenger_cost_cents, 0));
  v_memb := public.is_user_org_member(v_rr.passenger_id);

  v_rate := CASE
    WHEN v_memb THEN 0::real
    WHEN v_ctx = 'crew' THEN 0.04::real
    ELSE 0.10::real
  END;

  v_fee := (ROUND(v_contrib * v_rate))::integer;
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
    'is_org_member', v_memb,
    'poolyn_context', v_ctx
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_commit_commute_passenger_pricing(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_commit_commute_passenger_pricing(uuid, uuid) TO authenticated;
