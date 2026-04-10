-- Up to 3 crews per user (join + invite accept). Replace one-crew checks from 0063.
-- Crew sticker storage: avoid storage.foldername() in RLS (can break some Storage builds — see 0021 avatars).

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
  _crew_count int;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members cm
    WHERE cm.user_id = _uid AND cm.crew_id = _crew.id
  ) THEN
    SELECT COUNT(DISTINCT cm.crew_id)::int INTO _crew_count
    FROM public.crew_members cm
    WHERE cm.user_id = _uid;
    IF _crew_count >= 3 THEN
      RETURN json_build_object('ok', false, 'reason', 'too_many_crews');
    END IF;
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
  _crew_count int;
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
    IF NOT EXISTS (
      SELECT 1 FROM public.crew_members cm
      WHERE cm.user_id = _uid AND cm.crew_id = r.crew_id
    ) THEN
      SELECT COUNT(DISTINCT cm.crew_id)::int INTO _crew_count
      FROM public.crew_members cm
      WHERE cm.user_id = _uid;
      IF _crew_count >= 3 THEN
        RETURN json_build_object('ok', false, 'reason', 'too_many_crews');
      END IF;
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

DROP POLICY IF EXISTS "Crew owners upload crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew owners update crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew owners delete crew sticker" ON storage.objects;
DROP POLICY IF EXISTS "Crew sticker images are publicly readable" ON storage.objects;

CREATE POLICY "Crew owners upload crew sticker"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(ltrim(name, '/'), '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew owners update crew sticker"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(ltrim(name, '/'), '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  )
  WITH CHECK (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(ltrim(name, '/'), '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew owners delete crew sticker"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'crew-stickers'
    AND EXISTS (
      SELECT 1
      FROM public.crew_members cm
      WHERE cm.crew_id = split_part(ltrim(name, '/'), '/', 1)::uuid
        AND cm.user_id = auth.uid()
        AND cm.role = 'owner'
    )
  );

CREATE POLICY "Crew sticker images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crew-stickers');
