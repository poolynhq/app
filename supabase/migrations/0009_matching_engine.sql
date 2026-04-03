-- =============================================================
-- Migration 0009: Matching engine foundation
-- =============================================================

-- 1) Allow independent users to discover each other without org gating
CREATE POLICY "Independent users can discover available rides"
  ON public.rides FOR SELECT
  USING (
    driver_id IN (
      SELECT id
      FROM public.users
      WHERE org_id IS NULL
        AND public.current_user_org_id() IS NULL
        AND active = true
        AND onboarding_completed = true
    )
    AND status IN ('scheduled', 'active')
  );

CREATE POLICY "Independent users can view pending requests"
  ON public.ride_requests FOR SELECT
  USING (
    status = 'pending'
    AND passenger_id IN (
      SELECT id
      FROM public.users
      WHERE org_id IS NULL
        AND public.current_user_org_id() IS NULL
        AND active = true
        AND onboarding_completed = true
    )
  );

-- 2) Candidate computation for route/time/reliability scoring
CREATE OR REPLACE FUNCTION public.compute_match_candidates(
  p_user_id uuid,
  p_scope text DEFAULT 'network'
)
RETURNS TABLE (
  driver_id uuid,
  passenger_id uuid,
  ride_id uuid,
  ride_request_id uuid,
  route_similarity_score real,
  time_overlap_mins integer,
  detour_mins real,
  distance_meters real,
  reliability_weight real,
  match_score real,
  network_scope text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT *
    FROM public.users
    WHERE id = p_user_id
  ),
  candidate_rides AS (
    SELECT
      r.id AS ride_id,
      r.driver_id,
      rr.id AS ride_request_id,
      rr.passenger_id,
      r.depart_at,
      rr.desired_depart_at,
      r.origin AS ride_origin,
      r.destination AS ride_destination,
      rr.origin AS req_origin,
      rr.destination AS req_destination,
      u_driver.detour_tolerance_mins AS driver_detour_limit,
      COALESCE(u_driver.reliability_score, 70) AS driver_reliability,
      COALESCE(u_passenger.reliability_score, 70) AS passenger_reliability,
      CASE
        WHEN u_driver.org_id IS NOT NULL
             AND u_driver.org_id = u_passenger.org_id
          THEN 'network'
        ELSE 'extended'
      END AS network_scope
    FROM public.rides r
    JOIN public.users u_driver ON u_driver.id = r.driver_id
    JOIN public.ride_requests rr
      ON rr.status = 'pending'
      AND rr.passenger_id <> r.driver_id
    JOIN public.users u_passenger ON u_passenger.id = rr.passenger_id
    WHERE r.status IN ('scheduled', 'active')
      AND (
        -- network-only pool
        (
          p_scope = 'network'
          AND u_driver.org_id IS NOT DISTINCT FROM u_passenger.org_id
        )
        OR
        -- extended pool fallback
        (
          p_scope = 'extended'
        )
      )
      AND (
        -- user-centric computation: suggestions relevant to this user
        r.driver_id = p_user_id
        OR rr.passenger_id = p_user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.blocks b
        WHERE (b.blocker_id = r.driver_id AND b.blocked_id = rr.passenger_id)
           OR (b.blocker_id = rr.passenger_id AND b.blocked_id = r.driver_id)
      )
  ),
  scored AS (
    SELECT
      c.driver_id,
      c.passenger_id,
      c.ride_id,
      c.ride_request_id,
      -- proximity-based route similarity proxy (origin + destination)
      GREATEST(
        0,
        1 - (
          (
            LEAST(ST_Distance(c.ride_origin, c.req_origin), 30000) +
            LEAST(ST_Distance(c.ride_destination, c.req_destination), 30000)
          ) / 60000
        )
      )::real AS route_similarity_score,
      GREATEST(
        0,
        30 - ABS(EXTRACT(EPOCH FROM (c.depart_at - c.desired_depart_at)) / 60)::integer
      )::integer AS time_overlap_mins,
      (
        (LEAST(ST_Distance(c.ride_origin, c.req_origin), 30000) / 1000.0)
        + (LEAST(ST_Distance(c.ride_destination, c.req_destination), 30000) / 1000.0)
      )::real AS detour_mins,
      (
        LEAST(ST_Distance(c.ride_origin, c.req_origin), 30000)
        + LEAST(ST_Distance(c.ride_destination, c.req_destination), 30000)
      )::real AS distance_meters,
      ((c.driver_reliability + c.passenger_reliability) / 200.0)::real AS reliability_weight,
      c.network_scope
    FROM candidate_rides c
  )
  SELECT
    s.driver_id,
    s.passenger_id,
    s.ride_id,
    s.ride_request_id,
    s.route_similarity_score,
    s.time_overlap_mins,
    s.detour_mins,
    s.distance_meters,
    s.reliability_weight,
    (
      (s.route_similarity_score * 0.45) +
      (LEAST(s.time_overlap_mins, 30)::real / 30.0 * 0.25) +
      (GREATEST(0, 1 - LEAST(s.detour_mins, 45) / 45.0) * 0.15) +
      (s.reliability_weight * 0.15) +
      (CASE WHEN s.network_scope = 'network' THEN 0.05 ELSE 0 END)
    )::real AS match_score,
    s.network_scope
  FROM scored s
  WHERE s.route_similarity_score > 0.15
    AND s.time_overlap_mins >= 0
  ORDER BY match_score DESC;
$$;

-- 3) Upsert match suggestions from computed candidates
CREATE OR REPLACE FUNCTION public.upsert_match_suggestions(
  p_user_id uuid,
  p_scope text DEFAULT 'network'
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
BEGIN
  INSERT INTO public.match_suggestions (
    driver_id,
    passenger_id,
    ride_id,
    ride_request_id,
    route_similarity_score,
    time_overlap_mins,
    detour_mins,
    distance_meters,
    match_score,
    network_scope,
    status,
    driver_status,
    passenger_status,
    expires_at
  )
  SELECT
    c.driver_id,
    c.passenger_id,
    c.ride_id,
    c.ride_request_id,
    c.route_similarity_score,
    c.time_overlap_mins,
    c.detour_mins,
    c.distance_meters,
    c.match_score,
    c.network_scope,
    'pending',
    'pending',
    'pending',
    now() + interval '24 hours'
  FROM public.compute_match_candidates(p_user_id, p_scope) c
  ON CONFLICT (ride_id, ride_request_id, driver_id, passenger_id)
  DO UPDATE SET
    route_similarity_score = EXCLUDED.route_similarity_score,
    time_overlap_mins = EXCLUDED.time_overlap_mins,
    detour_mins = EXCLUDED.detour_mins,
    distance_meters = EXCLUDED.distance_meters,
    match_score = EXCLUDED.match_score,
    network_scope = EXCLUDED.network_scope,
    status = 'pending',
    expires_at = now() + interval '24 hours'
  WHERE public.match_suggestions.status IN ('pending', 'expired');

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

-- 4) Ensure upsert has conflict key
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_suggestion_identity
  ON public.match_suggestions (ride_id, ride_request_id, driver_id, passenger_id)
  WHERE ride_id IS NOT NULL
    AND ride_request_id IS NOT NULL;

-- 5) Enriched discover payload for app sections and filters
CREATE OR REPLACE FUNCTION public.get_discover_matches(
  p_user_id uuid,
  p_scope text DEFAULT 'network',
  p_verified_drivers_only boolean DEFAULT false,
  p_min_reliability integer DEFAULT 0,
  p_gender_filter text DEFAULT null
)
RETURNS TABLE (
  suggestion_id uuid,
  section text,
  match_score real,
  route_similarity_score real,
  time_overlap_mins integer,
  depart_at timestamptz,
  desired_depart_at timestamptz,
  driver_id uuid,
  passenger_id uuid,
  driver_name text,
  passenger_name text,
  driver_reliability integer,
  passenger_reliability integer,
  driver_verified boolean,
  trust_label text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ms.id AS suggestion_id,
    CASE WHEN ms.network_scope = 'network' THEN 'organization' ELSE 'nearby' END AS section,
    ms.match_score,
    ms.route_similarity_score,
    ms.time_overlap_mins,
    r.depart_at,
    rr.desired_depart_at,
    ms.driver_id,
    ms.passenger_id,
    u_driver.full_name AS driver_name,
    u_passenger.full_name AS passenger_name,
    COALESCE(u_driver.reliability_score, 70) AS driver_reliability,
    COALESCE(u_passenger.reliability_score, 70) AS passenger_reliability,
    u_driver.license_verified AS driver_verified,
    CASE
      WHEN ms.network_scope = 'network' THEN 'Verified Organization Member'
      ELSE 'Nearby Commuter'
    END AS trust_label
  FROM public.match_suggestions ms
  LEFT JOIN public.rides r ON r.id = ms.ride_id
  LEFT JOIN public.ride_requests rr ON rr.id = ms.ride_request_id
  JOIN public.users u_driver ON u_driver.id = ms.driver_id
  JOIN public.users u_passenger ON u_passenger.id = ms.passenger_id
  WHERE ms.status = 'pending'
    AND (ms.driver_id = p_user_id OR ms.passenger_id = p_user_id)
    AND (
      (p_scope = 'network' AND ms.network_scope = 'network')
      OR (p_scope = 'nearby' AND ms.network_scope = 'extended')
      OR p_scope = 'all'
    )
    AND (NOT p_verified_drivers_only OR u_driver.license_verified = true)
    AND COALESCE(u_driver.reliability_score, 70) >= p_min_reliability
    AND COALESCE(u_passenger.reliability_score, 70) >= p_min_reliability
    AND (
      p_gender_filter IS NULL
      OR p_gender_filter = 'any'
      OR u_driver.gender = p_gender_filter
      OR u_passenger.gender = p_gender_filter
    )
  ORDER BY ms.match_score DESC, ms.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.compute_match_candidates(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_match_suggestions(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discover_matches(uuid, text, boolean, integer, text) TO authenticated;
