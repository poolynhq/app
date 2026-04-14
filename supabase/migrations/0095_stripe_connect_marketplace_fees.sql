-- Stripe Connect marketplace layer: financial ledger, fee rates (solo 15%, group 10%, org 0%),
-- Connect account id on users, expanded payment_status for refunds.

-- ---------------------------------------------------------------------------
-- 1) Users: Stripe Connect Express account id (created via Edge Function)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarding_complete boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.stripe_connect_account_id IS
  'Stripe Connect Express account id for driver/host payouts; set only by Edge Functions (service role).';
COMMENT ON COLUMN public.users.stripe_connect_onboarding_complete IS
  'True when Connect onboarding has completed successfully (optional; may also infer from Stripe API).';

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_connect_account_id_uidx
  ON public.users (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) ride_passengers: optional fee snapshot labels (filled at pricing commit / payment)
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_passengers
  ADD COLUMN IF NOT EXISTS fee_product_type text
    CHECK (fee_product_type IS NULL OR fee_product_type IN (
      'organization_member', 'solo_driver', 'group_trip'
    ));

COMMENT ON COLUMN public.ride_passengers.fee_product_type IS
  'Marketplace fee category at pricing time: org-covered (no per-trip fee), solo (network fee on share), or group (coordination fee).';

-- Allow refunded state for Stripe reconciliation
ALTER TABLE public.ride_passengers DROP CONSTRAINT IF EXISTS ride_passengers_payment_status_check;
ALTER TABLE public.ride_passengers
  ADD CONSTRAINT ride_passengers_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'));

-- ---------------------------------------------------------------------------
-- 3) Immutable financial ledger (append-only; webhook idempotency via stripe_event_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.poolyn_financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  ride_passenger_id uuid REFERENCES public.ride_passengers (id) ON DELETE SET NULL,
  stripe_payment_intent_id text,
  amount_cents integer,
  currency text NOT NULL DEFAULT 'aud',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poolyn_financial_ledger_rp_idx
  ON public.poolyn_financial_ledger (ride_passenger_id, created_at DESC);

CREATE INDEX IF NOT EXISTS poolyn_financial_ledger_pi_idx
  ON public.poolyn_financial_ledger (stripe_payment_intent_id);

ALTER TABLE public.poolyn_financial_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.poolyn_financial_ledger IS
  'Append-only Stripe-related events for auditing; inserts only via service_role RPC from Edge webhooks.';

REVOKE ALL ON TABLE public.poolyn_financial_ledger FROM PUBLIC;
GRANT ALL ON TABLE public.poolyn_financial_ledger TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Supporting tables for refunds / disputes / payouts (audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.poolyn_stripe_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_refund_id text NOT NULL UNIQUE,
  ride_passenger_id uuid REFERENCES public.ride_passengers (id) ON DELETE SET NULL,
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'aud',
  status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poolyn_stripe_refunds_rp_idx ON public.poolyn_stripe_refunds (ride_passenger_id);

ALTER TABLE public.poolyn_stripe_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.poolyn_stripe_refunds FROM PUBLIC;
GRANT ALL ON TABLE public.poolyn_stripe_refunds TO service_role;

CREATE TABLE IF NOT EXISTS public.poolyn_stripe_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id text NOT NULL UNIQUE,
  stripe_charge_id text,
  ride_passenger_id uuid REFERENCES public.ride_passengers (id) ON DELETE SET NULL,
  status text,
  evidence_due_by timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poolyn_stripe_disputes_rp_idx ON public.poolyn_stripe_disputes (ride_passenger_id);

ALTER TABLE public.poolyn_stripe_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.poolyn_stripe_disputes FROM PUBLIC;
GRANT ALL ON TABLE public.poolyn_stripe_disputes TO service_role;

CREATE TABLE IF NOT EXISTS public.poolyn_stripe_payout_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payout_id text NOT NULL,
  stripe_connect_account_id text NOT NULL,
  amount_cents bigint,
  currency text NOT NULL DEFAULT 'aud',
  status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_payout_id, stripe_connect_account_id)
);

ALTER TABLE public.poolyn_stripe_payout_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.poolyn_stripe_payout_events FROM PUBLIC;
GRANT ALL ON TABLE public.poolyn_stripe_payout_events TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Fee preview + commit: 15% solo (mingle/adhoc), 10% group (crew), 0% org member
-- ---------------------------------------------------------------------------
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
  IF v_ctx NOT IN ('mingle', 'crew', 'adhoc') THEN
    v_ctx := 'mingle';
  END IF;

  v_rate := CASE
    WHEN v_memb THEN 0::real
    WHEN v_ctx = 'crew' THEN 0.10::real
    ELSE 0.15::real
  END;

  v_fee := (ROUND(v_contrib * v_rate))::integer;

  RETURN json_build_object(
    'total_contribution', v_contrib,
    'network_fee_cents', v_fee,
    'final_charge_cents', v_contrib + v_fee,
    'is_org_member', v_memb,
    'poolyn_context', v_ctx,
    'fee_product_type', CASE
      WHEN v_memb THEN 'organization_member'
      WHEN v_ctx = 'crew' THEN 'group_trip'
      ELSE 'solo_driver'
    END,
    'fee_rate', v_rate
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
  v_ctx text;
  v_contrib integer;
  v_fee integer;
  v_cash integer;
  v_memb boolean;
  v_rate real;
  v_fee_type text;
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
  IF v_ctx NOT IN ('mingle', 'crew', 'adhoc') THEN
    v_ctx := 'mingle';
  END IF;

  v_contrib := GREATEST(0, COALESCE(v_rr.passenger_cost_cents, 0));
  v_memb := public.is_user_org_member(v_rr.passenger_id);

  v_rate := CASE
    WHEN v_memb THEN 0::real
    WHEN v_ctx = 'crew' THEN 0.10::real
    ELSE 0.15::real
  END;

  v_fee := (ROUND(v_contrib * v_rate))::integer;
  v_cash := v_contrib + v_fee;

  v_fee_type := CASE
    WHEN v_memb THEN 'organization_member'
    WHEN v_ctx = 'crew' THEN 'group_trip'
    ELSE 'solo_driver'
  END;

  UPDATE public.ride_passengers
  SET
    expected_contribution_cents = v_contrib,
    network_fee_cents = v_fee,
    cash_to_charge_cents = v_cash,
    points_cost = v_contrib,
    fee_product_type = v_fee_type
  WHERE id = p_ride_passenger_id;

  RETURN json_build_object(
    'ok', true,
    'expected_contribution_cents', v_contrib,
    'network_fee_cents', v_fee,
    'cash_to_charge_cents', v_cash,
    'is_org_member', v_memb,
    'poolyn_context', v_ctx,
    'fee_product_type', v_fee_type,
    'fee_rate', v_rate
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Service-role RPCs for webhooks and Edge Functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_financial_ledger_record(
  p_stripe_event_id text,
  p_event_type text,
  p_ride_passenger_id uuid,
  p_stripe_payment_intent_id text,
  p_amount_cents integer,
  p_currency text,
  p_payload jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.poolyn_financial_ledger (
    stripe_event_id, event_type, ride_passenger_id,
    stripe_payment_intent_id, amount_cents, currency, payload
  )
  VALUES (
    p_stripe_event_id, p_event_type, p_ride_passenger_id,
    p_stripe_payment_intent_id, p_amount_cents, lower(trim(COALESCE(p_currency, 'aud'))), COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (stripe_event_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN json_build_object('ok', true, 'inserted', v_n > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_financial_ledger_record(text, text, uuid, text, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_financial_ledger_record(text, text, uuid, text, integer, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.poolyn_set_user_stripe_connect_account(
  p_user_id uuid,
  p_stripe_connect_account_id text,
  p_onboarding_complete boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
  SET
    stripe_connect_account_id = NULLIF(trim(p_stripe_connect_account_id), ''),
    stripe_connect_onboarding_complete = COALESCE(p_onboarding_complete, stripe_connect_onboarding_complete)
  WHERE id = p_user_id;

  RETURN json_build_object('ok', true, 'updated', FOUND);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_set_user_stripe_connect_account(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_set_user_stripe_connect_account(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.poolyn_mark_ride_passenger_payment_refunded(
  p_ride_passenger_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_currency text,
  p_raw jsonb,
  p_full_refund boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pi text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT stripe_payment_intent_id INTO v_pi
  FROM public.ride_passengers WHERE id = p_ride_passenger_id;

  INSERT INTO public.poolyn_stripe_refunds (
    stripe_refund_id, ride_passenger_id, stripe_payment_intent_id,
    amount_cents, currency, status, raw
  )
  VALUES (
    p_stripe_refund_id, p_ride_passenger_id, v_pi,
    COALESCE(p_amount_cents, 0), lower(trim(COALESCE(p_currency, 'aud'))), 'succeeded', COALESCE(p_raw, '{}'::jsonb)
  )
  ON CONFLICT (stripe_refund_id) DO NOTHING;

  IF COALESCE(p_full_refund, true) THEN
    UPDATE public.ride_passengers
    SET payment_status = 'refunded'
    WHERE id = p_ride_passenger_id
      AND payment_status = 'paid';
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_mark_ride_passenger_payment_refunded(uuid, text, integer, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_mark_ride_passenger_payment_refunded(uuid, text, integer, text, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.poolyn_record_stripe_dispute(
  p_stripe_dispute_id text,
  p_stripe_charge_id text,
  p_ride_passenger_id uuid,
  p_status text,
  p_evidence_due_by timestamptz,
  p_raw jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.poolyn_stripe_disputes (
    stripe_dispute_id, stripe_charge_id, ride_passenger_id,
    status, evidence_due_by, raw
  )
  VALUES (
    p_stripe_dispute_id, p_stripe_charge_id, p_ride_passenger_id,
    p_status, p_evidence_due_by, COALESCE(p_raw, '{}'::jsonb)
  )
  ON CONFLICT (stripe_dispute_id) DO UPDATE SET
    status = EXCLUDED.status,
    evidence_due_by = EXCLUDED.evidence_due_by,
    raw = EXCLUDED.raw;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_record_stripe_dispute(text, text, uuid, text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_record_stripe_dispute(text, text, uuid, text, timestamptz, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.poolyn_record_stripe_payout_event(
  p_stripe_payout_id text,
  p_stripe_connect_account_id text,
  p_amount_cents integer,
  p_currency text,
  p_status text,
  p_raw jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.poolyn_stripe_payout_events (
    stripe_payout_id, stripe_connect_account_id, amount_cents, currency, status, raw
  )
  VALUES (
    p_stripe_payout_id, p_stripe_connect_account_id, p_amount_cents::bigint,
    lower(trim(COALESCE(p_currency, 'aud'))), p_status, COALESCE(p_raw, '{}'::jsonb)
  )
  ON CONFLICT (stripe_payout_id, stripe_connect_account_id) DO UPDATE SET
    status = EXCLUDED.status,
    amount_cents = EXCLUDED.amount_cents,
    raw = EXCLUDED.raw;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_record_stripe_payout_event(text, text, integer, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_record_stripe_payout_event(text, text, integer, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 7) Authenticated: read committed pricing snapshot for PaymentSheet / UI
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
-- 8) Prepare for payment: optional skip of commute credit deduction (Stripe-only v1)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.poolyn_prepare_ride_passenger_for_payment(uuid);

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

  IF v_rp.payment_status <> 'pending' THEN
    SELECT cash_to_charge_cents INTO v_cash
    FROM public.ride_passengers WHERE id = p_ride_passenger_id;
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
