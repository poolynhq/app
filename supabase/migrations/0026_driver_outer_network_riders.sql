-- Driver opt-in: show passengers outside the driver's org (local pool / cross-network).
-- Gated by organisations.allow_cross_org and users.driver_show_outer_network_riders (for RLS peer reads).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS driver_show_outer_network_riders boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.driver_show_outer_network_riders IS
  'When true, geometry prefilter may include passengers not in the driver''s org; RLS uses this to allow reading those peers.';

-- PG cannot change RETURNS TABLE row type with CREATE OR REPLACE; drop dependents first.
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
      WHEN d.oid IS NOT DISTINCT FROM vz.org_id AND p.oid IS NOT DISTINCT FROM vz.org_id THEN 'same_org'
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
      (d.oid IS NOT DISTINCT FROM vz.org_id AND p.oid IS NOT DISTINCT FROM vz.org_id)
      OR
      (
        p_include_local_pool = true
        AND vz.org_id IS NOT NULL
        AND (vz.role = 'driver' OR (vz.role = 'both' AND vz.active_mode IS DISTINCT FROM 'passenger'))
        AND d.uid = p_viewer_id
        AND p.oid IS DISTINCT FROM vz.org_id
        AND EXISTS (
          SELECT 1 FROM public.organisations o
          WHERE o.id = vz.org_id AND o.allow_cross_org = true
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

-- Counterparty visibility for scoring cards (Mapbox / Turf needs peer home/work).
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
