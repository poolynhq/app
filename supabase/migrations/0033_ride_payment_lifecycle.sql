-- Phase 7–8: ride_passenger payment_status + enforce paid before confirm.
-- Does not change pricing/credit/org-status formulas; orchestrates existing deduct RPC.

ALTER TABLE public.ride_passengers
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed')),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

COMMENT ON COLUMN public.ride_passengers.payment_status IS
  'Card leg: paid required before status may leave pending → confirmed (see trigger).';
COMMENT ON COLUMN public.ride_passengers.stripe_payment_intent_id IS
  'Latest Stripe PaymentIntent id for this leg; set by Edge/webhook.';

-- Legacy legs already past pending: treat as paid (pre–Phase 7 data).
UPDATE public.ride_passengers
SET payment_status = 'paid'
WHERE status IN ('confirmed', 'picked_up', 'dropped_off', 'completed')
  AND payment_status = 'pending';

CREATE OR REPLACE FUNCTION public.trg_enforce_ride_passenger_payment_before_confirm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'pending'
     AND NEW.payment_status IS DISTINCT FROM 'paid'
  THEN
    RAISE EXCEPTION 'ride_payment_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_passenger_payment_before_confirm ON public.ride_passengers;
CREATE TRIGGER ride_passenger_payment_before_confirm
  BEFORE UPDATE OF status, payment_status ON public.ride_passengers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_ride_passenger_payment_before_confirm();

-- ---------------------------------------------------------------------------
-- Mark paid (Stripe webhook / Edge only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_mark_ride_passenger_payment_paid(
  p_ride_passenger_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (
    (SELECT auth.role()) = 'service_role'
    OR public.is_platform_super_admin()
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ride_passengers
  SET
    payment_status = 'paid',
    stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id)
  WHERE id = p_ride_passenger_id
    AND payment_status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_n > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_mark_ride_passenger_payment_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_mark_ride_passenger_payment_paid(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.poolyn_mark_ride_passenger_payment_paid(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Prepare: server-side max credit apply (uses existing deduct RPC), then read cash_to_charge_cents
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_prepare_ride_passenger_for_payment(
  p_ride_passenger_id uuid
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

  SELECT commute_credits_balance INTO v_bal
  FROM public.users WHERE id = v_uid;

  v_use := LEAST(COALESCE(v_bal, 0), GREATEST(0, COALESCE(v_rp.expected_contribution_cents, 0)));

  SELECT public.poolyn_deduct_commute_credits_for_ride(p_ride_passenger_id, v_use) INTO v_ded;

  SELECT cash_to_charge_cents INTO v_cash
  FROM public.ride_passengers WHERE id = p_ride_passenger_id;

  RETURN json_build_object(
    'ok', true,
    'cash_to_charge_cents', COALESCE(v_cash, 0),
    'credits_applied_cents', v_use,
    'deduct_result', v_ded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_prepare_ride_passenger_for_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_prepare_ride_passenger_for_payment(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- After Stripe success: passenger moves to confirmed (payment already paid)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_finalize_ride_passenger_confirmation(
  p_ride_passenger_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rp record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rp FROM public.ride_passengers WHERE id = p_ride_passenger_id;

  IF v_rp.id IS NULL THEN
    RAISE EXCEPTION 'ride_passenger not found';
  END IF;

  IF v_rp.passenger_id <> v_uid THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_rp.status = 'confirmed' THEN
    RETURN json_build_object('ok', true, 'idempotent', true);
  END IF;

  IF v_rp.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'ride_passenger_not_pending';
  END IF;

  IF v_rp.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'ride_payment_required';
  END IF;

  UPDATE public.ride_passengers
  SET
    status = 'confirmed',
    confirmed_at = COALESCE(confirmed_at, now())
  WHERE id = p_ride_passenger_id;

  RETURN json_build_object('ok', true, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_finalize_ride_passenger_confirmation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_finalize_ride_passenger_confirmation(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Phase 9C: admin grace / org state for UI (countdown)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_org_billing_state_for_admin()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_grace_start timestamptz;
  v_days integer;
  v_period integer;
BEGIN
  IF NOT public.current_user_is_org_admin() THEN
    RETURN json_build_object(
      'organisation_status', null,
      'grace_started_at', null,
      'days_remaining_in_grace', null
    );
  END IF;

  SELECT org.status, org.grace_started_at
  INTO v_status, v_grace_start
  FROM public.users u
  JOIN public.organisations org ON org.id = u.org_id
  WHERE u.id = auth.uid();

  IF v_status IS NULL THEN
    RETURN json_build_object(
      'organisation_status', null,
      'grace_started_at', null,
      'days_remaining_in_grace', null
    );
  END IF;

  v_period := public.poolyn_org_grace_period_days();

  IF v_status = 'grace' AND v_grace_start IS NOT NULL THEN
    v_days := v_period - FLOOR(
      EXTRACT(EPOCH FROM (now() - v_grace_start)) / 86400.0
    )::integer;
    IF v_days < 0 THEN
      v_days := 0;
    END IF;
  ELSE
    v_days := NULL;
  END IF;

  RETURN json_build_object(
    'organisation_status', v_status,
    'grace_started_at', v_grace_start,
    'days_remaining_in_grace', v_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_billing_state_for_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_billing_state_for_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.poolyn_mark_ride_passenger_payment_failed(
  p_ride_passenger_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (
    (SELECT auth.role()) = 'service_role'
    OR public.is_platform_super_admin()
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ride_passengers
  SET payment_status = 'failed'
  WHERE id = p_ride_passenger_id
    AND payment_status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN json_build_object('ok', true, 'updated', v_n > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_mark_ride_passenger_payment_failed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_mark_ride_passenger_payment_failed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.poolyn_mark_ride_passenger_payment_failed(uuid) TO authenticated;
