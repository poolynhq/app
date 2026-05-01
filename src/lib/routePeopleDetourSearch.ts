/** ~45 km/h when we have no stored route pace. */
const FALLBACK_PACE_MPS = 45000 / 3600;

export function routePaceMetersPerSecond(
  distanceM: number | null | undefined,
  durationS: number | null | undefined
): number | null {
  if (distanceM == null || durationS == null) return null;
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) return null;
  if (distanceM <= 0 || durationS <= 0) return null;
  return distanceM / durationS;
}

/**
 * Maps UI "detour minutes" into the legacy RPC search radius (meters from your home pin).
 * Uses your stored to-work route pace when available.
 */
export function detourMinutesToSearchRadiusM(
  detourMinutes: number,
  routeDistanceM: number | null | undefined,
  routeDurationS: number | null | undefined
): number {
  const pace = routePaceMetersPerSecond(routeDistanceM, routeDurationS) ?? FALLBACK_PACE_MPS;
  const m = Math.round(Math.max(0, detourMinutes) * 60 * pace);
  return Math.max(1000, Math.min(200_000, m));
}

/**
 * Upper bound for the slider: half of one-way route duration (minutes), at least 2.
 * Capped at 90 so extreme commutes do not create an unusably huge band.
 */
export function maxDetourMinutesFromRoute(durationS: number | null | undefined): number {
  if (durationS == null || !Number.isFinite(durationS) || durationS <= 0) return 30;
  const routeMin = durationS / 60;
  const half = Math.floor(routeMin * 0.5);
  return Math.min(90, Math.max(2, half));
}
