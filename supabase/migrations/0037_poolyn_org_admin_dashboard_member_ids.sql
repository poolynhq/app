-- Include member UUIDs in admin dashboard stats so the client can run ride/request
-- aggregates even when RLS returns no rows from a direct users SELECT.
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
    public.org_active_user_count(p_org_id, CURRENT_DATE),
    'member_user_ids',
    COALESCE(
      (SELECT json_agg(u.id ORDER BY u.id) FROM public.users u WHERE u.org_id = p_org_id),
      '[]'::json
    )
  );
END;
$$;
