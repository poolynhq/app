-- Default today's driver to the crew owner on each new calendar-day trip row, and only allow that
-- designated driver to record the first trip start (resume/idempotent start unchanged).

CREATE OR REPLACE FUNCTION public.poolyn_crew_trip_instances_set_default_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.designated_driver_user_id IS NULL THEN
    SELECT cm.user_id INTO NEW.designated_driver_user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = NEW.crew_id AND cm.role = 'owner'
    ORDER BY cm.joined_at ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_trip_instances_default_driver_bi ON public.crew_trip_instances;
CREATE TRIGGER crew_trip_instances_default_driver_bi
  BEFORE INSERT ON public.crew_trip_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.poolyn_crew_trip_instances_set_default_driver();

-- Backfill: prefer trip starter when the run already started; otherwise crew owner.
UPDATE public.crew_trip_instances cti
SET designated_driver_user_id = COALESCE(
  cti.trip_started_by_user_id,
  (
    SELECT cm.user_id
    FROM public.crew_members cm
    WHERE cm.crew_id = cti.crew_id AND cm.role = 'owner'
    ORDER BY cm.joined_at ASC
    LIMIT 1
  )
)
WHERE cti.designated_driver_user_id IS NULL;

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
  v_designated uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT cti.crew_id, cti.trip_started_at, cti.designated_driver_user_id
  INTO v_crew_id, v_started, v_designated
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

  IF v_designated IS NOT NULL AND v_designated <> v_uid THEN
    RETURN json_build_object('ok', false, 'reason', 'not_todays_driver');
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

REVOKE ALL ON FUNCTION public.poolyn_crew_trip_record_started(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_trip_record_started(uuid) TO authenticated;
