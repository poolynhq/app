-- Collaborative driver spin session (crew chat): shared pool, server randomness, realtime sync.
-- Idempotent: remote DBs may already have this table from a manual or partial apply.

CREATE TABLE IF NOT EXISTS public.crew_driver_spin_sessions (
  crew_trip_instance_id uuid PRIMARY KEY REFERENCES public.crew_trip_instances (id) ON DELETE CASCADE,
  opened_by_user_id uuid NOT NULL REFERENCES public.users (id),
  pool_user_ids uuid[] NOT NULL,
  phase text NOT NULL CHECK (phase IN ('open', 'completed')),
  winner_user_id uuid REFERENCES public.users (id),
  winner_index integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crew_driver_spin_sessions IS
  'Ephemeral shared state for the crew chat driver wheel; replaced on each new open.';

CREATE INDEX IF NOT EXISTS idx_crew_driver_spin_sessions_updated ON public.crew_driver_spin_sessions (updated_at DESC);

ALTER TABLE public.crew_driver_spin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Crew members can read spin session for their trip" ON public.crew_driver_spin_sessions;
CREATE POLICY "Crew members can read spin session for their trip"
  ON public.crew_driver_spin_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.crew_trip_instances cti
      JOIN public.crew_members cm ON cm.crew_id = cti.crew_id AND cm.user_id = auth.uid()
      WHERE cti.id = crew_driver_spin_sessions.crew_trip_instance_id
    )
  );

-- ---------------------------------------------------------------------------
-- Notify other crew members when today's driver is set (in-app + Expo push webhook)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_crew_set_designated_driver(
  p_trip_instance_id uuid,
  p_driver_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _crew_id uuid;
  _name text;
BEGIN
  IF _uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id INTO _crew_id
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF _crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members cm
    WHERE cm.crew_id = _crew_id AND cm.user_id = _uid
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members cm
    WHERE cm.crew_id = _crew_id AND cm.user_id = p_driver_user_id
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'driver_not_in_crew');
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULL) INTO _name FROM public.users WHERE id = p_driver_user_id;

  UPDATE public.crew_trip_instances
  SET designated_driver_user_id = p_driver_user_id,
      updated_at = now()
  WHERE id = p_trip_instance_id;

  INSERT INTO public.crew_messages (crew_trip_instance_id, sender_id, body, kind, meta)
  VALUES (
    p_trip_instance_id,
    NULL,
    COALESCE(_name, 'A crew member') || ' is today''s driver. They lead coordination in this chat for the day.',
    'system',
    jsonb_build_object('designated_driver_user_id', p_driver_user_id, 'set_by', _uid)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    cm.user_id,
    'crew_designated_driver',
    'Today''s driver',
    COALESCE(_name, 'A crew member') || ' is today''s driver. Open crew chat for pickup order and timing.',
    jsonb_build_object(
      'trip_instance_id', p_trip_instance_id,
      'crew_id', _crew_id,
      'designated_driver_user_id', p_driver_user_id
    )
  FROM public.crew_members cm
  WHERE cm.crew_id = _crew_id
    AND cm.user_id IS DISTINCT FROM p_driver_user_id;

  RETURN json_build_object('ok', true, 'designated_driver_user_id', p_driver_user_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Spin session RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_crew_driver_spin_open(
  p_trip_instance_id uuid,
  p_initial_pool uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_started timestamptz;
  v_finished timestamptz;
  v_distinct int;
  v_m uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_initial_pool IS NULL OR array_length(p_initial_pool, 1) < 2 THEN
    RETURN json_build_object('ok', false, 'reason', 'pool_too_small');
  END IF;

  SELECT COUNT(DISTINCT x) INTO v_distinct FROM unnest(p_initial_pool) AS x;
  IF v_distinct <> array_length(p_initial_pool, 1) THEN
    RETURN json_build_object('ok', false, 'reason', 'duplicate_pool_ids');
  END IF;

  SELECT cti.crew_id, cti.trip_started_at, cti.trip_finished_at
  INTO v_crew_id, v_started, v_finished
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_started IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_already_started');
  END IF;

  IF v_finished IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_already_finished');
  END IF;

  FOREACH v_m IN ARRAY p_initial_pool
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = v_crew_id AND cm.user_id = v_m
    ) THEN
      RETURN json_build_object('ok', false, 'reason', 'pool_user_not_in_crew');
    END IF;
  END LOOP;

  INSERT INTO public.crew_driver_spin_sessions (
    crew_trip_instance_id,
    opened_by_user_id,
    pool_user_ids,
    phase,
    winner_user_id,
    winner_index,
    updated_at
  )
  VALUES (
    p_trip_instance_id,
    v_uid,
    p_initial_pool,
    'open',
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (crew_trip_instance_id) DO UPDATE SET
    opened_by_user_id = EXCLUDED.opened_by_user_id,
    pool_user_ids = EXCLUDED.pool_user_ids,
    phase = 'open',
    winner_user_id = NULL,
    winner_index = NULL,
    updated_at = now();

  RETURN json_build_object(
    'ok', true,
    'opened_by_user_id', v_uid,
    'pool_user_ids', p_initial_pool
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.poolyn_crew_driver_spin_toggle(
  p_trip_instance_id uuid,
  p_add boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_started timestamptz;
  v_finished timestamptz;
  v_pool uuid[];
  v_phase text;
  v_len int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id, cti.trip_started_at, cti.trip_finished_at
  INTO v_crew_id, v_started, v_finished
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_started IS NOT NULL OR v_finished IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_active_for_spin');
  END IF;

  SELECT s.pool_user_ids, s.phase
  INTO v_pool, v_phase
  FROM public.crew_driver_spin_sessions s
  WHERE s.crew_trip_instance_id = p_trip_instance_id;

  IF v_pool IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_active_session');
  END IF;

  IF v_phase IS DISTINCT FROM 'open' THEN
    RETURN json_build_object('ok', false, 'reason', 'session_not_open');
  END IF;

  IF p_add THEN
    IF v_uid = ANY (v_pool) THEN
      RETURN json_build_object('ok', true, 'pool_user_ids', v_pool);
    END IF;
    v_pool := array_append(v_pool, v_uid);
  ELSE
    IF NOT (v_uid = ANY (v_pool)) THEN
      RETURN json_build_object('ok', true, 'pool_user_ids', v_pool);
    END IF;
    v_pool := array_remove(v_pool, v_uid);
    v_len := coalesce(array_length(v_pool, 1), 0);
    IF v_len < 2 THEN
      RETURN json_build_object('ok', false, 'reason', 'pool_min_two');
    END IF;
  END IF;

  UPDATE public.crew_driver_spin_sessions
  SET pool_user_ids = v_pool,
      updated_at = now()
  WHERE crew_trip_instance_id = p_trip_instance_id;

  RETURN json_build_object('ok', true, 'pool_user_ids', v_pool);
END;
$$;

CREATE OR REPLACE FUNCTION public.poolyn_crew_driver_spin_execute(
  p_trip_instance_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_started timestamptz;
  v_finished timestamptz;
  v_opener uuid;
  v_pool uuid[];
  v_phase text;
  v_n int;
  v_widx int;
  v_winner uuid;
  v_res json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id, cti.trip_started_at, cti.trip_finished_at
  INTO v_crew_id, v_started, v_finished
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_started IS NOT NULL OR v_finished IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_active_for_spin');
  END IF;

  SELECT opened_by_user_id, pool_user_ids, phase
  INTO v_opener, v_pool, v_phase
  FROM public.crew_driver_spin_sessions
  WHERE crew_trip_instance_id = p_trip_instance_id;

  IF v_opener IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_active_session');
  END IF;

  IF v_phase IS DISTINCT FROM 'open' THEN
    RETURN json_build_object('ok', false, 'reason', 'session_not_open');
  END IF;

  IF v_uid IS DISTINCT FROM v_opener THEN
    RETURN json_build_object('ok', false, 'reason', 'only_opener_can_spin');
  END IF;

  v_n := array_length(v_pool, 1);
  IF v_n IS NULL OR v_n < 2 THEN
    RETURN json_build_object('ok', false, 'reason', 'pool_too_small');
  END IF;

  v_widx := floor(random() * v_n)::int;
  IF v_widx < 0 THEN
    v_widx := 0;
  END IF;
  IF v_widx >= v_n THEN
    v_widx := v_n - 1;
  END IF;
  v_winner := v_pool[v_widx + 1];

  SELECT public.poolyn_crew_set_designated_driver(p_trip_instance_id, v_winner) INTO v_res;
  IF (v_res->>'ok') IS DISTINCT FROM 'true' THEN
    RETURN v_res;
  END IF;

  UPDATE public.crew_driver_spin_sessions
  SET
    phase = 'completed',
    winner_user_id = v_winner,
    winner_index = v_widx,
    updated_at = now()
  WHERE crew_trip_instance_id = p_trip_instance_id;

  RETURN json_build_object(
    'ok', true,
    'winner_user_id', v_winner,
    'winner_index', v_widx,
    'designated_driver_user_id', v_winner
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.poolyn_crew_driver_spin_abandon(
  p_trip_instance_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id INTO v_crew_id
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  DELETE FROM public.crew_driver_spin_sessions
  WHERE crew_trip_instance_id = p_trip_instance_id
    AND phase = 'open';

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_set_designated_driver(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_set_designated_driver(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_crew_driver_spin_open(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_driver_spin_open(uuid, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_crew_driver_spin_toggle(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_driver_spin_toggle(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_crew_driver_spin_execute(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_driver_spin_execute(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_crew_driver_spin_abandon(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_driver_spin_abandon(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crew_driver_spin_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crew_driver_spin_sessions;
  END IF;
END $$;
