-- One crew per user (simpler product). Join / invite-accept blocked if already in another crew.
-- Dice roll: optional eligible member list (subset of crew).

CREATE OR REPLACE FUNCTION public.poolyn_join_crew(p_invite_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _crew public.crews;
  _code text := lower(trim(p_invite_code));
BEGIN
  IF _uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF _code IS NULL OR _code = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT * INTO _crew FROM public.crews WHERE invite_code = _code LIMIT 1;
  IF _crew.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'crew_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crew_members cm
    WHERE cm.user_id = _uid
      AND cm.crew_id IS DISTINCT FROM _crew.id
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'already_in_crew');
  END IF;

  IF _crew.org_id IS NOT NULL AND _crew.org_id IS DISTINCT FROM (
    SELECT org_id FROM public.users WHERE id = _uid
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'org_mismatch');
  END IF;

  INSERT INTO public.crew_members (crew_id, user_id, role)
  VALUES (_crew.id, _uid, 'member')
  ON CONFLICT (crew_id, user_id) DO NOTHING;

  RETURN json_build_object('ok', true, 'crew_id', _crew.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.poolyn_respond_crew_invitation(p_invitation_id uuid, p_accept boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  r public.crew_invitations%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO r FROM public.crew_invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF r.invited_user_id IS DISTINCT FROM _uid THEN
    RETURN json_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN json_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  IF p_accept THEN
    IF EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.user_id = _uid
        AND cm.crew_id IS DISTINCT FROM r.crew_id
    ) THEN
      RETURN json_build_object('ok', false, 'reason', 'already_in_crew');
    END IF;
    INSERT INTO public.crew_members (crew_id, user_id, role)
    VALUES (r.crew_id, _uid, 'member')
    ON CONFLICT (crew_id, user_id) DO NOTHING;
    UPDATE public.crew_invitations
    SET status = 'accepted', responded_at = now()
    WHERE id = p_invitation_id;
  ELSE
    UPDATE public.crew_invitations
    SET status = 'declined', responded_at = now()
    WHERE id = p_invitation_id;
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

DROP FUNCTION IF EXISTS public.poolyn_crew_roll_driver(uuid);

CREATE OR REPLACE FUNCTION public.poolyn_crew_roll_driver(
  p_trip_instance_id uuid,
  p_eligible_user_ids uuid[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _crew_id uuid;
  _picked uuid;
  _name text;
  _pool int;
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

  IF p_eligible_user_ids IS NOT NULL AND cardinality(p_eligible_user_ids) > 0 THEN
    SELECT cm.user_id INTO _picked
    FROM public.crew_members cm
    WHERE cm.crew_id = _crew_id
      AND cm.user_id = ANY (p_eligible_user_ids)
    ORDER BY random()
    LIMIT 1;
    SELECT COUNT(*)::int INTO _pool
    FROM public.crew_members cm
    WHERE cm.crew_id = _crew_id
      AND cm.user_id = ANY (p_eligible_user_ids);
  ELSE
    SELECT cm.user_id INTO _picked
    FROM public.crew_members cm
    WHERE cm.crew_id = _crew_id
    ORDER BY random()
    LIMIT 1;
    SELECT COUNT(*)::int INTO _pool FROM public.crew_members cm WHERE cm.crew_id = _crew_id;
  END IF;

  IF _picked IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_eligible_members');
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULL) INTO _name FROM public.users WHERE id = _picked;

  UPDATE public.crew_trip_instances
  SET designated_driver_user_id = _picked,
      updated_at = now()
  WHERE id = p_trip_instance_id;

  INSERT INTO public.crew_messages (crew_trip_instance_id, sender_id, body, kind, meta)
  VALUES (
    p_trip_instance_id,
    NULL,
    'Poolyn rolled the dice among ' || _pool || ' people in today''s pool for driver.',
    'dice',
    jsonb_build_object('picked_user_id', _picked, 'rolled_by', _uid, 'pool_size', _pool)
  );

  INSERT INTO public.crew_messages (crew_trip_instance_id, sender_id, body, kind, meta)
  VALUES (
    p_trip_instance_id,
    NULL,
    COALESCE(_name, 'A crew member') || ' is today''s driver — they lead coordination in this chat for the day.',
    'system',
    jsonb_build_object('designated_driver_user_id', _picked)
  );

  RETURN json_build_object('ok', true, 'designated_driver_user_id', _picked);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_crew_roll_driver(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_roll_driver(uuid, uuid[]) TO authenticated;
