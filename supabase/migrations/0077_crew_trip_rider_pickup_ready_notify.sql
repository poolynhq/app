-- Crew Poolyn: who started the trip (for rider notify + ack rules), per-rider "ready for pickup" acks, and
-- in-app notifications to pickup riders when the driver starts.

ALTER TABLE public.crew_trip_instances
  ADD COLUMN IF NOT EXISTS trip_started_by_user_id uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS rider_pickup_ready_at jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.crew_trip_instances.trip_started_by_user_id IS
  'User who first recorded trip start (poolyn_crew_trip_record_started). Used when notifying riders if designated driver is unset.';
COMMENT ON COLUMN public.crew_trip_instances.rider_pickup_ready_at IS
  'JSON object: user_id (text) -> ISO timestamp when that rider acknowledged ready for pickup after trip start.';

-- Best-effort backfill for instances that already started with a designated driver.
UPDATE public.crew_trip_instances cti
SET trip_started_by_user_id = cti.designated_driver_user_id
WHERE cti.trip_started_by_user_id IS NULL
  AND cti.designated_driver_user_id IS NOT NULL
  AND cti.trip_started_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.poolyn_crew_trip_record_started(p_trip_instance_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_started timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id, cti.trip_started_at
  INTO v_crew_id, v_started
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_started IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'idempotent', true, 'trip_started_at', v_started);
  END IF;

  UPDATE public.crew_trip_instances
  SET
    trip_started_at = now(),
    trip_started_by_user_id = v_uid,
    rider_pickup_ready_at = '{}'::jsonb,
    updated_at = now()
  WHERE id = p_trip_instance_id
    AND trip_started_at IS NULL;

  SELECT trip_started_at INTO v_started
  FROM public.crew_trip_instances
  WHERE id = p_trip_instance_id;

  RETURN json_build_object('ok', true, 'idempotent', false, 'trip_started_at', v_started);
END;
$$;

-- ---------------------------------------------------------------------------
-- Notify pickup riders (in-app row; webhook to Expo push if configured)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_crew_riders_trip_started()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_label text;
BEGIN
  IF OLD.trip_started_at IS NOT NULL OR NEW.trip_started_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(u.full_name), ''), 'Driver')
  INTO v_label
  FROM public.users u
  WHERE u.id = COALESCE(NEW.designated_driver_user_id, NEW.trip_started_by_user_id)
  LIMIT 1;

  IF v_label IS NULL THEN
    v_label := 'Driver';
  END IF;

  FOR r IN
    SELECT cm.user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = NEW.crew_id
      AND NOT (cm.user_id = ANY (COALESCE(NEW.excluded_pickup_user_ids, ARRAY[]::uuid[])))
      AND (
        (NEW.designated_driver_user_id IS NOT NULL AND cm.user_id <> NEW.designated_driver_user_id)
        OR (
          NEW.designated_driver_user_id IS NULL
          AND NEW.trip_started_by_user_id IS NOT NULL
          AND cm.user_id <> NEW.trip_started_by_user_id
        )
        OR (NEW.designated_driver_user_id IS NULL AND NEW.trip_started_by_user_id IS NULL)
      )
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.user_id,
      'crew_trip_driver_started',
      'Crew trip started',
      v_label || ' started your crew trip. Open Poolyn and tap I am ready when you want pickup.',
      jsonb_build_object('trip_instance_id', NEW.id, 'crew_id', NEW.crew_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_trip_instances_notify_riders_on_start ON public.crew_trip_instances;
CREATE TRIGGER crew_trip_instances_notify_riders_on_start
  AFTER UPDATE OF trip_started_at ON public.crew_trip_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_crew_riders_trip_started();

-- ---------------------------------------------------------------------------
-- poolyn_crew_trip_ack_pickup_ready
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_crew_trip_ack_pickup_ready(p_trip_instance_id uuid)
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
  v_driver uuid;
  v_starter uuid;
  v_excl uuid[];
  v_driverish uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT
    cti.crew_id,
    cti.trip_started_at,
    cti.trip_finished_at,
    cti.designated_driver_user_id,
    cti.trip_started_by_user_id,
    cti.excluded_pickup_user_ids
  INTO v_crew_id, v_started, v_finished, v_driver, v_starter, v_excl
  FROM public.crew_trip_instances cti
  WHERE cti.id = p_trip_instance_id;

  IF v_crew_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF NOT public.poolyn_user_in_crew(v_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF v_started IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_not_started');
  END IF;

  IF v_finished IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'trip_finished');
  END IF;

  IF v_uid = ANY (COALESCE(v_excl, ARRAY[]::uuid[])) THEN
    RETURN json_build_object('ok', false, 'reason', 'excluded_from_pickup');
  END IF;

  v_driverish := COALESCE(v_driver, v_starter);
  IF v_driverish IS NOT NULL AND v_uid = v_driverish THEN
    RETURN json_build_object('ok', false, 'reason', 'driver_no_ack');
  END IF;

  IF v_driverish IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'ack_unavailable');
  END IF;

  UPDATE public.crew_trip_instances
  SET
    rider_pickup_ready_at =
      COALESCE(rider_pickup_ready_at, '{}'::jsonb)
      || jsonb_build_object(v_uid::text, to_jsonb(now())),
    updated_at = now()
  WHERE id = p_trip_instance_id;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_trip_ack_pickup_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_trip_ack_pickup_ready(uuid) TO authenticated;

-- Realtime: riders and driver see ack updates without manual refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crew_trip_instances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crew_trip_instances;
  END IF;
END $$;
