-- Avoid nested invoker RLS on public.users inside ride_requests / users policies (can surface as 500s from PostgREST).
-- Replace inline subqueries with SECURITY DEFINER helpers that read users/organisations without re-entering users RLS.

-- ---------------------------------------------------------------------------
-- Crew co-members: profile read for chat (no self-join on users under RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_shares_poolyn_crew_with(p_viewer uuid, p_subject uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crew_members c1
    JOIN public.crew_members c2 ON c2.crew_id = c1.crew_id
    WHERE c1.user_id = p_viewer
      AND c2.user_id = p_subject
  );
$$;

REVOKE ALL ON FUNCTION public.user_shares_poolyn_crew_with(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_shares_poolyn_crew_with(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Crew members can view co-member profiles" ON public.users;

CREATE POLICY "Crew members can view co-member profiles"
  ON public.users FOR SELECT TO authenticated
  USING (public.user_shares_poolyn_crew_with(auth.uid(), id));

-- ---------------------------------------------------------------------------
-- Cross-network pending pickup visibility for drivers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_request_visible_to_cross_network_driver(p_passenger_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _active boolean;
  _d_org uuid;
  _d_outer boolean;
  _d_org_allow boolean;
  _p_org uuid;
  _p_active boolean;
  _p_allow boolean;
BEGIN
  IF _uid IS NULL OR p_passenger_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT u.role, u.active, u.org_id, COALESCE(u.driver_show_outer_network_riders, false)
  INTO _role, _active, _d_org, _d_outer
  FROM public.users u
  WHERE u.id = _uid;

  IF NOT COALESCE(_active, false) THEN
    RETURN false;
  END IF;
  IF _role IS NULL OR _role NOT IN ('driver', 'both') THEN
    RETURN false;
  END IF;

  SELECT u.org_id, u.active, COALESCE(o.allow_cross_org, false)
  INTO _p_org, _p_active, _p_allow
  FROM public.users u
  LEFT JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = p_passenger_id;

  IF NOT COALESCE(_p_active, false) THEN
    RETURN false;
  END IF;

  IF _d_org IS NOT NULL THEN
    SELECT o.allow_cross_org INTO _d_org_allow
    FROM public.organisations o
    WHERE o.id = _d_org;
    IF NOT COALESCE(_d_org_allow, false) OR NOT _d_outer THEN
      RETURN false;
    END IF;
    IF _p_org IS NOT DISTINCT FROM _d_org THEN
      RETURN false;
    END IF;
    IF _p_org IS NULL OR _p_allow THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF _d_org IS NULL AND _p_org IS NOT NULL AND _p_allow THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.ride_request_visible_to_cross_network_driver(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ride_request_visible_to_cross_network_driver(uuid) TO authenticated;

DROP POLICY IF EXISTS "Drivers cross-network pending ride requests" ON public.ride_requests;

CREATE POLICY "Drivers cross-network pending ride requests"
  ON public.ride_requests FOR SELECT TO authenticated
  USING (
    status = 'pending'
    AND public.ride_request_visible_to_cross_network_driver(passenger_id)
  );
