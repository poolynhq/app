-- RPC: true if any organisation row uses this domain (for Explorer profile copy).
CREATE OR REPLACE FUNCTION public.poolyn_org_exists_for_email_domain(p_domain text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisations o
    WHERE lower(trim(o.domain)) = lower(trim(p_domain))
  );
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_exists_for_email_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_exists_for_email_domain(text) TO authenticated;

-- When the last org admin row is removed (e.g. auth user deleted → CASCADE on public.users),
-- dissolve the organisation and return remaining members to independent (Explorer) state.
-- Organisations are not tied to auth.users with ON DELETE CASCADE; without this, the org row
-- survives and members keep org_id pointing at a zombie org.

CREATE OR REPLACE FUNCTION public.trg_users_after_delete_dissolve_org_if_no_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  admins_left integer;
BEGIN
  oid := OLD.org_id;
  IF oid IS NULL THEN
    RETURN OLD;
  END IF;

  IF OLD.org_role IS DISTINCT FROM 'admin' THEN
    RETURN OLD;
  END IF;

  SELECT count(*)::integer
  INTO admins_left
  FROM public.users
  WHERE org_id = oid
    AND org_role = 'admin';

  IF admins_left > 0 THEN
    RETURN OLD;
  END IF;

  UPDATE public.users
  SET
    org_id = NULL,
    org_role = 'member',
    registration_type = 'independent',
    org_member_verified = false
  WHERE org_id = oid;

  DELETE FROM public.organisations
  WHERE id = oid;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS users_after_delete_dissolve_org_if_no_admin ON public.users;
CREATE TRIGGER users_after_delete_dissolve_org_if_no_admin
  AFTER DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_users_after_delete_dissolve_org_if_no_admin();

COMMENT ON FUNCTION public.trg_users_after_delete_dissolve_org_if_no_admin() IS
  'After an org admin user row is deleted: if no admins remain for that org, clear members to independent and delete the organisation.';

-- One-time repair: organisations with zero admins (e.g. admin deleted from auth before this trigger existed).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id
    FROM public.organisations o
    WHERE NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.org_id = o.id AND u.org_role = 'admin'
    )
  LOOP
    UPDATE public.users
    SET
      org_id = NULL,
      org_role = 'member',
      registration_type = 'independent',
      org_member_verified = false
    WHERE org_id = r.id;

    DELETE FROM public.organisations WHERE id = r.id;
  END LOOP;
END $$;
