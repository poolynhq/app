-- Patch: server-side org check, pricing snapshot on ride_passengers, credit validation,
-- automatic driver commute credit issuance, cash_to_charge storage.
--
-- FLAG: Spec referenced organizations.subscription_status — this schema uses public.subscriptions
--       (org_id, status). "Member" = users.org_id IS NOT NULL AND EXISTS org subscription
--       with status = 'active' (trialing NOT included; add if product requires).

-- ---------------------------------------------------------------------------
-- 1) ride_passengers: server-side pricing / payment snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_passengers
  ADD COLUMN IF NOT EXISTS expected_contribution_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS network_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_to_charge_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ride_passengers.expected_contribution_cents IS
  'Poolyn total_contribution (cents) from pricing engine; set via poolyn_commit_commute_passenger_pricing.';
COMMENT ON COLUMN public.ride_passengers.network_fee_cents IS
  'Platform network fee on contribution only; cash; computed server-side (never from client).';
COMMENT ON COLUMN public.ride_passengers.cash_to_charge_cents IS
  'Source of truth for card charge after credits: remaining_contribution + network_fee; updated on credit deduct.';

UPDATE public.ride_passengers rp
SET
  expected_contribution_cents = GREATEST(0, rp.points_cost),
  network_fee_cents = ROUND(GREATEST(0, rp.points_cost) * 0.18)::integer,
  cash_to_charge_cents = GREATEST(0, rp.points_cost)
    + ROUND(GREATEST(0, rp.points_cost) * 0.18)::integer
WHERE rp.expected_contribution_cents = 0
  AND rp.points_cost IS NOT NULL
  AND rp.points_cost > 0;

-- ---------------------------------------------------------------------------
-- 2) is_user_org_member(user_id) — default false; never trust client
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_user_org_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        u.org_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.subscriptions s
          WHERE s.org_id = u.org_id
            AND s.status = 'active'
        )
      FROM public.users u
      WHERE u.id = p_user_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_user_org_member(uuid) FROM PUBLIC;
-- Internal use only; callers use SECURITY DEFINER RPCs below.

-- ---------------------------------------------------------------------------
-- 3) Passenger preview: network fee from server-resolved org membership
-- ---------------------------------------------------------------------------
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
    ELSE ROUND(v_contrib * 0.18)::integer
  END;

  RETURN json_build_object(
    'total_contribution', v_contrib,
    'network_fee_cents', v_fee,
    'final_charge_cents', v_contrib + v_fee,
    'is_org_member', v_memb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_passenger_network_fee_preview(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_passenger_network_fee_preview(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Commit pricing snapshot from ride_reservation (trusted server row)
-- ---------------------------------------------------------------------------
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
    ELSE ROUND(v_contrib * 0.18)::integer
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

REVOKE ALL ON FUNCTION public.poolyn_commit_commute_passenger_pricing(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_commit_commute_passenger_pricing(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Deduct credits: validate against expected_contribution_cents; refresh cash_to_charge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_deduct_commute_credits_for_ride(
  p_ride_passenger_id uuid,
  p_credits_used integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_passenger_id uuid;
  v_expected integer;
  v_network_fee integer;
  v_existing integer;
  v_bal integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_credits_used IS NULL OR p_credits_used < 0 THEN
    RAISE EXCEPTION 'invalid p_credits_used';
  END IF;

  SELECT rp.passenger_id, rp.expected_contribution_cents, rp.network_fee_cents
  INTO v_passenger_id, v_expected, v_network_fee
  FROM public.ride_passengers rp
  WHERE rp.id = p_ride_passenger_id;

  IF v_passenger_id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_passenger_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_credits_used > COALESCE(v_expected, 0) THEN
    RAISE EXCEPTION 'invalid_credit_amount';
  END IF;

  IF p_credits_used = 0 THEN
    SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_uid;
    RETURN json_build_object(
      'ok', true,
      'idempotent', false,
      'credits_used', 0,
      'balance_after', COALESCE(v_bal, 0),
      'cash_to_charge_cents', (
        SELECT cash_to_charge_cents FROM public.ride_passengers WHERE id = p_ride_passenger_id
      )
    );
  END IF;

  SELECT delta INTO v_existing
  FROM public.commute_credits_ledger
  WHERE user_id = v_passenger_id
    AND txn_type = 'credit_used'
    AND reference_type = 'ride_passenger'
    AND reference_id = p_ride_passenger_id;

  IF FOUND THEN
    SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_passenger_id;
    RETURN json_build_object(
      'ok', true,
      'idempotent', true,
      'credits_used', (-v_existing),
      'balance_after', COALESCE(v_bal, 0),
      'cash_to_charge_cents', (
        SELECT cash_to_charge_cents FROM public.ride_passengers WHERE id = p_ride_passenger_id
      )
    );
  END IF;

  SELECT commute_credits_balance INTO v_bal
  FROM public.users
  WHERE id = v_passenger_id
  FOR UPDATE;

  IF v_bal IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  IF v_bal < p_credits_used THEN
    RAISE EXCEPTION 'insufficient commute credits';
  END IF;

  BEGIN
    INSERT INTO public.commute_credits_ledger (
      user_id,
      delta,
      balance_after,
      txn_type,
      reference_type,
      reference_id,
      description
    )
    VALUES (
      v_passenger_id,
      -p_credits_used,
      0,
      'credit_used',
      'ride_passenger',
      p_ride_passenger_id,
      NULL
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT delta INTO v_existing
      FROM public.commute_credits_ledger
      WHERE user_id = v_passenger_id
        AND txn_type = 'credit_used'
        AND reference_type = 'ride_passenger'
        AND reference_id = p_ride_passenger_id;
      SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_passenger_id;
      RETURN json_build_object(
        'ok', true,
        'idempotent', true,
        'credits_used', (-v_existing),
        'balance_after', COALESCE(v_bal, 0),
        'cash_to_charge_cents', (
          SELECT cash_to_charge_cents FROM public.ride_passengers WHERE id = p_ride_passenger_id
        )
      );
  END;

  UPDATE public.ride_passengers
  SET cash_to_charge_cents =
    (COALESCE(v_expected, 0) - p_credits_used) + COALESCE(v_network_fee, 0)
  WHERE id = p_ride_passenger_id;

  SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_passenger_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'credits_used', p_credits_used,
    'balance_after', COALESCE(v_bal, 0),
    'cash_to_charge_cents', (
      SELECT cash_to_charge_cents FROM public.ride_passengers WHERE id = p_ride_passenger_id
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Driver credit issuance (internal): uses stored expected_contribution_cents only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_try_issue_driver_commute_credits(
  p_ride_passenger_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_ride_status text;
  v_rp_status text;
  v_contribution integer;
BEGIN
  SELECT
    r.driver_id,
    r.status,
    rp.status,
    rp.expected_contribution_cents
  INTO v_driver_id, v_ride_status, v_rp_status, v_contribution
  FROM public.ride_passengers rp
  JOIN public.rides r ON r.id = rp.ride_id
  WHERE rp.id = p_ride_passenger_id;

  IF v_driver_id IS NULL THEN
    RETURN;
  END IF;

  IF v_ride_status = 'cancelled' THEN
    RETURN;
  END IF;

  IF v_rp_status NOT IN ('dropped_off', 'completed') THEN
    RETURN;
  END IF;

  IF v_contribution IS NULL OR v_contribution <= 0 THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.commute_credits_ledger (
      user_id,
      delta,
      balance_after,
      txn_type,
      reference_type,
      reference_id,
      description
    )
    VALUES (
      v_driver_id,
      v_contribution,
      0,
      'credit_earned',
      'ride_passenger',
      p_ride_passenger_id,
      NULL
    );
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_try_issue_driver_commute_credits(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.trg_ride_passenger_issue_driver_commute_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('dropped_off', 'completed')
  THEN
    PERFORM public.poolyn_try_issue_driver_commute_credits(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_passenger_status_driver_commute_credits ON public.ride_passengers;
CREATE TRIGGER ride_passenger_status_driver_commute_credits
  AFTER UPDATE OF status ON public.ride_passengers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ride_passenger_issue_driver_commute_credits();

-- ---------------------------------------------------------------------------
-- 7) Public driver/admin RPC: optional amount must match snapshot; else use DB only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_credit_driver_for_ride_leg(
  p_ride_passenger_id uuid,
  p_total_contribution_cents integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_id uuid;
  v_ride_status text;
  v_rp_status text;
  v_expected integer;
  v_existing integer;
  v_bal integer;
  v_amount integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT r.driver_id, r.status, rp.status, rp.expected_contribution_cents
  INTO v_driver_id, v_ride_status, v_rp_status, v_expected
  FROM public.ride_passengers rp
  JOIN public.rides r ON r.id = rp.ride_id
  WHERE rp.id = p_ride_passenger_id;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_uid <> v_driver_id AND NOT public.is_platform_super_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_ride_status = 'cancelled' THEN
    RAISE EXCEPTION 'ride cancelled';
  END IF;

  IF v_rp_status NOT IN ('dropped_off', 'completed') THEN
    RAISE EXCEPTION 'passenger leg must be dropped_off or completed';
  END IF;

  v_amount := COALESCE(v_expected, 0);
  IF p_total_contribution_cents IS NOT NULL AND p_total_contribution_cents <> v_amount THEN
    RAISE EXCEPTION 'contribution_mismatch';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid expected_contribution_cents';
  END IF;

  SELECT delta INTO v_existing
  FROM public.commute_credits_ledger
  WHERE user_id = v_driver_id
    AND txn_type = 'credit_earned'
    AND reference_type = 'ride_passenger'
    AND reference_id = p_ride_passenger_id;

  IF FOUND THEN
    SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_driver_id;
    RETURN json_build_object(
      'ok', true,
      'idempotent', true,
      'credits_issued', v_existing,
      'balance_after', COALESCE(v_bal, 0)
    );
  END IF;

  BEGIN
    INSERT INTO public.commute_credits_ledger (
      user_id,
      delta,
      balance_after,
      txn_type,
      reference_type,
      reference_id,
      description
    )
    VALUES (
      v_driver_id,
      v_amount,
      0,
      'credit_earned',
      'ride_passenger',
      p_ride_passenger_id,
      NULL
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT delta INTO v_existing
      FROM public.commute_credits_ledger
      WHERE user_id = v_driver_id
        AND txn_type = 'credit_earned'
        AND reference_type = 'ride_passenger'
        AND reference_id = p_ride_passenger_id;
      SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_driver_id;
      RETURN json_build_object(
        'ok', true,
        'idempotent', true,
        'credits_issued', v_existing,
        'balance_after', COALESCE(v_bal, 0)
      );
  END;

  SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_driver_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'credits_issued', v_amount,
    'balance_after', COALESCE(v_bal, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_credit_driver_for_ride_leg(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_credit_driver_for_ride_leg(uuid, integer) TO authenticated;
