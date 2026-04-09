/**
 * Mapbox Directions API — single routing engine for baseline + detour (see docs/POOLYN_MATCHING_SPEC.md).
 */

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

export type LngLat = [number, number];

export type MapboxDirectionsProfile = "mapbox/driving-traffic" | "mapbox/driving";

export interface DirectionsRoute {
  distanceM: number;
  durationS: number;
  coordinates: LngLat[];
}

export type DrivingRouteResult =
  | { ok: true; route: DirectionsRoute }
  | { ok: false; error: string };

export type DrivingRouteStep = {
  instruction: string;
  distanceM: number;
  durationS: number;
};

export type DrivingRouteWithStepsResult =
  | { ok: true; route: DirectionsRoute; steps: DrivingRouteStep[] }
  | { ok: false; error: string };

function buildUrl(
  profile: string,
  coords: LngLat[],
  steps: boolean,
  alternatives: boolean
): string {
  const path = coords.map((c) => `${c[0]},${c[1]}`).join(";");
  const parts = [
    `access_token=${encodeURIComponent(MAPBOX_TOKEN)}`,
    "geometries=geojson",
    "overview=full",
  ];
  if (steps) parts.push("steps=true");
  if (alternatives) parts.push("alternatives=true");
  return `https://api.mapbox.com/directions/v5/${profile}/${path}?${parts.join("&")}`;
}

type MapboxManeuver = { instruction?: string };

type MapboxLegStep = {
  maneuver?: MapboxManeuver;
  distance?: number;
  duration?: number;
};

/** Mapbox’s first route is duration/traffic-weighted; for commute preview we prefer shortest distance among alternatives. */
function pickShortestRoute<
  T extends { distance: number; duration: number; geometry: { coordinates: LngLat[] } },
>(routes: T[] | undefined): T | undefined {
  if (!routes?.length) return undefined;
  let best = routes[0];
  let bestD = best.distance;
  for (let i = 1; i < routes.length; i++) {
    const r = routes[i];
    if (r.distance < bestD) {
      bestD = r.distance;
      best = r;
    }
  }
  return best;
}

export type FetchDrivingRouteOptions = {
  /** When true, requests alternatives and uses the route with minimum distance (m). */
  preferShortestDistance?: boolean;
};

function parseLegSteps(legs: { steps?: MapboxLegStep[] }[] | undefined): DrivingRouteStep[] {
  const out: DrivingRouteStep[] = [];
  for (const leg of legs ?? []) {
    for (const s of leg.steps ?? []) {
      const instruction = (s.maneuver?.instruction ?? "").trim() || "Continue";
      out.push({
        instruction,
        distanceM: s.distance ?? 0,
        durationS: s.duration ?? 0,
      });
    }
  }
  return out;
}

/**
 * Mapbox Directions with explicit success/failure. No silent fallback.
 * Waypoints are visited in order (no optimization query params).
 */
export async function fetchDrivingRoute(
  coords: LngLat[],
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic",
  options?: FetchDrivingRouteOptions
): Promise<DrivingRouteResult> {
  if (!MAPBOX_TOKEN?.trim()) {
    return { ok: false, error: "missing_mapbox_token" };
  }
  if (coords.length < 2) {
    return { ok: false, error: "insufficient_coordinates" };
  }
  const useAlts = Boolean(options?.preferShortestDistance);
  try {
    const res = await fetch(buildUrl(profile, coords, false, useAlts));
    const data = (await res.json()) as {
      message?: string;
      code?: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: LngLat[] } }[];
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.message ?? data.code ?? `mapbox_http_${res.status}`,
      };
    }
    const r = useAlts ? pickShortestRoute(data.routes) : data.routes?.[0];
    if (!r?.geometry?.coordinates?.length) {
      return { ok: false, error: "no_route_geometry" };
    }
    return {
      ok: true,
      route: {
        distanceM: r.distance,
        durationS: r.duration,
        coordinates: r.geometry.coordinates,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network_error";
    return { ok: false, error: msg };
  }
}

/**
 * Same as fetchDrivingRoute plus turn-by-turn step list (Mapbox `steps=true`).
 */
export async function fetchDrivingRouteWithSteps(
  coords: LngLat[],
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic",
  options?: FetchDrivingRouteOptions
): Promise<DrivingRouteWithStepsResult> {
  if (!MAPBOX_TOKEN?.trim()) {
    return { ok: false, error: "missing_mapbox_token" };
  }
  if (coords.length < 2) {
    return { ok: false, error: "insufficient_coordinates" };
  }
  const useAlts = Boolean(options?.preferShortestDistance);
  try {
    const res = await fetch(buildUrl(profile, coords, true, useAlts));
    const data = (await res.json()) as {
      message?: string;
      code?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: LngLat[] };
        legs?: { steps?: MapboxLegStep[] }[];
      }[];
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.message ?? data.code ?? `mapbox_http_${res.status}`,
      };
    }
    const r = useAlts ? pickShortestRoute(data.routes) : data.routes?.[0];
    if (!r?.geometry?.coordinates?.length) {
      return { ok: false, error: "no_route_geometry" };
    }
    const steps = parseLegSteps(r.legs);
    return {
      ok: true,
      route: {
        distanceM: r.distance,
        durationS: r.duration,
        coordinates: r.geometry.coordinates,
      },
      steps,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network_error";
    return { ok: false, error: msg };
  }
}

/** Null when the route cannot be computed (token, network, or Mapbox error). Prefer fetchDrivingRoute to surface errors. */
export async function getDrivingRoute(
  coords: LngLat[],
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic",
  options?: FetchDrivingRouteOptions
): Promise<DirectionsRoute | null> {
  const r = await fetchDrivingRoute(coords, profile, options);
  return r.ok ? r.route : null;
}

/** Driver baseline: home → work (shortest-distance option when Mapbox returns alternatives). */
export async function getBaselineCommute(
  home: LngLat,
  work: LngLat
): Promise<DirectionsRoute | null> {
  return getDrivingRoute([home, work], "mapbox/driving-traffic", {
    preferShortestDistance: true,
  });
}

/**
 * Route with passenger stops (order: home, pickup, dropoff, work) — pickup/dropoff snapped on corridor in caller.
 */
export async function getRouteWithPassengerStops(
  driverHome: LngLat,
  pickup: LngLat,
  dropoff: LngLat,
  driverWork: LngLat
): Promise<DirectionsRoute | null> {
  return getDrivingRoute([driverHome, pickup, dropoff, driverWork]);
}
