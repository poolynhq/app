-- Fixes: infinite recursion detected in policy for relation "users"
-- (v1 of 0024 used EXISTS (SELECT … FROM users) inside users RLS.)

DROP POLICY IF EXISTS "Enterprise admins view same-domain unassigned users" ON public.users;
DROP POLICY IF EXISTS "Enterprise admins claim same-domain explorers" ON public.users;

CREATE OR REPLACE FUNCTION public.current_user_enterprise_org_domain()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(o.domain))
  FROM public.users me
  JOIN public.organisations o ON o.id = me.org_id
  WHERE me.id = auth.uid()
    AND me.org_role = 'admin'
    AND o.org_type = 'enterprise'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_enterprise_org_domain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_enterprise_org_domain() TO authenticated;

CREATE POLICY "Enterprise admins view same-domain unassigned users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    org_id IS NULL
    AND active = true
    AND public.current_user_enterprise_org_domain() IS NOT NULL
    AND lower(trim(split_part(email, '@', 2))) = public.current_user_enterprise_org_domain()
  );

CREATE POLICY "Enterprise admins claim same-domain explorers"
  ON public.users FOR UPDATE
  TO authenticated
  USING (
    org_id IS NULL
    AND active = true
    AND public.current_user_enterprise_org_domain() IS NOT NULL
    AND lower(trim(split_part(email, '@', 2))) = public.current_user_enterprise_org_domain()
  )
  WITH CHECK (
    org_id = public.current_user_org_id()
    AND registration_type = 'enterprise'
    AND org_member_verified = true
    AND org_role = 'member'
  );
