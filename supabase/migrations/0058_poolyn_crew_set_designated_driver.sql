-- Allow crew members to set today's designated driver (not only random dice).

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
    COALESCE(_name, 'A crew member') || ' is today''s driver — they lead coordination in this chat for the day.',
    'system',
    jsonb_build_object('designated_driver_user_id', p_driver_user_id, 'set_by', _uid)
  );

  RETURN json_build_object('ok', true, 'designated_driver_user_id', p_driver_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_set_designated_driver(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_set_designated_driver(uuid, uuid) TO authenticated;
