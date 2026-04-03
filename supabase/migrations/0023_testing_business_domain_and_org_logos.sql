-- 1) Toggle: allow managed workplace signup on personal domains (Gmail, etc.) for testing.
--    Set to production:  UPDATE poolyn_runtime_flags SET value = '{"enabled": false}'::jsonb
--    WHERE key = 'allow_personal_email_enterprise';
--
-- 2) enterprise_org_domain_duplicate_check — "is this domain already taken?" only (no personal-domain message).
--
-- 3) org-logos bucket + policies (business logo upload after org exists).

CREATE TABLE IF NOT EXISTS public.poolyn_runtime_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.poolyn_runtime_flags IS
  'Internal feature switches. Edit via SQL in Dashboard (not exposed to the app API).';

ALTER TABLE public.poolyn_runtime_flags ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.poolyn_runtime_flags FROM PUBLIC;
GRANT ALL ON TABLE public.poolyn_runtime_flags TO postgres;
GRANT ALL ON TABLE public.poolyn_runtime_flags TO service_role;

INSERT INTO public.poolyn_runtime_flags (key, value)
VALUES ('allow_personal_email_enterprise', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.poolyn_allow_personal_email_enterprise()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (value->>'enabled')::boolean
      FROM public.poolyn_runtime_flags
      WHERE key = 'allow_personal_email_enterprise'
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.poolyn_allow_personal_email_enterprise() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enterprise_org_domain_duplicate_check(p_domain text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d text := lower(trim(p_domain));
BEGIN
  IF d = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'Domain is required.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE lower(trim(o.domain)) = d
  ) THEN
    RETURN json_build_object(
      'ok', false,
      'reason', 'This domain already has a Poolyn organisation. Ask your admin for an invite code.'
    );
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_org_domain_duplicate_check(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enterprise_org_domain_duplicate_check(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enterprise_org_domain_status(p_domain text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d text := lower(trim(p_domain));
BEGIN
  IF d = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'Domain is required.');
  END IF;

  IF NOT public.poolyn_allow_personal_email_enterprise() THEN
    IF d = ANY (public.consumer_email_domains()) THEN
      RETURN json_build_object(
        'ok', false,
        'reason', 'Personal email domains cannot create a managed workplace network. Use your company email.'
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE lower(trim(o.domain)) = d
  ) THEN
    RETURN json_build_object(
      'ok', false,
      'reason', 'This domain already has a Poolyn organisation. Ask your admin for an invite code.'
    );
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_org_domain_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enterprise_org_domain_status(text) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Org admins upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins update logos" ON storage.objects;
DROP POLICY IF EXISTS "Org admins delete logos" ON storage.objects;
DROP POLICY IF EXISTS "Org logos are publicly readable" ON storage.objects;

CREATE POLICY "Org admins upload logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.org_role = 'admin'
        AND u.org_id IS NOT NULL
        AND u.org_id::text = split_part(ltrim(name, '/'), '/', 1)
    )
  );

CREATE POLICY "Org admins update logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.org_role = 'admin'
        AND u.org_id IS NOT NULL
        AND u.org_id::text = split_part(ltrim(name, '/'), '/', 1)
    )
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.org_role = 'admin'
        AND u.org_id IS NOT NULL
        AND u.org_id::text = split_part(ltrim(name, '/'), '/', 1)
    )
  );

CREATE POLICY "Org admins delete logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.org_role = 'admin'
        AND u.org_id IS NOT NULL
        AND u.org_id::text = split_part(ltrim(name, '/'), '/', 1)
    )
  );

CREATE POLICY "Org logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');
