-- Reliable member counts for org admin dashboard (bypasses RLS edge cases on aggregate SELECT).
CREATE OR REPLACE FUNCTION public.poolyn_org_admin_dashboard_stats(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.org_id = p_org_id
      AND u.org_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  RETURN json_build_object(
    'total_members',
    (SELECT count(*)::integer FROM public.users WHERE org_id = p_org_id),
    'active_members',
    (SELECT count(*)::integer FROM public.users WHERE org_id = p_org_id AND active = true),
    'monthly_active_commuters',
    public.org_active_user_count(p_org_id, CURRENT_DATE)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_admin_dashboard_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_admin_dashboard_stats(uuid) TO authenticated;
