-- Allow any crew member to refresh the shared schedule snapshot after driver change (RLS on crews UPDATE is owner-only).

CREATE OR REPLACE FUNCTION public.poolyn_crew_update_schedule_snapshot(
  p_crew_id uuid,
  p_schedule_mode text,
  p_schedule_anchor_minutes integer,
  p_estimated_pool_drive_minutes integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT public.poolyn_user_in_crew(p_crew_id, v_uid) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_in_crew');
  END IF;

  IF p_schedule_mode IS NULL OR p_schedule_mode NOT IN ('arrival', 'start') THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_schedule_mode');
  END IF;

  IF p_schedule_anchor_minutes IS NULL OR p_schedule_anchor_minutes < 0 OR p_schedule_anchor_minutes >= 1440 THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_anchor_minutes');
  END IF;

  IF p_estimated_pool_drive_minutes IS NULL OR p_estimated_pool_drive_minutes < 1 OR p_estimated_pool_drive_minutes > 600 THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_estimated_drive');
  END IF;

  UPDATE public.crews
  SET
    schedule_mode = p_schedule_mode,
    schedule_anchor_minutes = p_schedule_anchor_minutes,
    estimated_pool_drive_minutes = p_estimated_pool_drive_minutes
  WHERE id = p_crew_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'crew_not_found');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_update_schedule_snapshot(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_update_schedule_snapshot(uuid, text, integer, integer) TO authenticated;
