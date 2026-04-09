-- Poolyn Crews: per calendar-day trip instance chat; dice picks "driver of the day" (chat admin for coordination).
-- Idempotent: safe if objects already exist (e.g. partial apply or manual create).

CREATE TABLE IF NOT EXISTS public.crews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  org_id       uuid REFERENCES public.organisations (id) ON DELETE SET NULL,
  created_by   uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  invite_code  text NOT NULL UNIQUE DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crews_name_nonempty CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_crews_org ON public.crews (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crews_created_by ON public.crews (created_by);

CREATE TABLE IF NOT EXISTS public.crew_members (
  crew_id   uuid NOT NULL REFERENCES public.crews (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crew_members_user ON public.crew_members (user_id);

CREATE TABLE IF NOT EXISTS public.crew_trip_instances (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id                    uuid NOT NULL REFERENCES public.crews (id) ON DELETE CASCADE,
  trip_date                  date NOT NULL,
  designated_driver_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crew_id, trip_date)
);

CREATE INDEX IF NOT EXISTS idx_crew_trip_instances_crew_date ON public.crew_trip_instances (crew_id, trip_date DESC);

CREATE TABLE IF NOT EXISTS public.crew_messages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_trip_instance_id   uuid NOT NULL REFERENCES public.crew_trip_instances (id) ON DELETE CASCADE,
  sender_id               uuid REFERENCES public.users (id) ON DELETE SET NULL,
  body                    text NOT NULL,
  kind                    text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'system', 'dice')),
  meta                    jsonb NOT NULL DEFAULT '{}',
  sent_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_messages_user_kind_sender CHECK (
    (kind = 'user' AND sender_id IS NOT NULL)
    OR (kind IN ('system', 'dice') AND sender_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_crew_messages_trip_sent ON public.crew_messages (crew_trip_instance_id, sent_at);

ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_trip_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS: crews
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS crews_select_member ON public.crews;
CREATE POLICY crews_select_member
  ON public.crews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = crews.id AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crews_insert_authenticated ON public.crews;
CREATE POLICY crews_insert_authenticated
  ON public.crews FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      org_id IS NULL
      OR org_id = public.current_user_org_id()
    )
  );

DROP POLICY IF EXISTS crews_update_owner ON public.crews;
CREATE POLICY crews_update_owner
  ON public.crews FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = crews.id
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = crews.id
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE OR REPLACE FUNCTION public.crews_enforce_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.invite_code IS DISTINCT FROM OLD.invite_code
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
  THEN
    RAISE EXCEPTION 'cannot_change_immutable_crew_fields';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crews_immutable ON public.crews;
CREATE TRIGGER crews_immutable
  BEFORE UPDATE ON public.crews
  FOR EACH ROW
  EXECUTE FUNCTION public.crews_enforce_immutable_fields();

-- ---------------------------------------------------------------------------
-- RLS: crew_members
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS crew_members_select_same_crew ON public.crew_members;
CREATE POLICY crew_members_select_same_crew
  ON public.crew_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = crew_members.crew_id AND cm.user_id = auth.uid()
    )
  );

-- Only the person who just created the crew may insert the initial owner row; all other joins use poolyn_join_crew (SECURITY DEFINER).
DROP POLICY IF EXISTS crew_members_insert_creator_owner ON public.crew_members;
CREATE POLICY crew_members_insert_creator_owner
  ON public.crew_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.crews c
      WHERE c.id = crew_members.crew_id
        AND c.created_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: crew_trip_instances
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS crew_trip_instances_select_member ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_select_member
  ON public.crew_trip_instances FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = crew_trip_instances.crew_id AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crew_trip_instances_insert_member ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_insert_member
  ON public.crew_trip_instances FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.crew_id = crew_trip_instances.crew_id AND cm.user_id = auth.uid()
    )
  );

-- Driver designation only via poolyn_crew_roll_driver (SECURITY DEFINER).

DROP POLICY IF EXISTS crew_trip_instances_update_none ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_update_none
  ON public.crew_trip_instances FOR UPDATE TO authenticated
  USING (false);

-- ---------------------------------------------------------------------------
-- RLS: crew_messages
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS crew_messages_select_member ON public.crew_messages;
CREATE POLICY crew_messages_select_member
  ON public.crew_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crew_trip_instances cti
      JOIN public.crew_members cm ON cm.crew_id = cti.crew_id
      WHERE cti.id = crew_messages.crew_trip_instance_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crew_messages_insert_user_text ON public.crew_messages;
CREATE POLICY crew_messages_insert_user_text
  ON public.crew_messages FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'user'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.crew_trip_instances cti
      JOIN public.crew_members cm ON cm.crew_id = cti.crew_id
      WHERE cti.id = crew_trip_instance_id
        AND cm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Co-crew profile visibility (names in chat)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Crew members can view co-member profiles" ON public.users;
CREATE POLICY "Crew members can view co-member profiles"
  ON public.users FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crew_members cm1
      JOIN public.crew_members cm2 ON cm2.crew_id = cm1.crew_id
      WHERE cm1.user_id = auth.uid()
        AND cm2.user_id = users.id
    )
  );

-- ---------------------------------------------------------------------------
-- Join crew by invite code
-- ---------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.poolyn_join_crew(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_join_crew(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Roll dice: pick random member as designated driver; system + dice messages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_crew_roll_driver(p_trip_instance_id uuid)
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

  SELECT cm.user_id INTO _picked
  FROM public.crew_members cm
  WHERE cm.crew_id = _crew_id
  ORDER BY random()
  LIMIT 1;

  IF _picked IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_members');
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
    'Poolyn rolled the dice for today''s driver.',
    'dice',
    jsonb_build_object('picked_user_id', _picked, 'rolled_by', _uid)
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

REVOKE ALL ON FUNCTION public.poolyn_crew_roll_driver(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_roll_driver(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crew_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crew_messages;
  END IF;
END $$;
