-- Phase 5–6: Poolyn commute credits (closed-loop, non-withdrawable) + DB hooks for ledger.
-- Pricing/fee math lives in app (src/lib/networkFeeAndCredits.ts); this migration stores balances and idempotent leg postings.

-- ---------------------------------------------------------------------------
-- 1) Per-user commute credit balance (100 credits = $1 of contribution coverage)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commute_credits_balance integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.users.commute_credits_balance IS
  'Poolyn commute credits (internal only). Same unit as pricing total_contribution cents: 100 credits = $1. Separate from flex_credits_balance.';

-- ---------------------------------------------------------------------------
-- 2) Ledger (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commute_credits_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  delta          integer NOT NULL,
  balance_after  integer NOT NULL,
  txn_type       text NOT NULL
                   CHECK (txn_type IN (
                     'credit_earned',
                     'credit_used',
                     'credit_adjustment'
                   )),
  reference_type text,
  reference_id   uuid,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commute_credits_ledger_user
  ON public.commute_credits_ledger (user_id, created_at DESC);

-- At most one earn and one use per user per ride_passengers row (idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS commute_credits_idem_ride_leg
  ON public.commute_credits_ledger (user_id, txn_type, reference_id)
  WHERE reference_type = 'ride_passenger'
    AND reference_id IS NOT NULL
    AND txn_type IN ('credit_earned', 'credit_used');

COMMENT ON TABLE public.commute_credits_ledger IS
  'Poolyn commute credits ledger. Not cash; not withdrawable. Network fees are never posted here.';

ALTER TABLE public.commute_credits_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own commute credit history"
  ON public.commute_credits_ledger;
CREATE POLICY "Users can view own commute credit history"
  ON public.commute_credits_ledger FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON public.commute_credits_ledger FROM PUBLIC;
GRANT SELECT ON public.commute_credits_ledger TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Balance sync (same pattern as flex_credits_ledger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_commute_credits_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET commute_credits_balance = commute_credits_balance + NEW.delta
  WHERE id = NEW.user_id;

  NEW.balance_after := (
    SELECT commute_credits_balance FROM public.users WHERE id = NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_commute_credits_balance ON public.commute_credits_ledger;
CREATE TRIGGER sync_commute_credits_balance
  BEFORE INSERT ON public.commute_credits_ledger
  FOR EACH ROW EXECUTE FUNCTION public.handle_commute_credits_balance();

-- ---------------------------------------------------------------------------
-- 4) Passenger: apply credit_used after confirmation / before cash settle (idempotent)
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
  v_existing integer;
  v_bal integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_credits_used IS NULL OR p_credits_used < 0 THEN
    RAISE EXCEPTION 'invalid p_credits_used';
  END IF;

  IF p_credits_used = 0 THEN
    SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_uid;
    RETURN json_build_object(
      'ok', true,
      'idempotent', false,
      'credits_used', 0,
      'balance_after', COALESCE(v_bal, 0)
    );
  END IF;

  SELECT rp.passenger_id INTO v_passenger_id
  FROM public.ride_passengers rp
  WHERE rp.id = p_ride_passenger_id;

  IF v_passenger_id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_passenger_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
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
      'balance_after', COALESCE(v_bal, 0)
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
        'balance_after', COALESCE(v_bal, 0)
      );
  END;

  SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = v_passenger_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'credits_used', p_credits_used,
    'balance_after', COALESCE(v_bal, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_deduct_commute_credits_for_ride(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_deduct_commute_credits_for_ride(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Driver: credit_earned = total_contribution (cents) after trip completion (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_credit_driver_for_ride_leg(
  p_ride_passenger_id uuid,
  p_total_contribution_cents integer
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
  v_existing integer;
  v_bal integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_total_contribution_cents IS NULL OR p_total_contribution_cents <= 0 THEN
    RAISE EXCEPTION 'invalid p_total_contribution_cents';
  END IF;

  SELECT r.driver_id, r.status, rp.status
  INTO v_driver_id, v_ride_status, v_rp_status
  FROM public.ride_passengers rp
  JOIN public.rides r ON r.id = rp.ride_id
  WHERE rp.id = p_ride_passenger_id;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_uid <> v_driver_id AND NOT public.is_platform_super_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_ride_status <> 'completed' THEN
    RAISE EXCEPTION 'ride must be completed';
  END IF;

  IF v_rp_status NOT IN ('dropped_off', 'completed') THEN
    RAISE EXCEPTION 'passenger leg must be dropped_off or completed';
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
      p_total_contribution_cents,
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
    'credits_issued', p_total_contribution_cents,
    'balance_after', COALESCE(v_bal, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_credit_driver_for_ride_leg(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_credit_driver_for_ride_leg(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Platform super-admin: manual adjustments (multiple rows allowed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_admin_commute_credit_adjustment(
  p_target_user_id uuid,
  p_delta integer,
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bal integer;
BEGIN
  IF NOT public.is_platform_super_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_delta = 0 THEN
    RAISE EXCEPTION 'p_delta must be non-zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  SELECT commute_credits_balance INTO v_bal
  FROM public.users
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_bal, 0) + p_delta < 0 THEN
    RAISE EXCEPTION 'adjustment would make commute_credits_balance negative';
  END IF;

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
    p_target_user_id,
    p_delta,
    0,
    'credit_adjustment',
    NULL,
    NULL,
    p_reason
  );

  SELECT commute_credits_balance INTO v_bal FROM public.users WHERE id = p_target_user_id;

  RETURN json_build_object(
    'ok', true,
    'balance_after', COALESCE(v_bal, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_admin_commute_credit_adjustment(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_admin_commute_credit_adjustment(uuid, integer, text) TO authenticated;
