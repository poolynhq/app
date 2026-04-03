-- notification_preferences: per-user toggles for in-app / future push categories (JSON keys match app constants).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.notification_preferences IS
  'Map of notification category id -> { "enabled": boolean }. Unknown keys ignored.';

-- Allow admin transfer for community orgs too (same safety checks as enterprise).
CREATE OR REPLACE FUNCTION public.transfer_org_admin(p_new_admin_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_org uuid;
  _target_org uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT org_id INTO _my_org FROM public.users WHERE id = _me;
  IF _my_org IS NULL THEN
    RAISE EXCEPTION 'No organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = _me AND org_id = _my_org AND org_role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only organisation admins can transfer admin rights';
  END IF;

  SELECT org_id INTO _target_org FROM public.users WHERE id = p_new_admin_id AND active = true;
  IF _target_org IS DISTINCT FROM _my_org THEN
    RAISE EXCEPTION 'That person is not an active member of your organisation';
  END IF;

  IF p_new_admin_id = _me THEN
    RAISE EXCEPTION 'Choose another member to become admin';
  END IF;

  UPDATE public.users SET org_role = 'member' WHERE id = _me AND org_id = _my_org;
  UPDATE public.users
  SET org_role = 'admin',
      org_member_verified = true
  WHERE id = p_new_admin_id AND org_id = _my_org;

  RETURN json_build_object('ok', true);
END;
$$;

-- Member leaves workplace network (not admin — admins must transfer first).
CREATE OR REPLACE FUNCTION public.poolyn_leave_organisation()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_org uuid;
  v_role text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id, org_role INTO v_org, v_role FROM public.users WHERE id = v_me;
  IF v_org IS NULL THEN
    RETURN json_build_object('ok', true, 'idempotent', true);
  END IF;

  IF v_role = 'admin' THEN
    RAISE EXCEPTION
      'organisation_admin_must_transfer'
      USING DETAIL = 'Transfer admin to another member (Admin → Transfer admin) before leaving the network.';
  END IF;

  UPDATE public.users
  SET
    org_id = NULL,
    org_role = 'member',
    registration_type = 'independent',
    org_member_verified = false,
    pickup_location = NULL
  WHERE id = v_me;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_me,
    'network_left',
    'You left your workplace network',
    'You are now an independent Explorer on Poolyn. Organisation benefits and network-priority matching no longer apply. Your points and Flex balances are unchanged.',
    '{}'::jsonb
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_leave_organisation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_leave_organisation() TO authenticated;

-- Org admin removes a member (they become Explorer immediately).
CREATE OR REPLACE FUNCTION public.poolyn_admin_remove_org_member(p_target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_my_org uuid;
  v_target_org uuid;
  v_target_role text;
  v_org_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id = v_me THEN
    RAISE EXCEPTION 'use_leave_flow' USING DETAIL = 'Use “Leave network” on your own account.';
  END IF;

  SELECT org_id INTO v_my_org FROM public.users WHERE id = v_me;
  IF v_my_org IS NULL OR NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT org_id, org_role INTO v_target_org, v_target_role
  FROM public.users
  WHERE id = p_target_user_id AND active = true;

  IF v_target_org IS DISTINCT FROM v_my_org THEN
    RAISE EXCEPTION 'target_not_in_org';
  END IF;

  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'cannot_remove_admin' USING DETAIL = 'Transfer admin away from this person before removing them.';
  END IF;

  SELECT name INTO v_org_name FROM public.organisations WHERE id = v_my_org;

  UPDATE public.users
  SET
    org_id = NULL,
    org_role = 'member',
    registration_type = 'independent',
    org_member_verified = false,
    pickup_location = NULL
  WHERE id = p_target_user_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_target_user_id,
    'removed_from_network',
    'Removed from workplace network',
    format('Your admin removed you from %s on Poolyn. You are now an independent Explorer.', COALESCE(v_org_name, 'your organisation')),
    jsonb_build_object('organisation_id', v_my_org)
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.poolyn_admin_remove_org_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_admin_remove_org_member(uuid) TO authenticated;
