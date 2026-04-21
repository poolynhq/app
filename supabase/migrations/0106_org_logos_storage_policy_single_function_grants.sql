-- Org logos: Storage can return DatabaseInvalidObjectDefinition / 503 when RLS policies call
-- public functions that the storage evaluator role cannot EXECUTE (PUBLIC revoked on some projects).
-- Use one SECURITY DEFINER helper and grant EXECUTE broadly to roles Storage may use.

CREATE OR REPLACE FUNCTION public.storage_user_can_manage_org_logo_path(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.org_role = 'admin'
      AND u.org_id IS NOT NULL
      AND u.org_id::text = split_part(ltrim(COALESCE(object_name, ''), '/'), '/', 1)
  );
$$;

REVOKE ALL ON FUNCTION public.storage_user_can_manage_org_logo_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_user_can_manage_org_logo_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_user_can_manage_org_logo_path(text) TO service_role;

DO $g$
BEGIN
  IF to_regrole('supabase_storage_admin') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.storage_user_can_manage_org_logo_path(text) TO supabase_storage_admin;
  END IF;
  IF to_regrole('authenticator') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.storage_user_can_manage_org_logo_path(text) TO authenticator;
  END IF;
END
$g$;

DROP POLICY IF EXISTS "Org admins upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins update logos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins delete logos" ON storage.objects;

CREATE POLICY "Org admins upload logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND public.storage_user_can_manage_org_logo_path(name)
  );

CREATE POLICY "Org admins update logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND public.storage_user_can_manage_org_logo_path(name)
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND public.storage_user_can_manage_org_logo_path(name)
  );

CREATE POLICY "Org admins delete logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND public.storage_user_can_manage_org_logo_path(name)
  );
