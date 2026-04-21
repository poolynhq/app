-- Org admin dashboard: list Poolyn Crews linked to the organisation with member counts.
-- Crew rows are not all visible to admins via standard crews RLS (membership-based), so use a narrow RPC.

CREATE OR REPLACE FUNCTION public.poolyn_org_admin_crew_summary(p_org_id uuid)
RETURNS TABLE(crew_id uuid, crew_name text, member_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS crew_id,
    c.name AS crew_name,
    count(cm.user_id)::bigint AS member_count
  FROM public.crews c
  LEFT JOIN public.crew_members cm ON cm.crew_id = c.id
  WHERE c.org_id = p_org_id
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.org_role = 'admin'
        AND u.org_id = p_org_id
    )
  GROUP BY c.id, c.name
  ORDER BY c.name;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_admin_crew_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_admin_crew_summary(uuid) TO authenticated;

COMMENT ON FUNCTION public.poolyn_org_admin_crew_summary(uuid) IS
  'Org admins: crews with org_id = p_org_id and member counts (for dashboard reporting).';
