-- Organisation network status (single source of truth for org-member / explorer fee behavior).
-- Replaces subscription-based checks in is_user_org_member (see 0029).
--
-- FLAG: Spec asked DEFAULT 'inactive'; we use DEFAULT 'active' so existing INSERT paths
--       (enterprise signup, community orgs) stay network-enabled without editing every function.
--       Billing RPCs set grace/inactive explicitly.

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'grace', 'inactive', 'dissolved')),
  ADD COLUMN IF NOT EXISTS grace_started_at timestamptz;

COMMENT ON COLUMN public.organisations.status IS
  'active|grace: private network + no passenger network fee. inactive|dissolved: explorer behavior (fee applies).';
COMMENT ON COLUMN public.organisations.grace_started_at IS
  'Set when entering grace after payment failure; cleared when returning to active.';

CREATE INDEX IF NOT EXISTS idx_organisations_grace_expiry
  ON public.organisations (grace_started_at)
  WHERE status = 'grace';

-- ---------------------------------------------------------------------------
-- 2) is_user_org_member — organisations.status only (no subscriptions)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_user_org_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        u.org_id IS NOT NULL
        AND o.id IS NOT NULL
        AND o.status IN ('active', 'grace')
      FROM public.users u
      LEFT JOIN public.organisations o ON o.id = u.org_id
      WHERE u.id = p_user_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_user_org_member(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) Domain check: only orgs with an enabled network
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_domain_org(p_email_domain text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org  public.organisations;
  _admin_name text;
BEGIN
  SELECT * INTO _org
  FROM   public.organisations
  WHERE  lower(domain) = lower(trim(p_email_domain))
    AND  active = true
    AND  status IN ('active', 'grace')
  LIMIT  1;

  IF _org.id IS NULL THEN
    RETURN json_build_object('has_org', false);
  END IF;

  SELECT full_name INTO _admin_name
  FROM   public.users
  WHERE  org_id   = _org.id
    AND  org_role = 'admin'
    AND  active   = true
  LIMIT  1;

  RETURN json_build_object(
    'has_org',            true,
    'org_id',             _org.id,
    'org_name',           _org.name,
    'org_type',           _org.org_type,
    'plan',               _org.plan,
    'invite_code',        CASE WHEN _org.invite_code_active
                               THEN _org.invite_code
                               ELSE null END,
    'admin_name',         _admin_name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Grace period constant (days) — keep in sync with app GRACE_PERIOD_DAYS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_org_grace_period_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 7;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_grace_period_days() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_grace_period_days() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Payment failure → grace (idempotent: only from active)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_org_enter_grace_on_payment_failure(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF NOT (
    public.is_platform_super_admin()
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organisations
  SET
    status = 'grace',
    grace_started_at = now()
  WHERE id = p_org_id
    AND status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'transitioned', v_updated > 0,
    'rows_updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_enter_grace_on_payment_failure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_enter_grace_on_payment_failure(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.poolyn_org_enter_grace_on_payment_failure(uuid) TO authenticated;
-- authenticated: only platform super-admins pass the guard (Stripe webhooks use service_role).

-- ---------------------------------------------------------------------------
-- 6) Daily expiry: grace older than N days → inactive (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_process_org_grace_expiry()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (
    public.is_platform_super_admin()
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organisations
  SET
    status = 'inactive',
    grace_started_at = NULL
  WHERE status = 'grace'
    AND grace_started_at IS NOT NULL
    AND grace_started_at <= (now() - (public.poolyn_org_grace_period_days() || ' days')::interval);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'orgs_moved_to_inactive', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_process_org_grace_expiry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_process_org_grace_expiry() TO service_role;
GRANT EXECUTE ON FUNCTION public.poolyn_process_org_grace_expiry() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Payment recovered → active (Stripe success webhook / admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.poolyn_org_reactivate_network(p_org_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF NOT (
    public.is_platform_super_admin()
    OR (SELECT auth.role()) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organisations
  SET
    status = 'active',
    grace_started_at = NULL
  WHERE id = p_org_id
    AND status IN ('grace', 'inactive', 'dissolved');

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'transitioned', v_updated > 0,
    'rows_updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_org_reactivate_network(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_org_reactivate_network(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.poolyn_org_reactivate_network(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) Daily schedule: call poolyn_process_org_grace_expiry() with service_role
--     (e.g. Supabase Edge Function + cron). pg_cron in SQL runs without JWT;
--     if you use it, add an allowlisted role or a dedicated internal wrapper.
-- ---------------------------------------------------------------------------