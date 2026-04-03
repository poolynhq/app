/**
 * Persist Mapbox commute geometry for geometry-first matching.
 */

import { supabase } from "@/lib/supabase";
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

export async function upsertCommuteRouteToWork(
  userId: string,
  home: { lat: number; lng: number },
  work: { lat: number; lng: number }
): Promise<{ ok: boolean; error?: string }> {
  if (!MAPBOX_TOKEN) return { ok: false, error: "Missing Mapbox token" };
  try {
    const path = `${home.lng},${home.lat};${work.lng},${work.lat}`;
    const qs = `access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full`;
    let res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${path}?${qs}`
    );
    // Tokens without traffic scope / some regions return no route — fall back to plain driving (matches onboarding preview).
    let data = (await res.json()) as {
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: number[][] };
      }[];
      message?: string;
    };
    let r = data.routes?.[0];
    if (!r?.geometry?.coordinates?.length) {
      res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${path}?${qs}`);
      data = (await res.json()) as typeof data;
      r = data.routes?.[0];
    }
    if (!r?.geometry?.coordinates?.length) {
      return {
        ok: false,
        error: data.message ?? "No driving route between these points",
      };
    }

    let coords = normalizeRouteCoords(r.geometry.coordinates);
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
        distance_m: r.distance,
        duration_s: r.duration,
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
