-- Pending crew invitees are not in crew_members yet, so "co-member" profile policy
-- hid their names and home_location from organisers. Allow:
-- 1) Any crew member to read profiles of users with a pending invite to that crew.
-- 2) An invitee to read the inviter's profile (for invitation UI).

DROP POLICY IF EXISTS "Crew context: pending invitation profiles" ON public.users;
CREATE POLICY "Crew context: pending invitation profiles"
  ON public.users FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crew_invitations ci
      INNER JOIN public.crew_members cm
        ON cm.crew_id = ci.crew_id
        AND cm.user_id = auth.uid()
      WHERE ci.invited_user_id = users.id
        AND ci.status = 'pending'
    )
    OR EXISTS (
      SELECT 1
      FROM public.crew_invitations ci
      WHERE ci.invited_user_id = auth.uid()
        AND ci.invited_by_user_id = users.id
        AND ci.status = 'pending'
    )
  );
