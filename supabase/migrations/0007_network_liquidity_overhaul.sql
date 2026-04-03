-- =============================================================
-- Migration 0007: Network + liquidity first matching foundations
-- =============================================================

-- 1) User-level matching and visibility controls
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS visibility_mode text NOT NULL DEFAULT 'network'
    CHECK (visibility_mode IN ('network', 'nearby')),
  ADD COLUMN IF NOT EXISTS reliability_score integer NOT NULL DEFAULT 70
    CHECK (reliability_score >= 0 AND reliability_score <= 100),
  ADD COLUMN IF NOT EXISTS schedule_flex_mins integer NOT NULL DEFAULT 15
    CHECK (schedule_flex_mins >= 0 AND schedule_flex_mins <= 120),
  ADD COLUMN IF NOT EXISTS home_geohash text,
  ADD COLUMN IF NOT EXISTS work_geohash text;

CREATE INDEX IF NOT EXISTS idx_users_visibility_mode
  ON public.users (visibility_mode);

CREATE INDEX IF NOT EXISTS idx_users_reliability_score
  ON public.users (reliability_score DESC)
  WHERE active = true AND onboarding_completed = true;

CREATE INDEX IF NOT EXISTS idx_users_home_geohash
  ON public.users (home_geohash)
  WHERE home_geohash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_work_geohash
  ON public.users (work_geohash)
  WHERE work_geohash IS NOT NULL;

-- 2) Ride clustering keys for heatmap/supply-demand overlays
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS origin_cluster text,
  ADD COLUMN IF NOT EXISTS destination_cluster text;

CREATE INDEX IF NOT EXISTS idx_rides_origin_cluster
  ON public.rides (origin_cluster)
  WHERE origin_cluster IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rides_destination_cluster
  ON public.rides (destination_cluster)
  WHERE destination_cluster IS NOT NULL;

-- 3) Match metadata needed for scoring transparency + network scope
ALTER TABLE public.match_suggestions
  ADD COLUMN IF NOT EXISTS route_similarity_score real
    CHECK (route_similarity_score IS NULL OR (route_similarity_score >= 0 AND route_similarity_score <= 1)),
  ADD COLUMN IF NOT EXISTS time_overlap_mins integer,
  ADD COLUMN IF NOT EXISTS network_scope text NOT NULL DEFAULT 'network'
    CHECK (network_scope IN ('network', 'extended'));

CREATE INDEX IF NOT EXISTS idx_match_suggestions_network_scope
  ON public.match_suggestions (network_scope, status);

CREATE INDEX IF NOT EXISTS idx_match_suggestions_route_similarity
  ON public.match_suggestions (route_similarity_score DESC)
  WHERE status = 'pending';
