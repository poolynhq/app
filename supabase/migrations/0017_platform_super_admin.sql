-- Platform super-admins (Poolyn operators): separate from users.org_role 'admin' (org network admin).
-- Access: rows in platform_super_admins; data via SECURITY DEFINER RPCs only.

CREATE TABLE IF NOT EXISTS public.platform_super_admins (
  user_id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_super_admins IS
  'Operators who may call super_admin_* RPCs to list all users and organisations. Grant by INSERT in SQL Editor (not via the app API).';

ALTER TABLE public.platform_super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_super_admins_no_direct_access" ON public.platform_super_admins;
CREATE POLICY "platform_super_admins_no_direct_access"
  ON public.platform_super_admins
  FOR ALL
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.platform_super_admins FROM authenticated;
REVOKE ALL ON TABLE public.platform_super_admins FROM anon;

CREATE OR REPLACE FUNCTION public.is_platform_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_super_admins p
    WHERE p.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_super_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.super_admin_list_directory()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  commute_role text,
  org_role text,
  org_id uuid,
  org_name text,
  org_domain text,
  org_type text,
  registration_type text,
  onboarding_completed boolean,
  active boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_super_admins WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.org_role,
    u.org_id,
    o.name,
    o.domain,
    o.org_type,
    u.registration_type,
    u.onboarding_completed,
    u.active,
    u.created_at
  FROM public.users u
  LEFT JOIN public.organisations o ON o.id = u.org_id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_list_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_list_directory() TO authenticated;

CREATE OR REPLACE FUNCTION public.super_admin_org_overview()
RETURNS TABLE (
  org_id uuid,
  org_name text,
  org_domain text,
  org_type text,
  plan text,
  member_count bigint,
  admin_count bigint,
  active_member_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_super_admins WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.domain,
    o.org_type,
    o.plan,
    COUNT(u.id)::bigint AS member_count,
    COUNT(u.id) FILTER (WHERE u.org_role = 'admin')::bigint AS admin_count,
    COUNT(u.id) FILTER (WHERE u.active)::bigint AS active_member_count
  FROM public.organisations o
  LEFT JOIN public.users u ON u.org_id = o.id
  GROUP BY o.id, o.name, o.domain, o.org_type, o.plan
  ORDER BY o.name;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_org_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_org_overview() TO authenticated;
