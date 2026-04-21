/**
 * Single source of truth for Poolyn cost-sharing tunables (Crew + Mingle + profile estimates).
 * Adjust fuel reference, class multipliers, time rates, and system factors here only.
 */

export type PoolynVehicleClass = "compact" | "sedan" | "suv" | "large_suv" | "electric";

/** Reference pump price (AUD/L) — for ops / copy only; effective rates below drive billing math. */
export const POOLYN_REFERENCE_FUEL_AUD_PER_LITRE = 1.85;

/**
 * Reference consumption (L/100 km) by class — documentation / future fuel-linked formulas.
 * Electric uses a nominal low value; use `POOLYN_BASE_COST_PER_KM_AUD_BY_CLASS.electric` for money.
 */
export const POOLYN_REFERENCE_LITRES_PER_100KM: Record<PoolynVehicleClass, number> = {
  compact: 6.5,
  sedan: 7.5,
  suv: 9.5,
  large_suv: 12,
  electric: 0,
};

/**
 * Effective AUD per km before `POOLYN_SYSTEM_ADJUSTMENT_FACTOR` (cost recovery baseline).
 * Tune relative spread between classes here.
 */
export const POOLYN_BASE_COST_PER_KM_AUD_BY_CLASS: Record<PoolynVehicleClass, number> = {
  compact: 0.16,
  sedan: 0.18,
  suv: 0.21,
  large_suv: 0.26,
  electric: 0.17,
};

export const POOLYN_DEFAULT_VEHICLE_CLASS: PoolynVehicleClass = "sedan";

/** AUD per minute for chargeable detour time (after detour thresholds). */
export const POOLYN_TIME_COST_PER_MIN_AUD = 0.3;

/** Applied to summed distance-based trip variable (driver / platform adjustment). */
export const POOLYN_SYSTEM_ADJUSTMENT_FACTOR = 1.15;

/** Fixed stop / pickup fee per paying rider (cents). */
export const POOLYN_STOP_FEE_CENTS = 100;

export type PoolynTripFeeContext = "mingle" | "crew";

/**
 * **Mingle / ad-hoc Poolyn**: network fee on trip share for independent riders (no active workplace
 * subscription). Stripe Connect destination charge: customer pays contribution + fee; application fee
 * is the platform portion. Keep in sync with `supabase/migrations/0094_stripe_connect_marketplace_fees.sql`.
 */
export const POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION = 0.15;

/**
 * **Crew Poolyn**: coordination fee per rider on that rider’s share (group travel).
 */
export const POOLYN_CREW_EXPLORER_ADMIN_FEE_FRACTION = 0.1;

/**
 * Explorer admin fee rate applied in `poolyn_crew_trip_finish_and_settle_credits` on each rider’s
 * contribution (Poolyn balance settlement). Must stay aligned with crew trip SQL migrations (currently 4%).
 * Display copy and transaction history use this for labels; changing billing requires a migration too.
 */
export const POOLYN_CREW_CREDITS_SETTLEMENT_EXPLORER_FEE_RATE = 0.04;

// --- Crew Poolyn: detour attributed to each passenger (off main commute segment) ---

/** Below this perpendicular distance (m) from the corridor segment, no detour surcharge. */
export const POOLYN_CREW_MIN_PERPENDICULAR_DETOUR_M = 40;

/** Cap perpendicular distance (m) used for detour pricing. */
export const POOLYN_CREW_MAX_PERPENDICULAR_DETOUR_M = 8000;

/** If true, chargeable detour km uses 2× perpendicular distance (hook out and back). If false, one-way. */
export const POOLYN_CREW_DETOUR_CHARGE_ROUND_TRIP = true;

/** Average speed (km/h) for extra time on detour legs. */
export const POOLYN_CREW_DETOUR_AVG_SPEED_KMH = 35;

/** @deprecated Use {@link POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION} or crew fraction by context. */
export const POOLYN_EXPLORER_NETWORK_FEE_FRACTION = POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION;

export function poolynExplorerCashFeeFraction(context: PoolynTripFeeContext): number {
  return context === "crew"
    ? POOLYN_CREW_EXPLORER_ADMIN_FEE_FRACTION
    : POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION;
}

/**
 * Mingle Poolyn: assume this many riders (including the matched passenger) share the **corridor** portion
 * of variable cost equally. Also splits Phase-3 detour $ across the same count.
 * Default = max(1, seats - 1) is applied at call sites using vehicle seats.
 */
export const POOLYN_MINGLE_MIN_POOL_RIDERS = 1;

/** Hard cap on riders used to split detour + pooled corridor math (Crew + Mingle). */
export const POOLYN_MAX_POOL_RIDERS_FOR_SPLIT = 8;

export const POOLYN_MINGLE_MAX_ASSUMED_RIDERS = POOLYN_MAX_POOL_RIDERS_FOR_SPLIT;

/**
 * When true, total passenger weight for Phase-4 = (this passenger’s corridor km) × poolRiderCount,
 * so each rider’s share of the adjusted trip variable is ~1/N (same corridor length).
 * When false, weight defaults to this passenger’s km only (legacy single-rider feel).
 */
export const POOLYN_MINGLE_USE_EQUAL_CORRIDOR_POOL_WEIGHT = true;

/**
 * Crew Poolyn: paying riders excluding driver. Call sites use max(1, memberCount - 1).
 */
export const POOLYN_CREW_MAX_ASSUMED_RIDERS = POOLYN_MAX_POOL_RIDERS_FOR_SPLIT;

const CLASS_SET = new Set<PoolynVehicleClass>([
  "compact",
  "sedan",
  "suv",
  "large_suv",
  "electric",
]);

export function normalizePoolynVehicleClass(raw: string | null | undefined): PoolynVehicleClass {
  const c = (raw ?? "").trim().toLowerCase();
  if (CLASS_SET.has(c as PoolynVehicleClass)) return c as PoolynVehicleClass;
  return POOLYN_DEFAULT_VEHICLE_CLASS;
}

/** Distance rate (AUD/km) used before system adjustment. */
export function poolynDistanceRateAudPerKm(vehicleClass?: string | null): number {
  return POOLYN_BASE_COST_PER_KM_AUD_BY_CLASS[normalizePoolynVehicleClass(vehicleClass)];
}
