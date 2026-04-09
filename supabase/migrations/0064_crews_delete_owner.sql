-- Allow crew owner to delete the crew (cascades to members, trips, messages, invitations).

DROP POLICY IF EXISTS crews_delete_owner ON public.crews;
CREATE POLICY crews_delete_owner
  ON public.crews FOR DELETE TO authenticated
  USING (public.poolyn_user_is_crew_owner(id, auth.uid()));
