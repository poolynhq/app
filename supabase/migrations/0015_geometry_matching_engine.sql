-- =============================================================
-- Migration 0015: Geometry-first commute matching (replaces proximity)
-- See docs/POOLYN_MATCHING_SPEC.md
-- =============================================================

-- ── 1. Vehicle class (cost model is class-based, not user-edited) ────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_class text NOT NULL DEFAULT 'sedan'
    CHECK (vehicle_class IN ('compact', 'sedan', 'suv', 'large_suv', 'electric'));

-- ── 2. Commute routes (Mapbox-derived home → work) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.commute_routes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  direction             text NOT NULL DEFAULT 'to_work'
    CHECK (direction IN ('to_work', 'from_work')),
  encoded_polyline      text,
  route_geom            geography (LineString, 4326) NOT NULL,
  distance_m            double precision NOT NULL,
  duration_s            double precision NOT NULL,
  bbox_min_lng          double precision NOT NULL,
  bbox_min_lat          double precision NOT NULL,
  bbox_max_lng          double precision NOT NULL,
  bbox_max_lat          double precision NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_commute_routes_user ON public.commute_routes (user_id);
CREATE INDEX IF NOT EXISTS idx_commute_routes_geom ON public.commute_routes USING gist (route_geom);

-- ── 3. Global + org matching / pricing config ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matching_config_global (
  id                              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  currency                        text NOT NULL DEFAULT 'AUD',
  compact_cpk_cents_per_km        integer NOT NULL DEFAULT 14,
  sedan_cpk_cents_per_km          integer NOT NULL DEFAULT 16,
  suv_cpk_cents_per_km            integer NOT NULL DEFAULT 20,
  large_suv_cpk_cents_per_km      integer NOT NULL DEFAULT 24,
  electric_cpk_cents_per_km       integer NOT NULL DEFAULT 12,
  pickup_fee_cents                integer NOT NULL DEFAULT 50,
  time_penalty_rate_cents_per_min integer NOT NULL DEFAULT 10,
  time_penalty_cap_cents          integer NOT NULL DEFAULT 200,
  capped_margin_bps               integer NOT NULL DEFAULT 500,
  corridor_buffer_m               integer NOT NULL DEFAULT 400,
  overlap_min_ratio               real NOT NULL DEFAULT 0.12,
  default_detour_tolerance_mins   integer NOT NULL DEFAULT 12,
  reservation_ttl_seconds         integer NOT NULL DEFAULT 120,
  fuel_rate_fallback_cents_per_km integer NOT NULL DEFAULT 16,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.matching_config_global (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.matching_config_org (
  org_id                     uuid PRIMARY KEY REFERENCES public.organisations (id) ON DELETE CASCADE,
  sedan_cpk_cents_per_km     integer,
  pickup_fee_cents           integer,
  capped_margin_bps          integer,
  corridor_buffer_m          integer,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Optional daily departure override ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_commute_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  override_date   date NOT NULL,
  depart_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, override_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_override_user_date ON public.daily_commute_overrides (user_id, override_date);

-- ── 5. Reservations (seat + TTL) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ride_reservations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id                  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  passenger_id               uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  driver_commute_route_id    uuid NOT NULL REFERENCES public.commute_routes (id) ON DELETE CASCADE,
  passenger_commute_route_id uuid NOT NULL REFERENCES public.commute_routes (id) ON DELETE CASCADE,
  status                     text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'confirmed', 'expired', 'cancelled')),
  reserved_until             timestamptz NOT NULL,
  passenger_cost_cents       integer,
  cost_breakdown             jsonb NOT NULL DEFAULT '{}',
  overlap_ratio              real,
  detour_distance_m          real,
  detour_time_s              real,
  pickup_eta_hint            text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK (driver_id <> passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_ride_res_driver_day ON public.ride_reservations (driver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ride_res_passenger ON public.ride_reservations (passenger_id);

-- ── 6. Overlap helper (fraction of driver route “covered” by passenger H→W) ─
CREATE OR REPLACE FUNCTION public.route_overlap_ratio(
  p_route geography,
  p_home  geography,
  p_work  geography
) RETURNS double precision
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  g_line geometry;
  g_home geometry;
  g_work geometry;
  len_m  double precision;
  la     double precision;
  lb     double precision;
BEGIN
  IF p_route IS NULL THEN RETURN 0; END IF;
  len_m := ST_Length(p_route::geography);
  IF len_m IS NULL OR len_m < 1 THEN RETURN 0; END IF;

  g_line := p_route::geometry;
  g_home := ST_ClosestPoint(g_line, p_home::geometry);
  g_work := ST_ClosestPoint(g_line, p_work::geometry);
  la := ST_LineLocatePoint(g_line, g_home);
  lb := ST_LineLocatePoint(g_line, g_work);

  RETURN LEAST(
    1.0::double precision,
    GREATEST(
      0.0::double precision,
      (abs(lb - la) * len_m) / NULLIF(len_m, 0)
    )
  );
END;
$$;

-- ── 7. Drop legacy proximity matcher ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.find_commuter_matches(uuid, integer, integer, text);

-- ── 8. Prefilter: org + bbox + roles + vehicles (no Mapbox detour here) ─────
CREATE OR REPLACE FUNCTION public.prefilter_commute_match_pairs(
  p_viewer_id           uuid,
  p_include_local_pool  boolean DEFAULT false
)
RETURNS TABLE (
  driver_id            uuid,
  passenger_id         uuid,
  driver_route_id      uuid,
  passenger_route_id   uuid,
  overlap_ratio_initial real
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
    )::real AS overlap_ratio_initial
  FROM drivers d
  JOIN passengers p ON d.uid <> p.uid
  JOIN viewer vz ON true
  WHERE
    (
      (vz.role IN ('passenger', 'both') AND p.uid = p_viewer_id AND d.uid <> p_viewer_id)
      OR
      (vz.role IN ('driver', 'both') AND d.uid = p_viewer_id AND p.uid <> p_viewer_id)
    )
    AND (SELECT home_location FROM public.users WHERE id = p.uid) IS NOT NULL
    AND (SELECT work_location FROM public.users WHERE id = p.uid) IS NOT NULL
    AND d.oid IS NOT DISTINCT FROM vz.org_id
    AND p.oid IS NOT DISTINCT FROM vz.org_id
    -- p_include_local_pool reserved for future corridor-based cross-org matching (off in V1)
    AND NOT (d.bbox_max_lng < p.bbox_min_lng OR d.bbox_min_lng > p.bbox_max_lng
         OR d.bbox_max_lat < p.bbox_min_lat OR d.bbox_min_lat > p.bbox_max_lat)
    AND EXISTS (SELECT 1 FROM viewer_route vr WHERE vr.id IS NOT NULL)
  LIMIT 80;
$$;

GRANT EXECUTE ON FUNCTION public.prefilter_commute_match_pairs(uuid, boolean) TO authenticated;

-- ── 9. Count peers (insights / home screen) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_geometry_match_peers(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM public.prefilter_commute_match_pairs(p_user_id, false);
$$;

GRANT EXECUTE ON FUNCTION public.count_geometry_match_peers(uuid) TO authenticated;

-- ── 10. Merged matching config (global + org overrides) ─────────────────────
CREATE OR REPLACE FUNCTION public.get_matching_config(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g  public.matching_config_global%ROWTYPE;
  o  public.matching_config_org%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.matching_config_global WHERE id = 1;
  SELECT * INTO o FROM public.matching_config_org WHERE org_id = p_org_id;

  RETURN jsonb_build_object(
    'currency', g.currency,
    'compact_cpk_cents_per_km', g.compact_cpk_cents_per_km,
    'sedan_cpk_cents_per_km', COALESCE(o.sedan_cpk_cents_per_km, g.sedan_cpk_cents_per_km),
    'suv_cpk_cents_per_km', g.suv_cpk_cents_per_km,
    'large_suv_cpk_cents_per_km', g.large_suv_cpk_cents_per_km,
    'electric_cpk_cents_per_km', g.electric_cpk_cents_per_km,
    'pickup_fee_cents', COALESCE(o.pickup_fee_cents, g.pickup_fee_cents),
    'time_penalty_rate_cents_per_min', g.time_penalty_rate_cents_per_min,
    'time_penalty_cap_cents', g.time_penalty_cap_cents,
    'capped_margin_bps', COALESCE(o.capped_margin_bps, g.capped_margin_bps),
    'corridor_buffer_m', COALESCE(o.corridor_buffer_m, g.corridor_buffer_m),
    'overlap_min_ratio', g.overlap_min_ratio,
    'default_detour_tolerance_mins', g.default_detour_tolerance_mins,
    'reservation_ttl_seconds', g.reservation_ttl_seconds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_matching_config(uuid) TO authenticated;

-- ── 11. Reserve seat (TTL, atomic seat check) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_commute_ride(
  p_driver_id uuid,
  p_driver_route_id uuid,
  p_passenger_route_id uuid,
  p_cost_breakdown jsonb DEFAULT '{}'::jsonb,
  p_passenger_cost_cents integer DEFAULT NULL,
  p_overlap_ratio real DEFAULT NULL,
  p_detour_distance_m real DEFAULT NULL,
  p_detour_time_s real DEFAULT NULL,
  p_pickup_eta_hint text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me           uuid := auth.uid();
  ttl_sec      integer;
  seats_cap    integer;
  used_seats   integer;
  res_id       uuid;
  res_until    timestamptz;
BEGIN
  IF me IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_driver_id = me THEN
    RETURN json_build_object('ok', false, 'reason', 'cannot_reserve_own_trip');
  END IF;

  SELECT reservation_ttl_seconds INTO ttl_sec FROM public.matching_config_global WHERE id = 1;
  IF ttl_sec IS NULL THEN ttl_sec := 120; END IF;

  SELECT v.seats - 1 INTO seats_cap
  FROM public.vehicles v
  WHERE v.user_id = p_driver_id AND v.active = true
  ORDER BY v.created_at DESC
  LIMIT 1;

  IF seats_cap IS NULL OR seats_cap < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_vehicle');
  END IF;

  SELECT COUNT(*)::integer INTO used_seats
  FROM public.ride_reservations r
  WHERE r.driver_id = p_driver_id
    AND r.status = 'reserved'
    AND r.reserved_until > now()
    AND r.created_at::date = (now() AT TIME ZONE 'utc')::date;

  IF used_seats >= seats_cap THEN
    RETURN json_build_object('ok', false, 'reason', 'no_seats');
  END IF;

  res_until := now() + (ttl_sec || ' seconds')::interval;
  INSERT INTO public.ride_reservations (
    driver_id, passenger_id, driver_commute_route_id, passenger_commute_route_id,
    status, reserved_until, passenger_cost_cents, cost_breakdown,
    overlap_ratio, detour_distance_m, detour_time_s, pickup_eta_hint
  ) VALUES (
    p_driver_id, me, p_driver_route_id, p_passenger_route_id,
    'reserved', res_until, p_passenger_cost_cents, COALESCE(p_cost_breakdown, '{}'::jsonb),
    p_overlap_ratio, p_detour_distance_m, p_detour_time_s, p_pickup_eta_hint
  )
  RETURNING id INTO res_id;

  RETURN json_build_object(
    'ok', true,
    'reservation_id', res_id,
    'reserved_until', res_until
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_commute_ride(uuid, uuid, uuid, jsonb, integer, real, real, real, text) TO authenticated;

-- ── 12. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.commute_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_config_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_config_org ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_commute_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY commute_routes_own_rw ON public.commute_routes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY commute_routes_org_read ON public.commute_routes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u_self
      JOIN public.users u_row ON u_row.org_id IS NOT DISTINCT FROM u_self.org_id
      WHERE u_self.id = auth.uid() AND u_row.id = commute_routes.user_id
    )
  );

CREATE POLICY matching_global_read ON public.matching_config_global FOR SELECT USING (true);
CREATE POLICY matching_org_read ON public.matching_config_org FOR SELECT USING (true);

CREATE POLICY daily_override_own ON public.daily_commute_overrides
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY ride_reservation_participant ON public.ride_reservations
  FOR ALL USING (driver_id = auth.uid() OR passenger_id = auth.uid())
  WITH CHECK (driver_id = auth.uid() OR passenger_id = auth.uid());

CREATE TRIGGER set_updated_at_commute_routes BEFORE UPDATE ON public.commute_routes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_ride_reservations BEFORE UPDATE ON public.ride_reservations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
