-- Pooling-day confirmation (join vs not today), stored per rider per trip instance.
-- Settlement still charges riders who never responded (flag on rider line for disputes).
--
-- After applying: re-add pool_rider_commitment to CREW_TRIP_INSTANCE_SELECT in src/lib/crewMessaging.ts
-- so the client loads commitment state (otherwise it stays null until selected).

ALTER TABLE public.crew_trip_instances
  ADD COLUMN IF NOT EXISTS pool_rider_commitment jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.crew_trip_instances.pool_rider_commitment IS
  'Per rider user_id: { "status": "joining"|"declining", "at": "<iso>" }. Declining adds them to excluded_pickup_user_ids. Missing key at settlement: charged but no_pool_day_confirmation.';

-- ---------------------------------------------------------------------------
-- poolyn_crew_trip_set_pool_commitment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_crew_trip_set_pool_commitment(
  p_trip_instance_id uuid,
  p_joining boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_excl uuid[];
  v_started timestamptz;
  v_driver uuid;
  v_key text;
  v_entry jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT
    cti.crew_id,
    cti.excluded_pickup_user_ids,
    cti.trip_started_at,
    cti.designated_driver_user_id
  INTO v_crew_id, v_excl, v_started, v_driver
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_driver IS NOT NULL AND v_uid = v_driver THEN
    RETURN json_build_object('ok', false, 'reason', 'driver_no_commitment');
  END IF;

  IF v_started IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_already_started');
  END IF;

  v_excl := COALESCE(v_excl, '{}'::uuid[]);

  IF p_joining THEN
    v_excl := ARRAY(
      SELECT x FROM unnest(v_excl) AS x WHERE x IS DISTINCT FROM v_uid
    );
  ELSE
    IF NOT (v_uid = ANY (v_excl)) THEN
      v_excl := array_append(v_excl, v_uid);
    END IF;
  END IF;

  v_key := v_uid::text;
  v_entry := jsonb_build_object(
    'status', CASE WHEN p_joining THEN 'joining' ELSE 'declining' END,
    'at', to_jsonb(now()::timestamptz)
  );

  UPDATE public.crew_trip_instances
  SET
    excluded_pickup_user_ids = v_excl,
    pool_rider_commitment = jsonb_set(
      COALESCE(pool_rider_commitment, '{}'::jsonb),
      ARRAY[v_key],
      v_entry,
      true
    ),
    updated_at = now()
  WHERE id = p_trip_instance_id;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_trip_set_pool_commitment(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_trip_set_pool_commitment(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- poolyn_crew_trip_finish_and_settle_credits: add pool-day flags on rider lines
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_crew_trip_finish_and_settle_credits(
  p_trip_instance_id uuid,
  p_contribution_credits_per_rider integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst_id uuid;
  v_crew_id uuid;
  v_trip_date date;
  v_driver uuid;
  v_excl uuid[];
  v_started timestamptz;
  v_settled timestamptz;
  v_existing_summary jsonb;
  v_commute_pattern text;
  v_crew_name text;
  v_locked_dist double precision;
  v_locked_dur integer;
  v_rider_uid uuid;
  v_fee integer;
  v_debit integer;
  v_bal integer;
  v_sum_contrib integer := 0;
  v_total_fee integer := 0;
  v_riders jsonb := '[]'::jsonb;
  v_rider_line jsonb;
  v_rider_name text;
  v_driver_name text;
  v_allowed boolean;
  v_route_label text;
  v_dist_km numeric;
  v_dur_mins integer;
  v_pool_commit jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_contribution_credits_per_rider IS NULL
     OR p_contribution_credits_per_rider < 0
     OR p_contribution_credits_per_rider > 5000000 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_contribution');
  END IF;

  SELECT
    cti.id,
    cti.crew_id,
    cti.trip_date,
    cti.designated_driver_user_id,
    cti.excluded_pickup_user_ids,
    cti.trip_started_at,
    cti.poolyn_credits_settled_at,
    cti.settlement_summary,
    c.commute_pattern,
    c.name,
    c.locked_route_distance_m,
    c.locked_route_duration_s,
    COALESCE(cti.pool_rider_commitment, '{}'::jsonb)
  INTO
    v_inst_id,
    v_crew_id,
    v_trip_date,
    v_driver,
    v_excl,
    v_started,
    v_settled,
    v_existing_summary,
    v_commute_pattern,
    v_crew_name,
    v_locked_dist,
    v_locked_dur,
    v_pool_commit
  FROM public.crew_trip_instances cti
  JOIN public.crews c ON c.id = cti.crew_id
  WHERE cti.id = p_trip_instance_id;

  IF v_inst_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_driver IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_designated_driver');
  END IF;

  v_allowed := (v_uid = v_driver OR public.poolyn_user_is_crew_owner(v_crew_id, v_uid));
  IF NOT v_allowed THEN
    RETURN json_build_object('ok', false, 'reason', 'not_driver_or_owner');
  END IF;

  IF v_started IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_started');
  END IF;

  IF v_settled IS NOT NULL THEN
    SELECT cti.settlement_summary INTO v_existing_summary
    FROM public.crew_trip_instances cti
    WHERE cti.id = p_trip_instance_id;
    RETURN json_build_object(
      'ok', true,
      'idempotent', true,
      'settlement_summary', COALESCE(v_existing_summary, '{}'::jsonb)
    );
  END IF;

  v_excl := COALESCE(v_excl, '{}'::uuid[]);

  v_route_label := CASE COALESCE(v_commute_pattern, 'to_work')
    WHEN 'to_home' THEN 'Work → Home'
    WHEN 'round_trip' THEN 'Crew commute (round trip)'
    ELSE 'Home → Work'
  END;

  IF v_locked_dist IS NOT NULL AND v_locked_dist > 0 THEN
    v_dist_km := round((v_locked_dist::numeric / 1000), 1);
  ELSE
    v_dist_km := NULL;
  END IF;

  IF v_locked_dur IS NOT NULL AND v_locked_dur > 0 THEN
    v_dur_mins := (v_locked_dur + 30) / 60;
  ELSE
    v_dur_mins := NULL;
  END IF;

  PERFORM 1
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id
  FOR UPDATE;

  SELECT cti.poolyn_credits_settled_at, cti.settlement_summary
  INTO v_settled, v_existing_summary
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_settled IS NOT NULL THEN
    RETURN json_build_object(
      'ok', true,
      'idempotent', true,
      'settlement_summary', COALESCE(v_existing_summary, '{}'::jsonb)
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.commute_credits_ledger l
    WHERE l.reference_type = 'crew_trip_instance'
      AND l.reference_id = p_trip_instance_id
      AND l.txn_type IN ('credit_used', 'credit_earned')
  ) THEN
    UPDATE public.crew_trip_instances
    SET poolyn_credits_settled_at = COALESCE(poolyn_credits_settled_at, now()),
        trip_finished_at = COALESCE(trip_finished_at, now()),
        updated_at = now()
    WHERE id = p_trip_instance_id;
    SELECT cti.settlement_summary INTO v_existing_summary
    FROM public.crew_trip_instances cti
    WHERE cti.id = p_trip_instance_id;
    RETURN json_build_object(
      'ok', true,
      'idempotent', true,
      'settlement_summary', COALESCE(v_existing_summary, '{}'::jsonb)
    );
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), 'Poolyn member') INTO v_driver_name
  FROM public.users
  WHERE id = v_driver;

  FOR v_rider_uid IN
    SELECT cm.user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = v_crew_id
      AND cm.user_id IS DISTINCT FROM v_driver
      AND NOT (cm.user_id = ANY (v_excl))
  LOOP
    IF p_contribution_credits_per_rider = 0 THEN
      CONTINUE;
    END IF;

    v_fee := CASE
      WHEN public.is_user_org_member(v_rider_uid) THEN 0
      ELSE (ROUND(p_contribution_credits_per_rider::numeric * 0.04))::integer
    END;
    v_debit := p_contribution_credits_per_rider + v_fee;
    v_sum_contrib := v_sum_contrib + p_contribution_credits_per_rider;
    v_total_fee := v_total_fee + v_fee;

    SELECT COALESCE(NULLIF(trim(full_name), ''), 'Poolyn member') INTO v_rider_name
    FROM public.users
    WHERE id = v_rider_uid;

    v_rider_line := jsonb_build_object(
      'user_id', v_rider_uid,
      'full_name', v_rider_name,
      'credits_contribution', p_contribution_credits_per_rider,
      'credits_crew_admin_fee', v_fee,
      'credits_total_debited', v_debit,
      'is_org_member', public.is_user_org_member(v_rider_uid),
      'no_pool_day_confirmation', NOT COALESCE((v_pool_commit ? v_rider_uid::text), false)
    );
    v_riders := v_riders || jsonb_build_array(v_rider_line);

    SELECT commute_credits_balance INTO v_bal
    FROM public.users
    WHERE id = v_rider_uid
    FOR UPDATE;

    IF v_bal IS NULL THEN
      RETURN json_build_object('ok', false, 'reason', 'rider_not_found', 'user_id', v_rider_uid);
    END IF;

    IF v_bal < v_debit THEN
      RETURN json_build_object(
        'ok', false,
        'reason', 'insufficient_credits',
        'user_id', v_rider_uid,
        'needed', v_debit,
        'balance', v_bal
      );
    END IF;
  END LOOP;

  FOR v_rider_uid IN
    SELECT cm.user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = v_crew_id
      AND cm.user_id IS DISTINCT FROM v_driver
      AND NOT (cm.user_id = ANY (v_excl))
  LOOP
    IF p_contribution_credits_per_rider = 0 THEN
      CONTINUE;
    END IF;

    v_fee := CASE
      WHEN public.is_user_org_member(v_rider_uid) THEN 0
      ELSE (ROUND(p_contribution_credits_per_rider::numeric * 0.04))::integer
    END;
    v_debit := p_contribution_credits_per_rider + v_fee;

    INSERT INTO public.commute_credits_ledger (
      user_id, delta, balance_after, txn_type, reference_type, reference_id, description
    ) VALUES (
      v_rider_uid,
      -v_debit,
      0,
      'credit_used',
      'crew_trip_instance',
      p_trip_instance_id,
      format('Crew Poolyn · %s · %s', v_crew_name, v_route_label)
    );
  END LOOP;

  IF v_sum_contrib > 0 THEN
    INSERT INTO public.commute_credits_ledger (
      user_id, delta, balance_after, txn_type, reference_type, reference_id, description
    ) VALUES (
      v_driver,
      v_sum_contrib,
      0,
      'credit_earned',
      'crew_trip_instance',
      p_trip_instance_id,
      format('Crew Poolyn driver · %s · %s', v_crew_name, v_route_label)
    );
  END IF;

  UPDATE public.crew_trip_instances
  SET trip_finished_at = now(),
      poolyn_credits_settled_at = now(),
      settlement_summary = jsonb_build_object(
        'crew_name', v_crew_name,
        'trip_date', v_trip_date,
        'route_label', v_route_label,
        'commute_pattern', v_commute_pattern,
        'distance_km', v_dist_km,
        'duration_mins', v_dur_mins,
        'contribution_credits_per_rider', p_contribution_credits_per_rider,
        'amount_units_note', 'same_integer_as_pricing_cents_and_balance',
        'crew_explorer_admin_fee_rate', 0.04,
        'riders', v_riders,
        'driver_user_id', v_driver,
        'driver_full_name', v_driver_name,
        'driver_credits_earned', v_sum_contrib,
        'total_crew_admin_credits_from_explorers', v_total_fee,
        'pool_rider_commitment_snapshot', COALESCE(v_pool_commit, '{}'::jsonb),
        'finished_at', to_jsonb(now())
      ),
      updated_at = now()
  WHERE id = p_trip_instance_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'settlement_summary',
    (SELECT settlement_summary FROM public.crew_trip_instances WHERE id = p_trip_instance_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_trip_finish_and_settle_credits(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_trip_finish_and_settle_credits(uuid, integer) TO authenticated;
