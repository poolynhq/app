-- crew_members SELECT policy referenced crew_members inside itself → infinite recursion (500 from PostgREST).
-- Use SECURITY DEFINER helpers so membership checks do not re-enter crew_members RLS.

CREATE OR REPLACE FUNCTION public.poolyn_user_in_crew(p_crew_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crew_members cm
    WHERE cm.crew_id = p_crew_id
      AND cm.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.poolyn_user_is_crew_owner(p_crew_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crew_members cm
    WHERE cm.crew_id = p_crew_id
      AND cm.user_id = p_user_id
      AND cm.role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.poolyn_user_in_crew(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_user_in_crew(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.poolyn_user_is_crew_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_user_is_crew_owner(uuid, uuid) TO authenticated;

-- crews: creator can read row immediately after INSERT (before crew_members row exists for RETURNING).
DROP POLICY IF EXISTS crews_select_member ON public.crews;
CREATE POLICY crews_select_member
  ON public.crews FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.poolyn_user_in_crew(id, auth.uid())
  );

DROP POLICY IF EXISTS crews_update_owner ON public.crews;
CREATE POLICY crews_update_owner
  ON public.crews FOR UPDATE TO authenticated
  USING (public.poolyn_user_is_crew_owner(id, auth.uid()))
  WITH CHECK (public.poolyn_user_is_crew_owner(id, auth.uid()));

DROP POLICY IF EXISTS crew_members_select_same_crew ON public.crew_members;
CREATE POLICY crew_members_select_same_crew
  ON public.crew_members FOR SELECT TO authenticated
  USING (public.poolyn_user_in_crew(crew_members.crew_id, auth.uid()));

DROP POLICY IF EXISTS crew_trip_instances_select_member ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_select_member
  ON public.crew_trip_instances FOR SELECT TO authenticated
  USING (public.poolyn_user_in_crew(crew_trip_instances.crew_id, auth.uid()));

DROP POLICY IF EXISTS crew_trip_instances_insert_member ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_insert_member
  ON public.crew_trip_instances FOR INSERT TO authenticated
  WITH CHECK (public.poolyn_user_in_crew(crew_trip_instances.crew_id, auth.uid()));

DROP POLICY IF EXISTS crew_messages_select_member ON public.crew_messages;
CREATE POLICY crew_messages_select_member
  ON public.crew_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crew_trip_instances cti
      WHERE cti.id = crew_messages.crew_trip_instance_id
        AND public.poolyn_user_in_crew(cti.crew_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS crew_messages_insert_user_text ON public.crew_messages;
CREATE POLICY crew_messages_insert_user_text
  ON public.crew_messages FOR INSERT TO authenticated
  WITH CHECK (
    kind = 'user'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.crew_trip_instances cti
      WHERE cti.id = crew_trip_instance_id
        AND public.poolyn_user_in_crew(cti.crew_id, auth.uid())
    )
  );
