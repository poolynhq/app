-- Second dashboard headline: "onboarded" = finished in-app setup (same idea as Members "Pending").
-- Keeps active_members in JSON as enabled-account count for backwards compatibility.

CREATE OR REPLACE FUNCTION public.poolyn_org_admin_dashboard_stats(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _total integer;
  _active integer;
  _onboarded integer;
  _mau integer := 0;
  _ids json;
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

  SELECT count(*)::integer INTO _total FROM public.users WHERE org_id = p_org_id;
  SELECT count(*)::integer INTO _active FROM public.users WHERE org_id = p_org_id AND active = true;
  SELECT count(*)::integer INTO _onboarded
  FROM public.users
  WHERE org_id = p_org_id AND onboarding_completed = true;

  BEGIN
    _mau := public.org_active_user_count(p_org_id, CURRENT_DATE);
  EXCEPTION
    WHEN OTHERS THEN
      _mau := 0;
  END;

  SELECT COALESCE(json_agg(u.id ORDER BY u.id), '[]'::json)
  INTO _ids
  FROM public.users u
  WHERE u.org_id = p_org_id;

  RETURN json_build_object(
    'total_members', _total,
    'active_members', _active,
    'onboarded_members', _onboarded,
    'monthly_active_commuters', _mau,
    'member_user_ids', COALESCE(_ids, '[]'::json)
  );
END;
$$;
