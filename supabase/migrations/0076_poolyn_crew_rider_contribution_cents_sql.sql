-- Integer cents per paying rider for Crew Poolyn equal-corridor split (matches app:
-- computeCrewEqualCorridorRiderBreakdown → computePassengerCostBreakdown with detourChargeable = false).
-- Tunables: keep in sync with src/lib/poolynPricingConfig.ts (sedan default, stop fee, adjustment).

CREATE OR REPLACE FUNCTION public.poolyn_crew_equal_corridor_rider_contribution_cents(
  p_locked_distance_m double precision,
  p_locked_duration_s integer,
  p_paying_rider_count integer,
  p_vehicle_class text DEFAULT 'sedan'
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_rate double precision;
  v_capped integer;
  v_d double precision;
  v_seg double precision;
  v_passenger_km double precision;
  v_total_route_km double precision;
  v_total_weight_km double precision;
  v_base integer;
  v_adj integer;
  v_pc integer;
  v_stop integer := 100;
  v_pool_max integer;
  v_var integer;
  v_scale numeric;
  v_sum_var integer;
  v_drift integer;
  v_adj_factor constant double precision := 1.15;
BEGIN
  IF p_locked_distance_m IS NULL OR p_locked_distance_m <= 0 THEN
    RETURN 0;
  END IF;

  v_capped := LEAST(8, GREATEST(1, floor(GREATEST(0, p_paying_rider_count))::integer));
  v_rate := CASE lower(trim(COALESCE(p_vehicle_class, 'sedan')))
    WHEN 'compact' THEN 0.16
    WHEN 'suv' THEN 0.21
    WHEN 'large_suv' THEN 0.26
    WHEN 'electric' THEN 0.17
    ELSE 0.18
  END;

  v_d := p_locked_distance_m;
  v_seg := v_d / v_capped::double precision;
  v_passenger_km := GREATEST(0::double precision, v_seg) / 1000.0;
  v_total_route_km := GREATEST(0::double precision, v_d) / 1000.0;

  IF v_capped > 1 AND v_passenger_km > 0 THEN
    v_total_weight_km := v_passenger_km * v_capped::double precision;
  ELSE
    v_total_weight_km := v_passenger_km;
  END IF;

  IF v_total_route_km <= 0 OR v_total_weight_km <= 0 OR v_passenger_km <= 0 THEN
    RETURN 0;
  END IF;

  v_base := round(v_total_route_km * v_rate * 100.0);
  v_adj := round(v_base::double precision * v_adj_factor);
  v_pc := round((v_passenger_km / v_total_weight_km) * v_adj::double precision);

  IF v_adj > 0 AND v_stop > v_adj THEN
    v_stop := v_adj;
  END IF;

  v_pool_max := GREATEST(0, v_adj - v_stop);
  v_var := v_pc;

  IF v_pool_max > 0 AND v_var > v_pool_max THEN
    v_scale := v_pool_max::numeric / NULLIF(v_var, 0)::numeric;
    v_pc := round(v_pc::numeric * v_scale)::integer;
    v_sum_var := v_pc;
    v_drift := v_pool_max - v_sum_var;
    v_pc := v_pc + v_drift;
  ELSIF v_pool_max = 0 AND v_var > 0 THEN
    v_pc := 0;
  END IF;

  RETURN round(v_pc::double precision + v_stop::double precision)::integer;
END;
$$;

COMMENT ON FUNCTION public.poolyn_crew_equal_corridor_rider_contribution_cents(double precision, integer, integer, text) IS
  'Crew Poolyn rider share in cents (same units as Poolyn Credits). Locked corridor; no extra detour line item.';

REVOKE ALL ON FUNCTION public.poolyn_crew_equal_corridor_rider_contribution_cents(double precision, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_equal_corridor_rider_contribution_cents(double precision, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.poolyn_crew_equal_corridor_rider_contribution_cents(double precision, integer, integer, text) TO service_role;
