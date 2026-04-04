-- Org network admins need to aggregate rides / requests for their members on the admin dashboard.
-- Existing RLS only exposes same-org rides in scheduled|active (discover) or self/participant rows;
-- counting completed rides or all pending requests as admin could hit PostgREST edge cases or return
-- misleading zeros. These SELECT policies mirror "org admin sees org member data" used elsewhere.

CREATE POLICY "Org admins can view org member rides"
  ON public.rides
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_is_org_admin()
    AND driver_id IN (
      SELECT u.id
      FROM public.users u
      WHERE u.org_id = public.current_user_org_id()
    )
  );

CREATE POLICY "Org admins can view org member ride requests"
  ON public.ride_requests
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_is_org_admin()
    AND passenger_id IN (
      SELECT u.id
      FROM public.users u
      WHERE u.org_id = public.current_user_org_id()
    )
  );
