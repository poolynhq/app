/**
 * Persist Mapbox commute geometry for geometry-first matching.
 */

import { supabase } from "@/lib/supabase";
import { fetchDrivingCommuteAlternatives, fetchDrivingRoute } from "@/lib/mapboxDirections";
import {
  simplifyRouteCoords,
  normalizeRouteCoords,
  dedupeConsecutiveCoords,
  lineStringToGeographyEwkt,
} from "@/lib/mapboxRouteGeometry";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

/** Full overview geometries are huge and can break PostgREST / DB inserts (~500+ KB JSON). */
const MAX_STORED_ROUTE_POINTS = 160;

function bboxFromCoords(coords: [number, number][]) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { bbox_min_lng: minLng, bbox_min_lat: minLat, bbox_max_lng: maxLng, bbox_max_lat: maxLat };
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * When Mapbox is unavailable or returns no route, store a two-point corridor so matching
 * and onboarding can complete; user locations are already on `users`.
 */
export async function upsertStraightLineCommuteRoute(
  userId: string,
  home: { lat: number; lng: number },
  work: { lat: number; lng: number }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const coords: [number, number][] = [
      [home.lng, home.lat],
      [work.lng, work.lat],
    ];
    const bb = bboxFromCoords(coords);
    const routeEwkt = lineStringToGeographyEwkt(coords);
    const distM = haversineMeters(home, work);
    const durationS = Math.max(120, Math.round(distM / 13.9));

    const { error } = await supabase.from("commute_routes").upsert(
      {
        user_id: userId,
        direction: "to_work",
        route_geom: routeEwkt,
        distance_m: distM,
        duration_s: durationS,
        ...bb,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,direction" }
    );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Straight-line route failed" };
  }
}

/**
 * Persists the chosen Mapbox alternative (0 = primary route, 1–2 = alternates in API order) to `commute_routes` to_work.
 */
export async function persistCommuteRouteVariantIndex(
  userId: string,
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  variantIndex: number
): Promise<{ ok: boolean; error?: string }> {
  if (!MAPBOX_TOKEN) return { ok: false, error: "Missing Mapbox token" };
  const leg: [[number, number], [number, number]] = [
    [home.lng, home.lat],
    [work.lng, work.lat],
  ];
  let alt = await fetchDrivingCommuteAlternatives(leg, "mapbox/driving-traffic");
  if (!alt.ok) {
    alt = await fetchDrivingCommuteAlternatives(leg, "mapbox/driving");
  }
  if (!alt.ok) {
    return { ok: false, error: alt.error };
  }
  const idx = Math.min(Math.max(0, variantIndex), alt.routes.length - 1);
  const r = alt.routes[idx];
  let coords = normalizeRouteCoords(r.coordinates);
  coords = dedupeConsecutiveCoords(simplifyRouteCoords(coords, MAX_STORED_ROUTE_POINTS));
  coords = dedupeConsecutiveCoords(coords);
  if (coords.length < 2) {
    coords = [
      [home.lng, home.lat],
      [work.lng, work.lat],
    ];
  }
  const bb = bboxFromCoords(coords);
  const routeEwkt = lineStringToGeographyEwkt(coords);
  const { error } = await supabase.from("commute_routes").upsert(
    {
      user_id: userId,
      direction: "to_work",
      route_geom: routeEwkt,
      distance_m: r.distanceM,
      duration_s: r.durationS,
      ...bb,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,direction" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertCommuteRouteToWork(
  userId: string,
  home: { lat: number; lng: number },
  work: { lat: number; lng: number }
): Promise<{ ok: boolean; error?: string }> {
  if (!MAPBOX_TOKEN) return { ok: false, error: "Missing Mapbox token" };
  try {
    const leg: [[number, number], [number, number]] = [
      [home.lng, home.lat],
      [work.lng, work.lat],
    ];
    let routeRes = await fetchDrivingRoute(leg, "mapbox/driving-traffic", {
      applyCommuteDisplayCalibration: true,
    });
    if (!routeRes.ok) {
      routeRes = await fetchDrivingRoute(leg, "mapbox/driving", {
        applyCommuteDisplayCalibration: true,
      });
    }
    if (!routeRes.ok) {
      return {
        ok: false,
        error: routeRes.error ?? "No driving route between these points",
      };
    }
    const r = routeRes.route;

    let coords = normalizeRouteCoords(r.coordinates);
    coords = dedupeConsecutiveCoords(simplifyRouteCoords(coords, MAX_STORED_ROUTE_POINTS));
    coords = dedupeConsecutiveCoords(coords);
    if (coords.length < 2) {
      coords = [
        [home.lng, home.lat],
        [work.lng, work.lat],
      ];
    }
    const bb = bboxFromCoords(coords);
    const routeEwkt = lineStringToGeographyEwkt(coords);

    const { error } = await supabase.from("commute_routes").upsert(
      {
        user_id: userId,
        direction: "to_work",
        route_geom: routeEwkt,
        distance_m: r.distanceM,
        duration_s: r.durationS,
        ...bb,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,direction" }
    );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Route failed" };
  }
}
