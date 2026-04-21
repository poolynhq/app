-- Org logo uploads: avoid `EXISTS (SELECT … FROM public.users …)` inside storage.objects RLS.
-- That subquery runs as the caller and can hit users-table RLS or odd Storage builds, surfacing
-- HTTP 400 "The database schema is invalid or incompatible" (see 0021 / 0092 avatar notes).
-- Use existing SECURITY DEFINER helpers instead (same idea as 0024 enterprise helpers).

DROP POLICY IF EXISTS "Org admins upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins update logos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins delete logos" ON storage.objects;

CREATE POLICY "Org admins upload logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND public.current_user_is_org_admin() = true
    AND public.current_user_org_id() IS NOT NULL
    AND public.current_user_org_id()::text = split_part(ltrim(name, '/'), '/', 1)
  );

CREATE POLICY "Org admins update logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND public.current_user_is_org_admin() = true
    AND public.current_user_org_id() IS NOT NULL
    AND public.current_user_org_id()::text = split_part(ltrim(name, '/'), '/', 1)
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND public.current_user_is_org_admin() = true
    AND public.current_user_org_id() IS NOT NULL
    AND public.current_user_org_id()::text = split_part(ltrim(name, '/'), '/', 1)
  );

CREATE POLICY "Org admins delete logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND public.current_user_is_org_admin() = true
    AND public.current_user_org_id() IS NOT NULL
    AND public.current_user_org_id()::text = split_part(ltrim(name, '/'), '/', 1)
  );
