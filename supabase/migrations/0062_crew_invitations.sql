-- In-app crew invites (accept / decline). Inserts use RLS; respond via SECURITY DEFINER RPC.

CREATE TABLE IF NOT EXISTS public.crew_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id uuid NOT NULL REFERENCES public.crews (id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  invited_by_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT crew_invitations_no_self CHECK (invited_user_id IS DISTINCT FROM invited_by_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS crew_invitations_one_pending_per_target
  ON public.crew_invitations (crew_id, invited_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS crew_invitations_invited_user_pending
  ON public.crew_invitations (invited_user_id)
  WHERE status = 'pending';

ALTER TABLE public.crew_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crew_invitations_select ON public.crew_invitations;
CREATE POLICY crew_invitations_select
  ON public.crew_invitations FOR SELECT TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR invited_by_user_id = auth.uid()
    OR public.poolyn_user_in_crew(crew_id, auth.uid())
  );

DROP POLICY IF EXISTS crew_invitations_insert_member ON public.crew_invitations;
CREATE POLICY crew_invitations_insert_member
  ON public.crew_invitations FOR INSERT TO authenticated
  WITH CHECK (
    invited_by_user_id = auth.uid()
    AND invited_user_id <> auth.uid()
    AND public.poolyn_user_in_crew(crew_id, auth.uid())
  );

DROP POLICY IF EXISTS crew_invitations_update_cancel_by_inviter ON public.crew_invitations;
CREATE POLICY crew_invitations_update_cancel_by_inviter
  ON public.crew_invitations FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND invited_by_user_id = auth.uid()
    AND public.poolyn_user_in_crew(crew_id, auth.uid())
  )
  WITH CHECK (
    status = 'cancelled'
    AND invited_by_user_id = auth.uid()
  );

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

REVOKE ALL ON FUNCTION public.poolyn_respond_crew_invitation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_respond_crew_invitation(uuid, boolean) TO authenticated;
