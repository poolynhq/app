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

/** Subset of Directions `route` JSON we read for commute UI + storage. */
export type MapboxDirectionsRouteJson = {
  distance: number;
  duration: number;
  duration_typical?: number;
  geometry?: { coordinates: LngLat[] };
  legs?: { distance?: number; steps?: MapboxLegStep[] }[];
};

/**
 * Prefer summed leg distances when Mapbox returns legs (matches turn-by-turn totals).
 */
export function commuteDistanceMetersFromRouteJson(r: MapboxDirectionsRouteJson): number {
  const legs = r.legs;
  if (legs?.length) {
    let sum = 0;
    for (const l of legs) sum += l.distance ?? 0;
    if (sum > 1) return sum;
  }
  return r.distance;
}

/**
 * For `driving-traffic`, Mapbox’s `duration` is live-traffic-weighted and can diverge sharply between
 * alternatives; `duration_typical` matches “usual” trip time (closer to other map apps). Commute chips use this.
 */
export function commuteDisplayDurationSeconds(
  r: MapboxDirectionsRouteJson,
  profile: MapboxDirectionsProfile
): number {
  if (profile === "mapbox/driving-traffic") {
    const t = r.duration_typical;
    if (typeof t === "number" && Number.isFinite(t) && t > 30) return t;
  }
  return r.duration;
}

/** Among alternatives, pick minimum path length (m). Mapbox’s `routes[0]` is usually better for real-world ETA. */
function pickShortestRoute(routes: MapboxDirectionsRouteJson[] | undefined): MapboxDirectionsRouteJson | undefined {
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
  /**
   * When true, requests alternatives and picks the minimum-distance path.
   * Default false: use `routes[0]` (Mapbox duration/traffic-weighted primary).
   */
  preferShortestDistance?: boolean;
  /**
   * Commute save path: use typical traffic duration + leg-based distance when the API provides them,
   * so stored numbers align with route chips (live `duration` per alternative can misstate relative ETAs).
   */
  applyCommuteDisplayCalibration?: boolean;
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
export type DrivingCommuteAlternativesResult =
  | { ok: true; routes: DirectionsRoute[] }
  | { ok: false; error: string };

/**
 * Up to three driving options in **Mapbox API order** (primary first = duration/traffic-weighted, then alternates).
 * Same ordering as `fetchRouteInfo` in `mapboxCommutePreview.ts` so variant indices stay aligned.
 * Tries traffic profile first, then non-traffic.
 */
export async function fetchDrivingCommuteAlternatives(
  coords: LngLat[],
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic"
): Promise<DrivingCommuteAlternativesResult> {
  if (!MAPBOX_TOKEN?.trim()) {
    return { ok: false, error: "missing_mapbox_token" };
  }
  if (coords.length < 2) {
    return { ok: false, error: "insufficient_coordinates" };
  }
  const tryProfile = async (p: MapboxDirectionsProfile): Promise<DirectionsRoute[] | null> => {
    try {
      const res = await fetch(buildUrl(p, coords, false, true));
      const data = (await res.json()) as {
        message?: string;
        code?: string;
        routes?: MapboxDirectionsRouteJson[];
      };
      if (!res.ok) return null;
      const raw = data.routes ?? [];
      const mapped: DirectionsRoute[] = [];
      for (const r of raw) {
        if (!r.geometry?.coordinates || r.geometry.coordinates.length < 2) continue;
        mapped.push({
          distanceM: commuteDistanceMetersFromRouteJson(r),
          durationS: Math.round(commuteDisplayDurationSeconds(r, p)),
          coordinates: r.geometry.coordinates,
        });
        if (mapped.length >= 3) break;
      }
      return mapped.length ? mapped : null;
    } catch {
      return null;
    }
  };
  let routes = await tryProfile(profile);
  if (!routes?.length && profile === "mapbox/driving-traffic") {
    routes = await tryProfile("mapbox/driving");
  }
  if (!routes?.length) {
    return { ok: false, error: "no_routes" };
  }
  return { ok: true, routes };
}

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
      routes?: MapboxDirectionsRouteJson[];
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
    const cal = Boolean(options?.applyCommuteDisplayCalibration);
    return {
      ok: true,
      route: {
        distanceM: cal ? commuteDistanceMetersFromRouteJson(r) : r.distance,
        durationS: cal
          ? Math.round(commuteDisplayDurationSeconds(r, profile))
          : r.duration,
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
      routes?: MapboxDirectionsRouteJson[];
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
    const cal = Boolean(options?.applyCommuteDisplayCalibration);
    return {
      ok: true,
      route: {
        distanceM: cal ? commuteDistanceMetersFromRouteJson(r) : r.distance,
        durationS: cal
          ? Math.round(commuteDisplayDurationSeconds(r, profile))
          : r.duration,
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

/** Driver baseline: home → work (Mapbox primary route with traffic when available). */
export async function getBaselineCommute(
  home: LngLat,
  work: LngLat
): Promise<DirectionsRoute | null> {
  return getDrivingRoute([home, work], "mapbox/driving-traffic");
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
