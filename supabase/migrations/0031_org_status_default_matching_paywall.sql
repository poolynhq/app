-- Org status default inactive on create; matching/map layers respect org network status;
-- invite join requires active network; grace expiry RPC service_role only.

-- ---------------------------------------------------------------------------
-- 1) Default new organisations to inactive (activation via payment webhook RPC)
-- ---------------------------------------------------------------------------
ALTER TABLE public.organisations
  ALTER COLUMN status SET DEFAULT 'inactive';

COMMENT ON COLUMN public.organisations.status IS
  'inactive until poolyn_org_reactivate_network after payment; grace = fee waiver window; active = full network.';

-- ---------------------------------------------------------------------------
-- 2) Enterprise org creation — explicit inactive until payment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_enterprise_org(
  org_name text,
  org_domain text,
  admin_user_id uuid,
  plan_name text DEFAULT 'starter'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organisations;
  _d text := lower(trim(org_domain));
  _status json;
BEGIN
  _status := public.enterprise_org_domain_status(_d);
  IF (_status ->> 'ok') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '%', COALESCE(_status ->> 'reason', 'This domain cannot be used for a new organisation');
  END IF;

  INSERT INTO public.organisations (
    name,
    domain,
    org_type,
    plan,
    invite_code,
    status
  )
  VALUES (
    org_name,
    _d,
    'enterprise',
    plan_name,
    public.generate_invite_code(),
    'inactive'
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

-- ---------------------------------------------------------------------------
-- 3) Invite join — only when organisation is fully active (not grace/inactive)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_org_by_invite(code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org public.organisations;
  _user_email text;
  _user_domain text;
BEGIN
  SELECT * INTO _org
  FROM public.organisations
  WHERE invite_code = code
    AND invite_code_active = true;

  IF _org.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or inactive invite code';
  END IF;

  IF _org.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Organisation network is not activated';
  END IF;

  SELECT email INTO _user_email
  FROM public.users
  WHERE id = auth.uid();

  _user_domain := split_part(_user_email, '@', 2);

  IF lower(_user_domain) <> lower(_org.domain) THEN
    RAISE EXCEPTION 'Email domain does not match organisation domain';
  END IF;

  UPDATE public.users
  SET org_id = _org.id,
      registration_type = 'enterprise',
      org_member_verified = true,
      org_role = 'member'
  WHERE id = auth.uid();

  RETURN row_to_json(_org);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Grace expiry: Edge Function uses service_role JWT. End-user JWTs are rejected
--    by the function guard; GRANT authenticated allows super-admin manual runs only.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.poolyn_process_org_grace_expiry() TO service_role;
GRANT EXECUTE ON FUNCTION public.poolyn_process_org_grace_expiry() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Geometry prefilter: same_org only if shared org is active or grace
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Commute counterparty profile read" ON public.users;
DROP FUNCTION IF EXISTS public.user_is_commute_counterparty_visible(uuid);
DROP FUNCTION IF EXISTS public.count_geometry_match_peers(uuid);
DROP FUNCTION IF EXISTS public.prefilter_commute_match_pairs(uuid, boolean);

CREATE FUNCTION public.prefilter_commute_match_pairs(
  p_viewer_id           uuid,
  p_include_local_pool  boolean DEFAULT false
)
RETURNS TABLE (
  driver_id             uuid,
  passenger_id          uuid,
  driver_route_id       uuid,
  passenger_route_id    uuid,
  overlap_ratio_initial real,
  match_scope           text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT u.id, u.org_id, u.role, u.active_mode
    FROM public.users u
    WHERE u.id = p_viewer_id
  ),
  viewer_route AS (
    SELECT cr.id, cr.user_id, cr.route_geom, cr.bbox_min_lng, cr.bbox_min_lat, cr.bbox_max_lng, cr.bbox_max_lat
    FROM public.commute_routes cr
    WHERE cr.user_id = p_viewer_id AND cr.direction = 'to_work'
    LIMIT 1
  ),
  drivers AS (
    SELECT u.id AS uid, cr.id AS rid, cr.route_geom, cr.bbox_min_lng, cr.bbox_min_lat, cr.bbox_max_lng, cr.bbox_max_lat,
           u.org_id AS oid
    FROM public.users u
    JOIN public.commute_routes cr ON cr.user_id = u.id AND cr.direction = 'to_work'
    JOIN public.vehicles v ON v.user_id = u.id AND v.active = true AND v.seats > 1
    WHERE u.active = true
      AND u.onboarding_completed = true
      AND u.role IN ('driver', 'both')
  ),
  passengers AS (
    SELECT u.id AS uid, cr.id AS rid, cr.route_geom, cr.bbox_min_lng, cr.bbox_min_lat, cr.bbox_max_lng, cr.bbox_max_lat,
           u.org_id AS oid
    FROM public.users u
    JOIN public.commute_routes cr ON cr.user_id = u.id AND cr.direction = 'to_work'
    WHERE u.active = true
      AND u.onboarding_completed = true
      AND u.role IN ('passenger', 'both')
  )
  SELECT
    d.uid AS driver_id,
    p.uid AS passenger_id,
    d.rid AS driver_route_id,
    p.rid AS passenger_route_id,
    public.route_overlap_ratio(
      d.route_geom,
      (SELECT home_location FROM public.users WHERE id = p.uid),
      (SELECT work_location FROM public.users WHERE id = p.uid)
    )::real AS overlap_ratio_initial,
    CASE
      WHEN d.oid IS NOT DISTINCT FROM vz.org_id
        AND p.oid IS NOT DISTINCT FROM vz.org_id
        AND d.oid IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.organisations o
          WHERE o.id = d.oid AND o.status IN ('active', 'grace')
        )
      THEN 'same_org'
      ELSE 'outer_network'
    END AS match_scope
  FROM drivers d
  JOIN passengers p ON d.uid <> p.uid
  JOIN viewer vz ON true
  WHERE
    (
      (
        (vz.role = 'passenger' OR (vz.role = 'both' AND vz.active_mode IS DISTINCT FROM 'driver'))
        AND p.uid = p_viewer_id
        AND d.uid <> p_viewer_id
      )
      OR
      (
        (vz.role = 'driver' OR (vz.role = 'both' AND vz.active_mode IS DISTINCT FROM 'passenger'))
        AND d.uid = p_viewer_id
        AND p.uid <> p_viewer_id
      )
    )
    AND (SELECT home_location FROM public.users WHERE id = p.uid) IS NOT NULL
    AND (SELECT work_location FROM public.users WHERE id = p.uid) IS NOT NULL
    AND EXISTS (SELECT 1 FROM viewer_route vr WHERE vr.id IS NOT NULL)
    AND NOT (d.bbox_max_lng < p.bbox_min_lng OR d.bbox_min_lng > p.bbox_max_lng
         OR d.bbox_max_lat < p.bbox_min_lat OR d.bbox_min_lat > p.bbox_max_lat)
    AND (
      (
        d.oid IS NOT DISTINCT FROM vz.org_id
        AND p.oid IS NOT DISTINCT FROM vz.org_id
        AND d.oid IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.organisations o
          WHERE o.id = d.oid AND o.status IN ('active', 'grace')
        )
      )
      OR
      (
        p_include_local_pool = true
        AND vz.org_id IS NOT NULL
        AND (vz.role = 'driver' OR (vz.role = 'both' AND vz.active_mode IS DISTINCT FROM 'passenger'))
        AND d.uid = p_viewer_id
        AND p.oid IS DISTINCT FROM vz.org_id
        AND EXISTS (
          SELECT 1 FROM public.organisations o
          WHERE o.id = vz.org_id
            AND o.allow_cross_org = true
            AND o.status IN ('active', 'grace')
        )
      )
    )
    AND p_viewer_id = auth.uid()
  LIMIT 80;
$$;

GRANT EXECUTE ON FUNCTION public.prefilter_commute_match_pairs(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.count_geometry_match_peers(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM public.prefilter_commute_match_pairs(p_user_id, false);
$$;

GRANT EXECUTE ON FUNCTION public.count_geometry_match_peers(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_is_commute_counterparty_visible(p_peer_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.prefilter_commute_match_pairs(
      auth.uid(),
      COALESCE(
        (SELECT u.driver_show_outer_network_riders FROM public.users u WHERE u.id = auth.uid()),
        false
      )
    ) m
    WHERE (m.driver_id = auth.uid() AND m.passenger_id = p_peer_id)
       OR (m.passenger_id = auth.uid() AND m.driver_id = p_peer_id)
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_commute_counterparty_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_commute_counterparty_visible(uuid) TO authenticated;

CREATE POLICY "Commute counterparty profile read"
  ON public.users FOR SELECT
  USING (public.user_is_commute_counterparty_visible(id));

-- ---------------------------------------------------------------------------
-- 6) Map layers: network scope only when viewer org network is active|grace
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_map_layers_for_discover(
  p_user_id uuid,
  p_scope    text DEFAULT 'network'
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id   uuid;
  _net_ok   boolean;
  _demand   json;
  _supply   json;
  _routes   json;
BEGIN
  SELECT
    u.org_id,
    EXISTS (
      SELECT 1
      FROM public.organisations o
      WHERE o.id = u.org_id
        AND o.status IN ('active', 'grace')
    )
  INTO _org_id, _net_ok
  FROM public.users u
  WHERE u.id = p_user_id;

  WITH ride_demand AS (
    SELECT rr.origin AS pt
    FROM public.ride_requests rr
    JOIN public.users u ON u.id = rr.passenger_id
    WHERE rr.status = 'pending'
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  ),
  profile_demand AS (
    SELECT u.home_location AS pt
    FROM public.users u
    WHERE u.id <> p_user_id
      AND u.active = true
      AND u.onboarding_completed = true
      AND u.home_location IS NOT NULL
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  ),
  all_demand AS (
    SELECT pt FROM ride_demand
    UNION ALL
    SELECT pt FROM profile_demand
  ),
  demand_features AS (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(pt::geometry)::json,
      'properties', json_build_object('kind', 'demand')
    ) AS feature
    FROM all_demand
    WHERE pt IS NOT NULL
  )
  SELECT json_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _demand
  FROM demand_features;

  WITH ride_supply AS (
    SELECT r.origin AS pt
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  ),
  profile_supply AS (
    SELECT u.work_location AS pt
    FROM public.users u
    WHERE u.id <> p_user_id
      AND u.active = true
      AND u.onboarding_completed = true
      AND u.role IN ('driver', 'both')
      AND u.work_location IS NOT NULL
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  ),
  all_supply AS (
    SELECT pt FROM ride_supply
    UNION ALL
    SELECT pt FROM profile_supply
  ),
  supply_features AS (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(pt::geometry)::json,
      'properties', json_build_object('kind', 'supply')
    ) AS feature
    FROM all_supply
    WHERE pt IS NOT NULL
  )
  SELECT json_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _supply
  FROM supply_features;

  WITH route_features AS (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(r.route_geometry::geometry)::json,
      'properties', json_build_object('kind', 'route')
    ) AS feature
    FROM public.rides r
    JOIN public.users u ON u.id = r.driver_id
    WHERE r.status IN ('scheduled', 'active')
      AND r.route_geometry IS NOT NULL
      AND (
        (p_scope = 'network' AND _net_ok AND u.org_id IS NOT DISTINCT FROM _org_id)
        OR p_scope = 'extended'
      )
  )
  SELECT json_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(json_agg(feature), '[]'::json)
  )
  INTO _routes
  FROM route_features;

  RETURN json_build_object(
    'demand_points', COALESCE(_demand, json_build_object('type','FeatureCollection','features','[]'::json)),
    'supply_points', COALESCE(_supply, json_build_object('type','FeatureCollection','features','[]'::json)),
    'route_lines',   COALESCE(_routes, json_build_object('type','FeatureCollection','features','[]'::json))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_map_layers_for_discover(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Claim / list explorers — server-side parity with paywall (active network only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_domain_explorers()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _domain text;
  _org_id uuid;
BEGIN
  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT u.org_id, lower(o.domain)
  INTO _org_id, _domain
  FROM public.users u
  JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = auth.uid();

  IF _domain IS NULL OR _org_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = _org_id AND o.status = 'active'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id, u.email, u.full_name, u.avatar_url
  FROM public.users u
  WHERE lower(split_part(u.email, '@', 2)) = _domain
    AND u.org_id IS NULL
    AND u.id <> auth.uid()
    AND u.active = true
  ORDER BY u.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_claim_explorers(p_user_ids uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _domain text;
  _n integer;
BEGIN
  IF NOT public.current_user_is_org_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT u.org_id, lower(o.domain) INTO _org_id, _domain
  FROM public.users u
  JOIN public.organisations o ON o.id = u.org_id
  WHERE u.id = auth.uid();

  IF _org_id IS NULL OR _domain IS NULL THEN
    RAISE EXCEPTION 'no organisation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organisations o
    WHERE o.id = _org_id AND o.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Organisation network is not activated';
  END IF;

  UPDATE public.users u
  SET org_id = _org_id,
      registration_type = 'enterprise',
      org_member_verified = true,
      org_role = 'member'
  WHERE u.id = ANY(p_user_ids)
    AND u.org_id IS NULL
    AND lower(split_part(u.email, '@', 2)) = _domain;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN json_build_object('claimed', _n);
END;
$$;
