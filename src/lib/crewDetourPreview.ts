import {
  commuteDisplayDurationSeconds,
  commuteDistanceMetersFromRouteJson,
  type MapboxDirectionsRouteJson,
} from "@/lib/mapboxDirections";
import { mapboxTokenPresent } from "@/lib/mapboxCommutePreview";
import {
  dedupeConsecutiveCoords,
  normalizeRouteCoords,
  simplifyRouteCoords,
} from "@/lib/mapboxRouteGeometry";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

/** Direct commute vs home → pickup → work (driving; used only for crew formation preview). */
export type PeerDetourEstimate = {
  baselineDurationMin: number;
  baselineDistanceKm: number;
  viaDurationMin: number;
  viaDistanceKm: number;
  extraDurationMin: number;
  extraDistanceKm: number;
};

const DIRECT_COLOR = "#64748B";
const VIA_COLOR = "#EA580C";

async function fetchDrivingRoute(
  points: { lat: number; lng: number }[]
): Promise<{ coords: [number, number][]; durationSec: number; distanceM: number } | null> {
  if (!MAPBOX_TOKEN || points.length < 2) return null;
  const path = points.map((p) => `${p.lng},${p.lat}`).join(";");
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
      if (coords.length < 2) continue;
      return {
        coords,
        durationSec: Math.round(commuteDisplayDurationSeconds(route, profile)),
        distanceM: commuteDistanceMetersFromRouteJson(route),
      };
    } catch {
      /* try next profile */
    }
  }
  return null;
}

function straightLineCoords(
  points: { lat: number; lng: number }[]
): [number, number][] {
  return points.map((p) => [p.lng, p.lat] as [number, number]);
}

/**
 * Static map: direct route (slate) under, pickup route (orange) on top, three pins.
 * Large tile + low padding so framing stays tight on suburban detail.
 */
export function buildPeerDetourCompareMapUrl(
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  peer: { lat: number; lng: number },
  directCoords: [number, number][],
  viaCoords: [number, number][],
  size = "800x380@2x"
): string | null {
  if (!MAPBOX_TOKEN || directCoords.length < 2 || viaCoords.length < 2) return null;

  const viaLine = {
    type: "Feature",
    properties: {
      stroke: VIA_COLOR,
      "stroke-width": 5,
      "stroke-opacity": 0.92,
    },
    geometry: { type: "LineString", coordinates: viaCoords },
  };
  const directLine = {
    type: "Feature",
    properties: {
      stroke: DIRECT_COLOR,
      "stroke-width": 5,
      "stroke-opacity": 0.95,
    },
    geometry: { type: "LineString", coordinates: directCoords },
  };

  const overlays = [
    `geojson(${encodeURIComponent(JSON.stringify(viaLine))})`,
    `geojson(${encodeURIComponent(JSON.stringify(directLine))})`,
    `pin-s+0B8457(${home.lng},${home.lat})`,
    `pin-s+2563EB(${peer.lng},${peer.lat})`,
    `pin-s+E74C3C(${work.lng},${work.lat})`,
  ];

  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size}?padding=28&access_token=${MAPBOX_TOKEN}`;
}

export type PeerDetourPreviewResult = {
  estimate: PeerDetourEstimate;
  mapUrl: string | null;
};

/** One round-trip: two driving routes + compare map URL. */
export async function fetchPeerDetourPreview(
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  peer: { lat: number; lng: number }
): Promise<PeerDetourPreviewResult | null> {
  if (!mapboxTokenPresent()) return null;

  const [direct, via] = await Promise.all([
    fetchDrivingRoute([home, work]),
    fetchDrivingRoute([home, peer, work]),
  ]);

  if (!direct || !via) return null;

  const estimate: PeerDetourEstimate = {
    baselineDurationMin: direct.durationSec / 60,
    baselineDistanceKm: direct.distanceM / 1000,
    viaDurationMin: via.durationSec / 60,
    viaDistanceKm: via.distanceM / 1000,
    extraDurationMin: Math.max(0, via.durationSec / 60 - direct.durationSec / 60),
    extraDistanceKm: Math.max(0, via.distanceM / 1000 - direct.distanceM / 1000),
  };

  let mapUrl: string | null = buildPeerDetourCompareMapUrl(home, work, peer, direct.coords, via.coords);
  if (mapUrl && mapUrl.length > 7500) {
    const d2 = simplifyRouteCoords(direct.coords, 55);
    const v2 = simplifyRouteCoords(via.coords, 55);
    mapUrl = buildPeerDetourCompareMapUrl(home, work, peer, d2, v2);
  }
  if (mapUrl && mapUrl.length > 7500) {
    const d3 = simplifyRouteCoords(direct.coords, 35);
    const v3 = simplifyRouteCoords(via.coords, 35);
    mapUrl = buildPeerDetourCompareMapUrl(home, work, peer, d3, v3);
  }

  return { estimate, mapUrl };
}

/** @deprecated use fetchPeerDetourPreview */
export async function estimatePickupDetour(
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  peer: { lat: number; lng: number }
): Promise<PeerDetourEstimate | null> {
  const r = await fetchPeerDetourPreview(home, work, peer);
  return r?.estimate ?? null;
}

/** @deprecated use fetchPeerDetourPreview */
export function buildPeerDetourStaticMapUrl(
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  peer: { lat: number; lng: number },
  size = "560x200@2x"
): string | null {
  const d = straightLineCoords([home, work]);
  const v = straightLineCoords([home, peer, work]);
  return buildPeerDetourCompareMapUrl(home, work, peer, d, v, size);
}
