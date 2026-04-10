/**
 * Phase 1-2: baseline vs adjusted Mapbox routes, detour metrics, and chargeable flag.
 * Single provider: Mapbox Directions (same profile for baseline and adjusted; order preserved).
 *
 * Phase 3-4 pricing: `costModel.ts` (`computePhase3DetourPricingCents`, `computePhase4WeightedContributionCents`,
 * `computePassengerCostBreakdown`) uses engine deltas + `is_detour_chargeable`.
 */

import {
  fetchDrivingRoute,
  type DirectionsRoute,
  type LngLat,
  type MapboxDirectionsProfile,
} from "@/lib/mapboxDirections";

/** Phase 2: strict thresholds (no partial scaling). */
export const DETOUR_DISTANCE_THRESHOLD_KM = 0.1;
export const DETOUR_TIME_THRESHOLD_MIN = 1;

export interface DetourRouteInputs {
  driver_origin: LngLat;
  driver_destination: LngLat;
  passenger_pickup: LngLat;
  passenger_dropoff: LngLat;
}

export interface DetourRouteEngineMetrics {
  baseline_distance_meters: number;
  baseline_duration_seconds: number;
  baseline_polyline: LngLat[];
  baseline_bbox: { min_lng: number; min_lat: number; max_lng: number; max_lat: number } | null;
  adjusted_distance_meters: number;
  adjusted_duration_seconds: number;
  adjusted_polyline: LngLat[];
  added_distance_meters: number;
  added_duration_seconds: number;
  added_distance_km: number;
  added_duration_minutes: number;
  is_detour_chargeable: boolean;
}

export type ComputeDetourRouteResult =
  | { ok: true; data: DetourRouteEngineMetrics }
  | { ok: false; error: string };

function bboxFromCoordinates(coords: LngLat[]): DetourRouteEngineMetrics["baseline_bbox"] {
  if (!coords.length) return null;
  let min_lng = Infinity;
  let min_lat = Infinity;
  let max_lng = -Infinity;
  let max_lat = -Infinity;
  for (const [lng, lat] of coords) {
    min_lng = Math.min(min_lng, lng);
    max_lng = Math.max(max_lng, lng);
    min_lat = Math.min(min_lat, lat);
    max_lat = Math.max(max_lat, lat);
  }
  return { min_lng, min_lat, max_lng, max_lat };
}

/**
 * Phase 2: chargeable if either distance or time exceeds the small-trip floor.
 * `added_duration_minutes` uses floor(seconds / 60) per spec.
 */
export function evaluateDetourChargeable(
  added_distance_km: number,
  added_duration_minutes: number
): boolean {
  if (
    added_distance_km <= DETOUR_DISTANCE_THRESHOLD_KM &&
    added_duration_minutes <= DETOUR_TIME_THRESHOLD_MIN
  ) {
    return false;
  }
  return true;
}

/**
 * Phase 1 + 2 in one call.
 * @param baselineRouteIfKnown when provided (same O-D as driver_origin->driver_destination), baseline is not re-fetched.
 */
export async function computeDriverPassengerDetourMetrics(
  input: DetourRouteInputs & {
    profile?: MapboxDirectionsProfile;
    baselineRouteIfKnown?: DirectionsRoute;
  }
): Promise<ComputeDetourRouteResult> {
  const profile = input.profile ?? "mapbox/driving-traffic";

  let baseline: DirectionsRoute;
  if (input.baselineRouteIfKnown) {
    baseline = input.baselineRouteIfKnown;
  } else {
    const b = await fetchDrivingRoute(
      [input.driver_origin, input.driver_destination],
      profile
    );
    if (!b.ok) return { ok: false, error: `baseline_route:${b.error}` };
    baseline = b.route;
  }

  const adjusted = await fetchDrivingRoute(
    [
      input.driver_origin,
      input.passenger_pickup,
      input.passenger_dropoff,
      input.driver_destination,
    ],
    profile
  );
  if (!adjusted.ok) return { ok: false, error: `adjusted_route:${adjusted.error}` };

  const added_distance_meters = Math.max(
    0,
    adjusted.route.distanceM - baseline.distanceM
  );
  const added_duration_seconds = Math.max(
    0,
    adjusted.route.durationS - baseline.durationS
  );
  const added_distance_km = added_distance_meters / 1000;
  const added_duration_minutes = Math.floor(added_duration_seconds / 60);

  const is_detour_chargeable = evaluateDetourChargeable(
    added_distance_km,
    added_duration_minutes
  );

  return {
    ok: true,
    data: {
      baseline_distance_meters: baseline.distanceM,
      baseline_duration_seconds: baseline.durationS,
      baseline_polyline: baseline.coordinates,
      baseline_bbox: bboxFromCoordinates(baseline.coordinates),
      adjusted_distance_meters: adjusted.route.distanceM,
      adjusted_duration_seconds: adjusted.route.durationS,
      adjusted_polyline: adjusted.route.coordinates,
      added_distance_meters,
      added_duration_seconds,
      added_distance_km,
      added_duration_minutes,
      is_detour_chargeable,
    },
  };
}
