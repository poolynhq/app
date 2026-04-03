/**
 * Cost-sharing (integer cents). Unified BASE_COST_PER_KM; no vehicle-class pricing.
 * Phase 3-4: weighted contribution, conditional detour/time, fixed stop fee.
 */

/** AUD per km (all distance-based pricing). */
export const PRICING_BASE_COST_PER_KM_AUD = 0.18;
/** AUD per minute for chargeable detour time (fractional minutes allowed). */
export const PRICING_TIME_COST_PER_MIN_AUD = 0.3;
/** Applied to base trip cost (driver / system adjustment). */
export const PRICING_DRIVER_BENEFIT_FACTOR = 1.15;
export const SYSTEM_ADJUSTMENT_FACTOR = PRICING_DRIVER_BENEFIT_FACTOR;
/** Fixed stop fee per picked-up passenger (cents). */
export const PRICING_STOP_FEE_CENTS = 100;

/**
 * @deprecated Matching config types are no longer used for passenger pricing.
 * Kept for typings / future admin UI; do not use for computePassengerCostBreakdown.
 */
export interface MatchingConfigCents {
  /** @deprecated */
  vehicleClass: "compact" | "sedan" | "suv" | "large_suv" | "electric";
  /** @deprecated Replaced by PRICING_BASE_COST_PER_KM_AUD. */
  classCostPerKmCents: number;
  /** @deprecated Replaced by PRICING_STOP_FEE_CENTS. */
  pickupFeeCents: number;
  /** @deprecated Replaced by PRICING_TIME_COST_PER_MIN_AUD. */
  timePenaltyRateCentsPerMin: number;
  /** @deprecated Not used. */
  timePenaltyCapCents: number;
  /** @deprecated Cap uses adjusted_trip_cost_cents only. */
  cappedMarginBps: number;
}

export interface CostBreakdownCents {
  passenger_contribution: number;
  detour_cost: number;
  time_cost: number;
  stop_fee: number;
  total_contribution: number;
  /** total_route_distance_km × BASE_COST_PER_KM × 100 (same as base_trip_cost_cents). */
  total_trip_cost_cents: number;
  base_trip_cost_cents: number;
  adjusted_trip_cost_cents: number;
  /** Ceiling before scaling: base × SYSTEM_ADJUSTMENT_FACTOR (same as adjusted_trip_cost_cents). */
  max_total_passenger_cents: number;
  scaled_to_cap: boolean;
}

const CLASS_TO_CONFIG_KEY = {
  compact: "compact_cpk_cents_per_km",
  sedan: "sedan_cpk_cents_per_km",
  suv: "suv_cpk_cents_per_km",
  large_suv: "large_suv_cpk_cents_per_km",
  electric: "electric_cpk_cents_per_km",
} as const;

/**
 * @deprecated Vehicle class does not affect pricing. For legacy/admin use only.
 */
export function resolveClassCostPerKmCents(
  config: Record<string, unknown>,
  vehicleClass: MatchingConfigCents["vehicleClass"]
): number {
  const key = CLASS_TO_CONFIG_KEY[vehicleClass];
  const v = config[key];
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  return 16;
}

/**
 * @deprecated Use total_route_km × PRICING_BASE_COST_PER_KM_AUD × 100 for trip base cents.
 */
export function computeTotalTripCostCents(
  baselineDistanceM: number,
  classCostPerKmCents: number
): number {
  const km = baselineDistanceM / 1000;
  return Math.round(km * classCostPerKmCents);
}

function baseTripCostCentsFromRouteKm(totalRouteDistanceKm: number): number {
  return Math.round(
    Math.max(0, totalRouteDistanceKm) * PRICING_BASE_COST_PER_KM_AUD * 100
  );
}

function adjustedTripCostCentsFromBase(baseCents: number): number {
  return Math.round(Math.max(0, baseCents) * SYSTEM_ADJUSTMENT_FACTOR);
}

/**
 * Phase 3: detour distance + time (cents), only when chargeable.
 * Non-negative inputs; rounding once per line.
 */
export function computePhase3DetourPricingCents(input: {
  addedDistanceKm: number;
  addedDurationSeconds: number;
  isDetourChargeable: boolean;
}): { detour_cost: number; time_cost: number } {
  if (!input.isDetourChargeable) {
    return { detour_cost: 0, time_cost: 0 };
  }
  const addedKm = Math.max(0, input.addedDistanceKm);
  const addedSec = Math.max(0, input.addedDurationSeconds);
  const addedMinutes = addedSec / 60;
  const detour_cost = Math.round(addedKm * PRICING_BASE_COST_PER_KM_AUD * 100);
  const time_cost = Math.round(addedMinutes * PRICING_TIME_COST_PER_MIN_AUD * 100);
  return { detour_cost, time_cost };
}

/**
 * Phase 4: passenger_contribution = (weight_i / totalPassengerWeightKm) × adjusted_trip_cost_cents.
 * If totalPassengerWeightKm omitted, uses passenger distance only (single passenger).
 */
export function computePhase4WeightedContributionCents(input: {
  passengerDistanceKm: number;
  totalRouteDistanceKm: number;
  totalPassengerWeightKm?: number;
}): {
  passenger_contribution: number;
  base_trip_cost_cents: number;
  adjusted_trip_cost_cents: number;
} {
  const { passengerDistanceKm, totalRouteDistanceKm } = input;
  const totalWeight = input.totalPassengerWeightKm ?? passengerDistanceKm;

  if (totalRouteDistanceKm <= 0 || totalWeight <= 0 || passengerDistanceKm <= 0) {
    return {
      passenger_contribution: 0,
      base_trip_cost_cents: 0,
      adjusted_trip_cost_cents: 0,
    };
  }

  const base_trip_cost_cents = baseTripCostCentsFromRouteKm(totalRouteDistanceKm);
  const adjusted_trip_cost_cents = adjustedTripCostCentsFromBase(base_trip_cost_cents);
  const passenger_contribution = Math.round(
    (passengerDistanceKm / totalWeight) * adjusted_trip_cost_cents
  );

  return {
    passenger_contribution,
    base_trip_cost_cents,
    adjusted_trip_cost_cents,
  };
}

/**
 * @deprecated Ignored if provided. Kept for call-site stability.
 */
export type DeprecatedPassengerPricingArgs = {
  /** @deprecated */
  classCostPerKmCents?: number;
  /** @deprecated */
  pickupFeeCents?: number;
  /** @deprecated */
  timePenaltyRateCentsPerMin?: number;
  /** @deprecated */
  timePenaltyCapCents?: number;
  /** @deprecated */
  cappedMarginBps?: number;
};

export function computePassengerCostBreakdown(
  input: {
    baselineDistanceM: number;
    baselineDurationS: number;
    withPassengerDistanceM: number;
    withPassengerDurationS: number;
    passengerSegmentDistanceM: number;
    detourChargeable?: boolean;
    addedDistanceKm?: number;
    addedDurationSeconds?: number;
    totalPassengerWeightKm?: number;
  } & DeprecatedPassengerPricingArgs
): CostBreakdownCents {
  const {
    baselineDistanceM,
    withPassengerDistanceM,
    withPassengerDurationS,
    baselineDurationS,
    passengerSegmentDistanceM,
    detourChargeable = true,
  } = input;

  const addedDistanceKm =
    input.addedDistanceKm ??
    Math.max(0, withPassengerDistanceM - baselineDistanceM) / 1000;
  const addedDurationSeconds =
    input.addedDurationSeconds ??
    Math.max(0, withPassengerDurationS - baselineDurationS);

  const p3 = computePhase3DetourPricingCents({
    addedDistanceKm,
    addedDurationSeconds,
    isDetourChargeable: detourChargeable,
  });

  const passengerKm = Math.max(0, passengerSegmentDistanceM) / 1000;
  const totalRouteKm = Math.max(0, withPassengerDistanceM) / 1000;
  const p4 = computePhase4WeightedContributionCents({
    passengerDistanceKm: passengerKm,
    totalRouteDistanceKm: totalRouteKm,
    totalPassengerWeightKm: input.totalPassengerWeightKm,
  });

  let passenger_contribution = p4.passenger_contribution;
  let detour_cost = p3.detour_cost;
  let time_cost = p3.time_cost;
  let stop_fee = PRICING_STOP_FEE_CENTS;

  const base_trip_cost_cents = p4.base_trip_cost_cents;
  const adjusted_trip_cost_cents = p4.adjusted_trip_cost_cents;
  const total_trip_cost_cents = base_trip_cost_cents;
  const max_total_passenger_cents = adjusted_trip_cost_cents;

  /** Stop is fixed at PRICING_STOP_FEE_CENTS unless cap cannot cover it. */
  if (max_total_passenger_cents > 0 && stop_fee > max_total_passenger_cents) {
    stop_fee = max_total_passenger_cents;
  }

  const poolMax = Math.max(0, max_total_passenger_cents - stop_fee);
  const variableSubtotal =
    passenger_contribution + detour_cost + time_cost;
  let scaled_to_cap = false;
  if (variableSubtotal > poolMax && poolMax > 0) {
    const scale = poolMax / variableSubtotal;
    passenger_contribution = Math.round(passenger_contribution * scale);
    detour_cost = Math.round(detour_cost * scale);
    time_cost = Math.round(time_cost * scale);
    scaled_to_cap = true;
    const sumVar = passenger_contribution + detour_cost + time_cost;
    const drift = poolMax - sumVar;
    passenger_contribution += drift;
  } else if (variableSubtotal > poolMax && poolMax === 0) {
    passenger_contribution = 0;
    detour_cost = 0;
    time_cost = 0;
    scaled_to_cap = variableSubtotal > 0;
  }

  const total_contribution =
    passenger_contribution + detour_cost + time_cost + stop_fee;

  return {
    passenger_contribution,
    detour_cost,
    time_cost,
    stop_fee,
    total_contribution: Math.round(total_contribution),
    total_trip_cost_cents,
    base_trip_cost_cents,
    adjusted_trip_cost_cents,
    max_total_passenger_cents,
    scaled_to_cap,
  };
}
