/**
 * Cost-sharing (integer cents). Crew Poolyn + Mingle Poolyn + reservations.
 * Rate/stop/factor tunables: `poolynPricingConfig.ts`.
 * Crew corridor split vs per-passenger detour attribution: this file (`computeCrewPerRiderDetourAttributedContributions`).
 */

import {
  POOLYN_CREW_DETOUR_AVG_SPEED_KMH,
  POOLYN_CREW_DETOUR_CHARGE_ROUND_TRIP,
  POOLYN_CREW_MAX_ASSUMED_RIDERS,
  POOLYN_CREW_MAX_PERPENDICULAR_DETOUR_M,
  POOLYN_CREW_MIN_PERPENDICULAR_DETOUR_M,
  POOLYN_DEFAULT_VEHICLE_CLASS,
  POOLYN_MAX_POOL_RIDERS_FOR_SPLIT,
  POOLYN_MINGLE_MIN_POOL_RIDERS,
  POOLYN_MINGLE_USE_EQUAL_CORRIDOR_POOL_WEIGHT,
  POOLYN_STOP_FEE_CENTS,
  POOLYN_SYSTEM_ADJUSTMENT_FACTOR,
  POOLYN_TIME_COST_PER_MIN_AUD,
  poolynDistanceRateAudPerKm,
  type PoolynVehicleClass,
} from "@/lib/poolynPricingConfig";
import { distancePointToSegmentMeters } from "@/lib/geoSegmentDistance";

export type { PoolynVehicleClass } from "@/lib/poolynPricingConfig";

/** @deprecated Use `poolynDistanceRateAudPerKm(POOLYN_DEFAULT_VEHICLE_CLASS)` — alias for sedan-class default. */
export const PRICING_BASE_COST_PER_KM_AUD = poolynDistanceRateAudPerKm(POOLYN_DEFAULT_VEHICLE_CLASS);
export const PRICING_TIME_COST_PER_MIN_AUD = POOLYN_TIME_COST_PER_MIN_AUD;
export const PRICING_DRIVER_BENEFIT_FACTOR = POOLYN_SYSTEM_ADJUSTMENT_FACTOR;
export const SYSTEM_ADJUSTMENT_FACTOR = POOLYN_SYSTEM_ADJUSTMENT_FACTOR;
export const PRICING_STOP_FEE_CENTS = POOLYN_STOP_FEE_CENTS;

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
  /** total_route_distance_km × rate × 100 (same as base_trip_cost_cents). */
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

function baseTripCostCentsFromRouteKm(
  totalRouteDistanceKm: number,
  distanceRateAudPerKm: number
): number {
  return Math.round(Math.max(0, totalRouteDistanceKm) * distanceRateAudPerKm * 100);
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
  /** AUD/km for detour distance line item (defaults to vehicle class rate). */
  distanceRateAudPerKm?: number;
}): { detour_cost: number; time_cost: number } {
  if (!input.isDetourChargeable) {
    return { detour_cost: 0, time_cost: 0 };
  }
  const rate = input.distanceRateAudPerKm ?? poolynDistanceRateAudPerKm(POOLYN_DEFAULT_VEHICLE_CLASS);
  const addedKm = Math.max(0, input.addedDistanceKm);
  const addedSec = Math.max(0, input.addedDurationSeconds);
  const addedMinutes = addedSec / 60;
  const detour_cost = Math.round(addedKm * rate * 100);
  const time_cost = Math.round(addedMinutes * POOLYN_TIME_COST_PER_MIN_AUD * 100);
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
  distanceRateAudPerKm?: number;
}): {
  passenger_contribution: number;
  base_trip_cost_cents: number;
  adjusted_trip_cost_cents: number;
} {
  const { passengerDistanceKm, totalRouteDistanceKm } = input;
  const totalWeight = input.totalPassengerWeightKm ?? passengerDistanceKm;
  const rate =
    input.distanceRateAudPerKm ?? poolynDistanceRateAudPerKm(POOLYN_DEFAULT_VEHICLE_CLASS);

  if (totalRouteDistanceKm <= 0 || totalWeight <= 0 || passengerDistanceKm <= 0) {
    return {
      passenger_contribution: 0,
      base_trip_cost_cents: 0,
      adjusted_trip_cost_cents: 0,
    };
  }

  const base_trip_cost_cents = baseTripCostCentsFromRouteKm(totalRouteDistanceKm, rate);
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

export type PassengerCostBreakdownInput = {
  baselineDistanceM: number;
  baselineDurationS: number;
  withPassengerDistanceM: number;
  withPassengerDurationS: number;
  passengerSegmentDistanceM: number;
  detourChargeable?: boolean;
  addedDistanceKm?: number;
  addedDurationSeconds?: number;
  totalPassengerWeightKm?: number;
  /** Vehicle class → distance rate via `poolynPricingConfig`. */
  vehicleClass?: string | null;
  /**
   * Paying riders splitting Phase-3 detour/time (each pays ~1/N).
   * Mingle: typically max(1, driver_seats - 1). Crew: max(1, members - 1).
   */
  poolRideAlongPassengerCount?: number;
} & DeprecatedPassengerPricingArgs;

export function computePassengerCostBreakdown(input: PassengerCostBreakdownInput): CostBreakdownCents {
  const {
    baselineDistanceM,
    withPassengerDistanceM,
    withPassengerDurationS,
    baselineDurationS,
    passengerSegmentDistanceM,
    detourChargeable = true,
  } = input;

  const distanceRateAudPerKm = poolynDistanceRateAudPerKm(input.vehicleClass);
  const poolN = Math.max(
    POOLYN_MINGLE_MIN_POOL_RIDERS,
    Math.min(POOLYN_MAX_POOL_RIDERS_FOR_SPLIT, input.poolRideAlongPassengerCount ?? 1)
  );

  const addedDistanceKm =
    input.addedDistanceKm ?? Math.max(0, withPassengerDistanceM - baselineDistanceM) / 1000;
  const addedDurationSeconds =
    input.addedDurationSeconds ?? Math.max(0, withPassengerDurationS - baselineDurationS);

  const p3 = computePhase3DetourPricingCents({
    addedDistanceKm,
    addedDurationSeconds,
    isDetourChargeable: detourChargeable,
    distanceRateAudPerKm,
  });

  const passengerKm = Math.max(0, passengerSegmentDistanceM) / 1000;
  const totalRouteKm = Math.max(0, withPassengerDistanceM) / 1000;

  let totalWeightKm = input.totalPassengerWeightKm;
  if (
    totalWeightKm == null &&
    POOLYN_MINGLE_USE_EQUAL_CORRIDOR_POOL_WEIGHT &&
    poolN > 1 &&
    passengerKm > 0
  ) {
    totalWeightKm = passengerKm * poolN;
  }

  const p4 = computePhase4WeightedContributionCents({
    passengerDistanceKm: passengerKm,
    totalRouteDistanceKm: totalRouteKm,
    totalPassengerWeightKm: totalWeightKm,
    distanceRateAudPerKm,
  });

  let passenger_contribution = p4.passenger_contribution;
  let detour_cost = Math.round(p3.detour_cost / poolN);
  let time_cost = Math.round(p3.time_cost / poolN);
  let stop_fee = POOLYN_STOP_FEE_CENTS;

  const base_trip_cost_cents = p4.base_trip_cost_cents;
  const adjusted_trip_cost_cents = p4.adjusted_trip_cost_cents;
  const total_trip_cost_cents = base_trip_cost_cents;
  const max_total_passenger_cents = adjusted_trip_cost_cents;

  if (max_total_passenger_cents > 0 && stop_fee > max_total_passenger_cents) {
    stop_fee = max_total_passenger_cents;
  }

  const poolMax = Math.max(0, max_total_passenger_cents - stop_fee);
  const variableSubtotal = passenger_contribution + detour_cost + time_cost;
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

  const total_contribution = passenger_contribution + detour_cost + time_cost + stop_fee;

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

/**
 * Crew Poolyn: equal split of locked corridor cost among paying riders (one driver assumed).
 * No extra detour line item vs locked route (detour baked into corridor length at formation).
 */
export function computeCrewEqualCorridorRiderBreakdown(input: {
  lockedRouteDistanceM: number;
  lockedRouteDurationS: number;
  /** Paying riders (excludes driver). */
  poolRiderCount: number;
  vehicleClass?: string | null;
}): CostBreakdownCents | null {
  const capped = Math.max(
    1,
    Math.min(POOLYN_CREW_MAX_ASSUMED_RIDERS, Math.floor(input.poolRiderCount))
  );
  const d = input.lockedRouteDistanceM;
  if (!Number.isFinite(d) || d <= 0) return null;
  const dur = Number.isFinite(input.lockedRouteDurationS) ? input.lockedRouteDurationS : 0;
  const seg = d / capped;
  return computePassengerCostBreakdown({
    baselineDistanceM: d,
    baselineDurationS: dur,
    withPassengerDistanceM: d,
    withPassengerDurationS: dur,
    passengerSegmentDistanceM: seg,
    totalPassengerWeightKm: d / 1000,
    detourChargeable: false,
    poolRideAlongPassengerCount: capped,
    vehicleClass: input.vehicleClass ?? undefined,
  });
}

/**
 * Crew Poolyn: locked corridor variable + stop is split equally (`computeCrewEqualCorridorRiderBreakdown`).
 * Extra perpendicular distance off the main commute segment for each paying rider is charged in full to
 * that rider only (Phase 3 distance + time, not divided by pool size). Tunable thresholds and speed:
 * `POOLYN_CREW_*` in `poolynPricingConfig.ts`.
 */
export function computeCrewPerRiderDetourAttributedContributions(input: {
  lockedRouteDistanceM: number;
  lockedRouteDurationS: number;
  /** Paying riders today (non-driver, not excluded), stable order. */
  payingRiderUserIds: string[];
  segmentStart: { lat: number; lng: number };
  segmentEnd: { lat: number; lng: number };
  /** Home pin per user; missing entry means no detour line item for that rider. */
  latLngByUserId: Record<string, { lat: number; lng: number } | undefined>;
  vehicleClass?: string | null;
}): {
  byUserId: Record<string, number>;
  equalCorridorCentsPerRider: number;
  detourCentsByUserId: Record<string, number>;
} | null {
  const poolN = input.payingRiderUserIds.length;
  if (poolN < 1) return null;

  const equal = computeCrewEqualCorridorRiderBreakdown({
    lockedRouteDistanceM: input.lockedRouteDistanceM,
    lockedRouteDurationS: input.lockedRouteDurationS,
    poolRiderCount: poolN,
    vehicleClass: input.vehicleClass,
  });
  if (!equal) return null;

  const equalBase = equal.total_contribution;
  const rate = poolynDistanceRateAudPerKm(input.vehicleClass ?? POOLYN_DEFAULT_VEHICLE_CLASS);

  const byUserId: Record<string, number> = {};
  const detourCentsByUserId: Record<string, number> = {};

  for (const uid of input.payingRiderUserIds) {
    const ll = input.latLngByUserId[uid];
    let detourCents = 0;
    if (ll) {
      const perpM = distancePointToSegmentMeters(
        { lat: ll.lat, lng: ll.lng },
        input.segmentStart,
        input.segmentEnd
      );
      const rawBillable = Math.max(
        0,
        Math.min(perpM, POOLYN_CREW_MAX_PERPENDICULAR_DETOUR_M) -
          POOLYN_CREW_MIN_PERPENDICULAR_DETOUR_M
      );
      const extraKm =
        (rawBillable / 1000) * (POOLYN_CREW_DETOUR_CHARGE_ROUND_TRIP ? 2 : 1);
      const spd = POOLYN_CREW_DETOUR_AVG_SPEED_KMH;
      const addedDurationSeconds = spd > 0 ? (extraKm / spd) * 3600 : 0;
      const p3 = computePhase3DetourPricingCents({
        addedDistanceKm: extraKm,
        addedDurationSeconds,
        isDetourChargeable: rawBillable > 0,
        distanceRateAudPerKm: rate,
      });
      detourCents = p3.detour_cost + p3.time_cost;
    }
    detourCentsByUserId[uid] = detourCents;
    byUserId[uid] = equalBase + detourCents;
  }

  return { byUserId, equalCorridorCentsPerRider: equalBase, detourCentsByUserId };
}

/**
 * Profile / commute UI: illustrative one-way cash band (not a quote).
 */
export function estimateIllustrativeCommuteContributionRangeAud(
  distanceKm: number,
  vehicleClass?: string | null
): {
  low: string;
  high: string;
} {
  const d = distanceKm;
  if (!Number.isFinite(d) || d <= 0) {
    return { low: "—", high: "—" };
  }
  const km = Math.min(Math.max(d, 0), 250);
  const rate = poolynDistanceRateAudPerKm(vehicleClass ?? POOLYN_DEFAULT_VEHICLE_CLASS);
  const variableAud = km * rate * POOLYN_SYSTEM_ADJUSTMENT_FACTOR;
  const stopAud = POOLYN_STOP_FEE_CENTS / 100;
  const lowAud = Math.max(0.85, variableAud * 0.975 + stopAud);
  const highAud = Math.min(variableAud * 1.025 + stopAud + 0.1, 95);
  return { low: lowAud.toFixed(2), high: highAud.toFixed(2) };
}
