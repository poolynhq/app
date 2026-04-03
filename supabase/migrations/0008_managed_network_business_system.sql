-- =============================================================
-- Migration 0008: Managed network business account system
-- =============================================================

-- 1) Organisation metadata for business onboarding
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS estimated_team_size integer,
  ADD COLUMN IF NOT EXISTS work_locations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) Member verification badge support
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS org_member_verified boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_org_member_verified
  ON public.users (org_id, org_member_verified)
  WHERE active = true;

-- 3) Ensure managed networks are enterprise orgs
CREATE OR REPLACE FUNCTION public.create_enterprise_org(
  org_name text,
  org_domain text,
  admin_user_id uuid,
  plan_name text DEFAULT 'starter'
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organisations;
BEGIN
  INSERT INTO public.organisations (name, domain, org_type, plan, invite_code)
  VALUES (
    org_name,
    org_domain,
    'enterprise',
    plan_name,
    public.generate_invite_code()
  )
  RETURNING * INTO _org;

  UPDATE public.users
  SET org_id = _org.id,
      org_role = 'admin',
      registration_type = 'enterprise',
      org_member_verified = true
  WHERE id = admin_user_id;

  RETURN row_to_json(_org);
END;
$$;

-- 4) Monthly active users by business billing definition
CREATE OR REPLACE FUNCTION public.org_active_user_count(
  target_org_id uuid,
  ref_month date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH month_bounds AS (
    SELECT date_trunc('month', ref_month::timestamp) AS month_start,
           (date_trunc('month', ref_month::timestamp) + interval '1 month') AS month_end
  ),
  active_ids AS (
    -- participated in at least 1 confirmed ride
    SELECT r.driver_id AS user_id
    FROM public.rides r, month_bounds mb
    WHERE r.depart_at >= mb.month_start
      AND r.depart_at < mb.month_end
      AND r.status IN ('scheduled', 'active', 'completed')
    UNION
    SELECT rp.passenger_id AS user_id
    FROM public.ride_passengers rp
    JOIN public.rides r ON r.id = rp.ride_id, month_bounds mb
    WHERE r.depart_at >= mb.month_start
      AND r.depart_at < mb.month_end
      AND rp.status IN ('confirmed', 'picked_up', 'dropped_off', 'completed')
    UNION
    -- sent ride request this month
    SELECT rr.passenger_id AS user_id
    FROM public.ride_requests rr, month_bounds mb
    WHERE rr.created_at >= mb.month_start
      AND rr.created_at < mb.month_end
      AND rr.status IN ('pending', 'matched')
  )
  SELECT count(DISTINCT u.id)::integer
  FROM public.users u
  JOIN active_ids a ON a.user_id = u.id
  WHERE u.org_id = target_org_id;
$$;

-- 5) Admin incentive function: grant flex credits
CREATE OR REPLACE FUNCTION public.grant_org_flex_credits(
  target_user_id uuid,
  amount integer,
  reason text DEFAULT 'Employer grant'
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin_org uuid;
  _target_org uuid;
BEGIN
  IF amount = 0 THEN
    RAISE EXCEPTION 'Amount must be non-zero';
  END IF;

  SELECT org_id INTO _admin_org FROM public.users WHERE id = auth.uid();
  SELECT org_id INTO _target_org FROM public.users WHERE id = target_user_id;

  IF _admin_org IS NULL OR _target_org IS NULL OR _admin_org <> _target_org THEN
    RAISE EXCEPTION 'User is outside your organisation';
  END IF;

  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'Only organisation admins can grant flex credits';
  END IF;

  INSERT INTO public.flex_credits_ledger (
    user_id,
    delta,
    balance_after,
    txn_type,
    description
  )
  VALUES (
    target_user_id,
    amount,
    0,
    'employer_grant',
    reason
  );

  RETURN json_build_object(
    'ok', true,
    'target_user_id', target_user_id,
    'amount', amount
  );
END;
$$;
