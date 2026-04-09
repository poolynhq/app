-- PostgREST upsert on crew_trip_instances runs UPDATE on conflict; UPDATE policy was USING (false), so
-- every second open (or any conflict path) failed RLS. Allow members to update rows for their crew.

DROP POLICY IF EXISTS crew_trip_instances_insert_member ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_insert_member
  ON public.crew_trip_instances FOR INSERT TO authenticated
  WITH CHECK (public.poolyn_user_in_crew(crew_id, auth.uid()));

DROP POLICY IF EXISTS crew_trip_instances_update_none ON public.crew_trip_instances;
CREATE POLICY crew_trip_instances_update_member
  ON public.crew_trip_instances FOR UPDATE TO authenticated
  USING (public.poolyn_user_in_crew(crew_id, auth.uid()))
  WITH CHECK (public.poolyn_user_in_crew(crew_id, auth.uid()));
