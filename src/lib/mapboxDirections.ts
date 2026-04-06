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

function buildUrl(profile: string, coords: LngLat[], steps: boolean): string {
  const path = coords.map((c) => `${c[0]},${c[1]}`).join(";");
  const stepParam = steps ? "&steps=true" : "";
  return `https://api.mapbox.com/directions/v5/${profile}/${path}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full${stepParam}`;
}

type MapboxManeuver = { instruction?: string };

type MapboxLegStep = {
  maneuver?: MapboxManeuver;
  distance?: number;
  duration?: number;
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
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic"
): Promise<DrivingRouteResult> {
  if (!MAPBOX_TOKEN?.trim()) {
    return { ok: false, error: "missing_mapbox_token" };
  }
  if (coords.length < 2) {
    return { ok: false, error: "insufficient_coordinates" };
  }
  try {
    const res = await fetch(buildUrl(profile, coords, false));
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
    const r = data.routes?.[0];
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
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic"
): Promise<DrivingRouteWithStepsResult> {
  if (!MAPBOX_TOKEN?.trim()) {
    return { ok: false, error: "missing_mapbox_token" };
  }
  if (coords.length < 2) {
    return { ok: false, error: "insufficient_coordinates" };
  }
  try {
    const res = await fetch(buildUrl(profile, coords, true));
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
    const r = data.routes?.[0];
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
  profile: MapboxDirectionsProfile = "mapbox/driving-traffic"
): Promise<DirectionsRoute | null> {
  const r = await fetchDrivingRoute(coords, profile);
  return r.ok ? r.route : null;
}

/** Driver baseline: home → work. */
export async function getBaselineCommute(
  home: LngLat,
  work: LngLat
): Promise<DirectionsRoute | null> {
  return getDrivingRoute([home, work]);
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
