-- Simulates one finished Crew Poolyn day: History row + ledger + balances (via trigger).
-- Prerequisites: migration 0076 applied (contribution function). Run in Supabase SQL Editor as postgres.
--
-- EDIT: v_crew, v_trip_date (must not already exist for that crew), optionally v_driver (or NULL = crew owner).

DO $sim$
DECLARE
  v_crew uuid := 'bd455653-0fdb-4a6d-b79c-507b09343f9e'; -- <<< REPLACE with your crews.id
  v_trip_date date := (CURRENT_DATE - 1);                 -- <<< change if row already exists
  v_driver uuid := NULL;                                  -- NULL = use crew owner as driver

  v_name text;
  v_pattern text;
  v_dist double precision;
  v_dur integer;
  v_inst uuid;
  v_contrib integer;
  v_uid uuid;
  v_fee integer;
  v_debit integer;
  v_riders uuid[] := '{}';
  v_sum integer := 0;
  v_total_fee integer := 0;
  v_route_label text;
  v_json jsonb;
  v_rider jsonb := '[]'::jsonb;
  v_rn text;
BEGIN
  IF v_crew = 'bd455653-0fdb-4a6d-b79c-507b09343f9e'::uuid THEN
    RAISE EXCEPTION 'Set v_crew to your crew uuid (select id, name from crews;)';
  END IF;

  SELECT name, commute_pattern, locked_route_distance_m, locked_route_duration_s
  INTO v_name, v_pattern, v_dist, v_dur
  FROM public.crews
  WHERE id = v_crew;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'crew not found';
  END IF;

  IF v_driver IS NULL THEN
    SELECT cm.user_id INTO v_driver
    FROM public.crew_members cm
    WHERE cm.crew_id = v_crew AND cm.role = 'owner'
    LIMIT 1;
  END IF;

  IF v_driver IS NULL THEN
    SELECT cm.user_id INTO v_driver
    FROM public.crew_members cm
    WHERE cm.crew_id = v_crew
    ORDER BY cm.joined_at
    LIMIT 1;
  END IF;

  SELECT array_agg(cm.user_id ORDER BY cm.joined_at)
  INTO v_riders
  FROM public.crew_members cm
  WHERE cm.crew_id = v_crew AND cm.user_id IS DISTINCT FROM v_driver;

  IF v_riders IS NULL OR cardinality(v_riders) < 1 THEN
    RAISE EXCEPTION 'Need at least one rider (member other than driver).';
  END IF;

  IF v_dist IS NULL OR v_dist <= 0 THEN
    RAISE EXCEPTION 'crew.locked_route_distance_m missing; lock formation route first.';
  END IF;

  v_contrib := public.poolyn_crew_equal_corridor_rider_contribution_cents(
    v_dist,
    COALESCE(v_dur, 0),
    cardinality(v_riders),
    'sedan'
  );

  v_route_label := CASE COALESCE(v_pattern, 'to_work')
    WHEN 'to_home' THEN 'Work → Home'
    WHEN 'round_trip' THEN 'Crew commute (round trip)'
    ELSE 'Home → Work'
  END;

  INSERT INTO public.crew_trip_instances (
    crew_id,
    trip_date,
    designated_driver_user_id,
    excluded_pickup_user_ids,
    trip_started_at,
    trip_finished_at,
    poolyn_credits_settled_at,
    settlement_summary
  )
  VALUES (
    v_crew,
    v_trip_date,
    v_driver,
    '{}',
    now() - interval '3 hours',
    now() - interval '1 hour',
    now(),
    '{}'::jsonb
  )
  ON CONFLICT (crew_id, trip_date) DO NOTHING;

  SELECT cti.id INTO v_inst
  FROM public.crew_trip_instances cti
  WHERE cti.crew_id = v_crew AND cti.trip_date = v_trip_date;

  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Could not create or read crew_trip_instances row';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.commute_credits_ledger l
    WHERE l.reference_type = 'crew_trip_instance' AND l.reference_id = v_inst
  ) THEN
    RAISE EXCEPTION 'Ledger already has rows for this instance; pick another v_trip_date or delete those rows and fix balances.';
  END IF;

  FOREACH v_uid IN ARRAY v_riders
  LOOP
    v_fee := CASE WHEN public.is_user_org_member(v_uid) THEN 0
      ELSE (ROUND(v_contrib::numeric * 0.04))::integer END;
    v_debit := v_contrib + v_fee;
    IF (SELECT commute_credits_balance FROM public.users WHERE id = v_uid) < v_debit THEN
      RAISE EXCEPTION 'User % needs % credits (has %). Top up commute_credits_balance first or lower v_trip_date re-run after adjusting.',
        v_uid, v_debit, (SELECT commute_credits_balance FROM public.users WHERE id = v_uid);
    END IF;
  END LOOP;

  FOREACH v_uid IN ARRAY v_riders
  LOOP
    v_fee := CASE WHEN public.is_user_org_member(v_uid) THEN 0
      ELSE (ROUND(v_contrib::numeric * 0.04))::integer END;
    v_debit := v_contrib + v_fee;
    v_sum := v_sum + v_contrib;
    v_total_fee := v_total_fee + v_fee;

    SELECT COALESCE(NULLIF(trim(full_name), ''), 'Poolyn member') INTO v_rn FROM public.users WHERE id = v_uid;

    v_rider := v_rider || jsonb_build_array(jsonb_build_object(
      'user_id', v_uid,
      'full_name', v_rn,
      'credits_contribution', v_contrib,
      'credits_crew_admin_fee', v_fee,
      'credits_total_debited', v_debit,
      'is_org_member', public.is_user_org_member(v_uid)
    ));

    INSERT INTO public.commute_credits_ledger (
      user_id, delta, balance_after, txn_type, reference_type, reference_id, description
    ) VALUES (
      v_uid,
      -v_debit,
      0,
      'credit_used',
      'crew_trip_instance',
      v_inst,
      format('Crew Poolyn · %s · %s (simulated)', v_name, v_route_label)
    );
  END LOOP;

  IF v_sum > 0 THEN
    INSERT INTO public.commute_credits_ledger (
      user_id, delta, balance_after, txn_type, reference_type, reference_id, description
    ) VALUES (
      v_driver,
      v_sum,
      0,
      'credit_earned',
      'crew_trip_instance',
      v_inst,
      format('Crew Poolyn driver · %s · %s (simulated)', v_name, v_route_label)
    );
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), 'Poolyn member') INTO v_rn FROM public.users WHERE id = v_driver;

  v_json := jsonb_build_object(
    'crew_name', v_name,
    'trip_date', v_trip_date,
    'route_label', v_route_label,
    'commute_pattern', v_pattern,
    'distance_km', CASE WHEN v_dist > 0 THEN round((v_dist / 1000.0)::numeric, 1) ELSE NULL END,
    'duration_mins', CASE WHEN v_dur > 0 THEN (v_dur + 30) / 60 ELSE NULL END,
    'contribution_credits_per_rider', v_contrib,
    'crew_explorer_admin_fee_rate', 0.04,
    'riders', v_rider,
    'driver_user_id', v_driver,
    'driver_full_name', v_rn,
    'driver_credits_earned', v_sum,
    'total_crew_admin_credits_from_explorers', v_total_fee,
    'finished_at', to_jsonb(now()),
    'simulated', true
  );

  UPDATE public.crew_trip_instances
  SET settlement_summary = v_json,
      updated_at = now()
  WHERE id = v_inst;

  RAISE NOTICE 'Done. instance_id=% contribution_each=% riders=%', v_inst, v_contrib, cardinality(v_riders);
END;
$sim$;
