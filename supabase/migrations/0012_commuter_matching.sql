-- =============================================================
-- Migration 0012: Profile-based commuter matching
--
-- The existing compute_match_candidates / match_suggestions flow
-- requires users to explicitly post a ride offer OR a ride request
-- before any matching occurs. New users who have only completed
-- onboarding (saved home/work locations) are invisible to each other.
--
-- This migration adds find_commuter_matches(), which matches users
-- directly from their saved home_location + work_location geography
-- columns — no rides or ride_requests required. This enables the
-- Discover page and home screen to show "people near your route"
-- the moment onboarding is complete.
-- =============================================================

CREATE OR REPLACE FUNCTION public.find_commuter_matches(
  p_user_id      uuid,
  p_home_radius_m  integer DEFAULT 5000,  -- metres; ~5 km pickup zone
  p_work_radius_m  integer DEFAULT 2000,  -- metres; ~2 km work cluster
  p_scope          text    DEFAULT 'all'  -- 'all' | 'network' | 'nearby'
)
RETURNS TABLE (
  peer_id         uuid,
  peer_name       text,
  peer_role       text,
  peer_reliability integer,
  peer_verified   boolean,
  section         text,       -- 'organization' | 'nearby'
  home_distance_m real,
  work_distance_m real,
  route_score     real        -- 0.0 – 1.0; higher = better route overlap
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT id, org_id, home_location, work_location
    FROM   public.users
    WHERE  id = p_user_id
      AND  home_location IS NOT NULL
      AND  work_location IS NOT NULL
  )
  SELECT
    u.id                                                     AS peer_id,
    u.full_name                                              AS peer_name,
    u.role                                                   AS peer_role,
    COALESCE(u.reliability_score, 70)                        AS peer_reliability,
    u.license_verified                                       AS peer_verified,
    CASE
      WHEN me.org_id IS NOT NULL AND u.org_id = me.org_id THEN 'organization'
      ELSE 'nearby'
    END                                                      AS section,
    ST_Distance(me.home_location, u.home_location)::real     AS home_distance_m,
    ST_Distance(me.work_location, u.work_location)::real     AS work_distance_m,
    -- Weighted harmonic: 50% home proximity + 50% work proximity, each 0–1
    (
      GREATEST(0.0, 1.0 - ST_Distance(me.home_location, u.home_location)::real
                          / p_home_radius_m::real) * 0.5
      + GREATEST(0.0, 1.0 - ST_Distance(me.work_location, u.work_location)::real
                             / p_work_radius_m::real) * 0.5
    )::real                                                  AS route_score
  FROM public.users u
  CROSS JOIN me
  WHERE u.id            <> p_user_id
    AND u.active        = true
    AND u.onboarding_completed = true
    AND u.home_location IS NOT NULL
    AND u.work_location IS NOT NULL
    -- Both endpoints must be within radius (uses spatial index)
    AND ST_DWithin(me.home_location, u.home_location, p_home_radius_m)
    AND ST_DWithin(me.work_location, u.work_location, p_work_radius_m)
    -- Honour block relationships
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = p_user_id AND b.blocked_id = u.id)
         OR (b.blocker_id = u.id      AND b.blocked_id = p_user_id)
    )
    -- Scope filter
    AND (
      p_scope = 'all'
      OR (p_scope = 'network' AND u.org_id IS NOT DISTINCT FROM me.org_id)
      OR (p_scope = 'nearby'  AND u.org_id IS DISTINCT FROM me.org_id)
    )
  ORDER BY route_score DESC, COALESCE(u.reliability_score, 70) DESC
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.find_commuter_matches(uuid, integer, integer, text) TO authenticated;
