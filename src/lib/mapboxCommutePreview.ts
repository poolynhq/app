import {
  commuteDisplayDurationSeconds,
  commuteDistanceMetersFromRouteJson,
  type MapboxDirectionsRouteJson,
} from "@/lib/mapboxDirections";
import {
  dedupeConsecutiveCoords,
  normalizeRouteCoords,
  simplifyRouteCoords,
} from "@/lib/mapboxRouteGeometry";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

/** Crew routine card map tile (width x height). Wider-than-tall phones: ~1.85:1 avoids letterboxing in the card. */
export const CREW_ROUTINE_STATIC_MAP_SIZE = "900x480@2x";
/** Keep in sync with `mapImg` aspectRatio on MyCrewRoutineCard. */
export const CREW_ROUTINE_STATIC_MAP_ASPECT = 900 / 480;
/** Tighter than 88px so the route fills more of the frame (less empty margin). */
const CREW_STATIC_PADDING = 36;

export interface SingleRoute {
  distanceKm: number;
  durationMin: number;
  coords: [number, number][];
}

export interface RouteInfo {
  primary: SingleRoute;
  alternates: SingleRoute[];
}

export function mapboxTokenPresent(): boolean {
  return Boolean(MAPBOX_TOKEN);
}

/** West, south, east, north for Static Images API `[west,south,east,north]` (fixes `auto` zoom on wide tiles). */
export function commuteRouteBoundingBox(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  routeInfo: RouteInfo | null,
  padRatio = 0.14
): [number, number, number, number] {
  const lngs: number[] = [start.lng, end.lng];
  const lats: number[] = [start.lat, end.lat];
  if (routeInfo) {
    for (const r of [routeInfo.primary, ...routeInfo.alternates]) {
      for (const c of r.coords) {
        lngs.push(c[0]);
        lats.push(c[1]);
      }
    }
  }
  let west = Math.min(...lngs);
  let east = Math.max(...lngs);
  let south = Math.min(...lats);
  let north = Math.max(...lats);
  const dLng = Math.max(east - west, 0.004);
  const dLat = Math.max(north - south, 0.004);
  const px = dLng * padRatio;
  const py = dLat * padRatio;
  return [west - px, south - py, east + px, north + py];
}

async function fetchRouteInfoRaw(
  profile: "mapbox/driving-traffic" | "mapbox/driving",
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<MapboxDirectionsRouteJson[] | null> {
  const path = `${start.lng},${start.lat};${end.lng},${end.lat}`;
  const qs = `access_token=${encodeURIComponent(MAPBOX_TOKEN)}&alternatives=true&geometries=geojson&overview=full`;
  const res = await fetch(`https://api.mapbox.com/directions/v5/${profile}/${path}?${qs}`);
  const data = (await res.json()) as {
    routes?: MapboxDirectionsRouteJson[];
  };
  if (!data.routes?.length) return null;
  return data.routes;
}

/**
 * Driving routes with alternatives (Mapbox Directions API).
 * Primary = Mapbox `routes[0]`; alternates = API order (up to 2 more).
 * Times use `duration_typical` on `driving-traffic` when present (fairer vs other map apps); distances prefer leg sums.
 * Matches `fetchDrivingCommuteAlternatives` / `persistCommuteRouteVariantIndex` (traffic, then driving fallback).
 */
export async function fetchRouteInfo(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<RouteInfo | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    let profile: "mapbox/driving-traffic" | "mapbox/driving" = "mapbox/driving-traffic";
    let routes = await fetchRouteInfoRaw(profile, start, end);
    if (!routes?.length) {
      profile = "mapbox/driving";
      routes = await fetchRouteInfoRaw(profile, start, end);
    }
    if (!routes?.length) return null;
    const ordered = routes
      .filter((r) => r.geometry?.coordinates && r.geometry.coordinates.length >= 2)
      .slice(0, 3);
    if (!ordered.length) return null;
    const mapped = ordered.map((r) => {
      const line = r.geometry!.coordinates as [number, number][];
      return {
        distanceKm: commuteDistanceMetersFromRouteJson(r) / 1000,
        durationMin: commuteDisplayDurationSeconds(r, profile) / 60,
        coords: simplifyRouteCoords(line, 52),
      };
    });
    const [primary, ...rest] = mapped;
    return { primary, alternates: rest.slice(0, 2) };
  } catch {
    return null;
  }
}

/**
 * Static map with route overlays + pins (start = green, end = red).
 * @param highlightRouteIndex When set (0 = primary, 1+ = alternates in Mapbox order), that line is drawn on top in green; others are muted blue. Omit for fixed green/blue/amber by route order (onboarding/profile previews).
 */
export function buildStaticCommuteMapUrl(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  routeInfo: RouteInfo | null,
  size = "600x260@2x",
  highlightRouteIndex?: number
): string {
  const overlays: string[] = [];

  if (routeInfo) {
    const allRoutes = [routeInfo.primary, ...routeInfo.alternates];

    if (highlightRouteIndex !== undefined) {
      const n = allRoutes.length;
      let hi = Math.min(Math.max(0, highlightRouteIndex), Math.max(0, n - 1));
      if (!allRoutes[hi]?.coords?.length) {
        const firstOk = allRoutes.findIndex((r) => r.coords && r.coords.length >= 2);
        hi = firstOk >= 0 ? firstOk : 0;
      }
      const drawOrder: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!allRoutes[i]?.coords?.length) continue;
        if (i !== hi) drawOrder.push(i);
      }
      if (allRoutes[hi]?.coords?.length) drawOrder.push(hi);

      for (const idx of drawOrder) {
        const r = allRoutes[idx];
        if (!r?.coords?.length) continue;
        const isHi = idx === hi;
        const feature = {
          type: "Feature",
          properties: {
            stroke: isHi ? "#0B8457" : "#3B82F6",
            "stroke-width": isHi ? 6 : 3,
            "stroke-opacity": isHi ? 0.92 : 0.48,
          },
          geometry: { type: "LineString", coordinates: r.coords },
        };
        overlays.push(`geojson(${encodeURIComponent(JSON.stringify(feature))})`);
      }
    } else {
      const colours = ["#0B8457", "#3B82F6", "#F59E0B"];
      const opacities = [0.9, 0.6, 0.55];
      const widths = [5, 3, 3];
      [...allRoutes].reverse().forEach((r, revIdx) => {
        const idx = allRoutes.length - 1 - revIdx;
        if (!r?.coords?.length) return;
        const feature = {
          type: "Feature",
          properties: {
            stroke: colours[idx] ?? "#0B8457",
            "stroke-width": widths[idx] ?? 3,
            "stroke-opacity": opacities[idx] ?? 0.6,
          },
          geometry: { type: "LineString", coordinates: r.coords },
        };
        overlays.push(`geojson(${encodeURIComponent(JSON.stringify(feature))})`);
      });
    }
  }

  overlays.push(`pin-l+0B8457(${start.lng},${start.lat})`);
  overlays.push(`pin-l+E74C3C(${end.lng},${end.lat})`);

  const [w, s, e, n] = commuteRouteBoundingBox(start, end, routeInfo);
  const bbox = `[${w},${s},${e},${n}]`;
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/${bbox}/${size}?padding=32&access_token=${MAPBOX_TOKEN}`;
}

const CREW_PIN_COLORS = ["0B8457", "E74C3C", "2563EB", "D97706", "7C3AED", "DB2777"];

/**
 * Mapbox Static Images requires HTTPS marker URLs it can fetch. placehold.co returns a small PNG
 * with a stop number so riders match the list below the map.
 */
function crewPoolNumberedStopMarkerUrl(stopIndex1Based: number, bgHexNoHash: string): string {
  const n = Math.min(Math.max(1, stopIndex1Based), 99);
  return `https://placehold.co/44x44/${bgHexNoHash}/FFFFFF/png?text=${encodeURIComponent(String(n))}`;
}

/** Static map with one pin per commute home (general area only). */
export function buildCrewMemberPinsMapUrl(
  points: { lat: number; lng: number }[],
  size = CREW_ROUTINE_STATIC_MAP_SIZE
): string | null {
  if (!MAPBOX_TOKEN || points.length === 0) return null;
  const overlays = points.map((p, i) => {
    const hex = CREW_PIN_COLORS[i % CREW_PIN_COLORS.length];
    return `pin-s+${hex}(${p.lng},${p.lat})`;
  });
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size}?padding=${CREW_STATIC_PADDING}&access_token=${MAPBOX_TOKEN}`;
}

/**
 * Your home→work route (with driving line when routeInfo present) plus smaller pins for other members’ homes.
 */
export function buildCrewRoutineOverviewMapUrl(
  viewerHome: { lat: number; lng: number },
  viewerWork: { lat: number; lng: number },
  routeInfo: RouteInfo | null,
  otherMemberHomes: { lat: number; lng: number }[],
  size = CREW_ROUTINE_STATIC_MAP_SIZE
): string | null {
  if (!MAPBOX_TOKEN) return null;
  const overlays: string[] = [];

  if (routeInfo) {
    const colours = ["#0B8457", "#3B82F6", "#F59E0B"];
    const opacities = [0.9, 0.6, 0.55];
    const widths = [5, 3, 3];
    const allRoutes = [routeInfo.primary, ...routeInfo.alternates];
    [...allRoutes].reverse().forEach((r, revIdx) => {
      const idx = allRoutes.length - 1 - revIdx;
      const feature = {
        type: "Feature",
        properties: {
          stroke: colours[idx] ?? "#0B8457",
          "stroke-width": widths[idx] ?? 3,
          "stroke-opacity": opacities[idx] ?? 0.6,
        },
        geometry: { type: "LineString", coordinates: r.coords },
      };
      overlays.push(`geojson(${encodeURIComponent(JSON.stringify(feature))})`);
    });
  }

  for (let i = 0; i < otherMemberHomes.length; i++) {
    const p = otherMemberHomes[i];
    const hex = CREW_PIN_COLORS[(i + 2) % CREW_PIN_COLORS.length];
    overlays.push(`pin-s+${hex}(${p.lng},${p.lat})`);
  }

  overlays.push(`pin-l+0B8457(${viewerHome.lng},${viewerHome.lat})`);
  overlays.push(`pin-l+E74C3C(${viewerWork.lng},${viewerWork.lat})`);

  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size}?padding=${CREW_STATIC_PADDING}&access_token=${MAPBOX_TOKEN}`;
}

/**
 * Single stored commute line (your chosen route) plus home/work pins and optional crewmate homes.
 */
export function buildViewerCommuteStaticMapUrl(
  viewerHome: { lat: number; lng: number },
  viewerWork: { lat: number; lng: number },
  routeLine: [number, number][] | null | undefined,
  otherMemberHomes: { lat: number; lng: number }[],
  size = CREW_ROUTINE_STATIC_MAP_SIZE
): string | null {
  if (!MAPBOX_TOKEN) return null;
  const overlays: string[] = [];
  if (routeLine && routeLine.length >= 2) {
    const simplified = simplifyRouteCoords(routeLine, 48);
    const feature = {
      type: "Feature",
      properties: {
        stroke: "#0B8457",
        "stroke-width": 6,
        "stroke-opacity": 0.92,
      },
      geometry: { type: "LineString", coordinates: simplified },
    };
    overlays.push(`geojson(${encodeURIComponent(JSON.stringify(feature))})`);
  }
  for (let i = 0; i < otherMemberHomes.length; i++) {
    const p = otherMemberHomes[i];
    const hex = CREW_PIN_COLORS[(i + 2) % CREW_PIN_COLORS.length];
    overlays.push(`pin-s+${hex}(${p.lng},${p.lat})`);
  }
  overlays.push(`pin-l+0B8457(${viewerHome.lng},${viewerHome.lat})`);
  overlays.push(`pin-l+E74C3C(${viewerWork.lng},${viewerWork.lat})`);
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size}?padding=${CREW_STATIC_PADDING}&access_token=${MAPBOX_TOKEN}`;
}

/**
 * Driving route through ordered waypoints (driver home → pickups → destination).
 * Uses Mapbox Directions with up to 25 coordinates.
 */
export async function fetchDrivingRouteThroughWaypoints(
  waypoints: { lat: number; lng: number }[]
): Promise<[number, number][] | null> {
  if (!MAPBOX_TOKEN || waypoints.length < 2) return null;
  const path = waypoints.map((p) => `${p.lng},${p.lat}`).join(";");
  const qs = `access_token=${encodeURIComponent(MAPBOX_TOKEN)}&geometries=geojson&overview=full`;
  for (const profile of ["mapbox/driving-traffic", "mapbox/driving"] as const) {
    try {
      const res = await fetch(`https://api.mapbox.com/directions/v5/${profile}/${path}?${qs}`);
      const data = (await res.json()) as {
        routes?: MapboxDirectionsRouteJson[];
      };
      const route = data.routes?.[0];
      const raw = route?.geometry?.coordinates;
      if (!route || !raw?.length) continue;
      const normalized = dedupeConsecutiveCoords(normalizeRouteCoords(raw));
      const coords = simplifyRouteCoords(normalized, 100);
      if (coords.length >= 2) return coords;
    } catch {
      /* try next profile */
    }
  }
  return null;
}

/**
 * Pool preview map: green line; numbered stop markers; large yellow START (driver) and red END on top.
 */
export function buildCrewPoolRouteStaticMapUrl(
  routeLine: [number, number][],
  pins: {
    driver: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    others: { lat: number; lng: number }[];
  },
  size = CREW_ROUTINE_STATIC_MAP_SIZE
): string | null {
  if (!MAPBOX_TOKEN || routeLine.length < 2) return null;
  const simplified = simplifyRouteCoords(routeLine, 72);
  const feature = {
    type: "Feature",
    properties: {
      stroke: "#0B8457",
      "stroke-width": 6,
      "stroke-opacity": 0.92,
    },
    geometry: { type: "LineString", coordinates: simplified },
  };
  const overlays: string[] = [`geojson(${encodeURIComponent(JSON.stringify(feature))})`];
  for (let i = 0; i < pins.others.length; i++) {
    const p = pins.others[i];
    const hex = CREW_PIN_COLORS[(i + 2) % CREW_PIN_COLORS.length];
    const markerUrl = crewPoolNumberedStopMarkerUrl(i + 1, hex);
    overlays.push(`url-${encodeURIComponent(markerUrl)}(${p.lng},${p.lat})`);
  }
  overlays.push(`pin-l+FACC15(${pins.driver.lng},${pins.driver.lat})`);
  overlays.push(`pin-l+E74C3C(${pins.destination.lng},${pins.destination.lat})`);
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size}?padding=${CREW_STATIC_PADDING}&access_token=${MAPBOX_TOKEN}`;
}

/** Short place line for displaying a saved pin (approximate street area). */
export async function reverseGeocodeShort(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`
    );
    const data = (await res.json()) as { features?: { place_name?: string }[] };
    const name = data.features?.[0]?.place_name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}
