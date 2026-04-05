import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from "geojson";
import type { DiscoverRouteCorridor } from "@/lib/discoverMapViewerRoutes";

/** Same band as matching “corridor” feel — used for map filtering and pickup counts */
export const DISCOVER_CORRIDOR_BUFFER_KM = 0.38;

export type CorridorDemandCount = {
  label: string;
  count: number;
};

/**
 * Count demand (passenger pickup) points within a buffer of each route polyline.
 * For drivers comparing primary vs alternate corridors.
 */
function corridorBufferPolygons(
  corridors: DiscoverRouteCorridor[]
): Feature<Polygon | MultiPolygon>[] {
  const out: Feature<Polygon | MultiPolygon>[] = [];
  for (const { coordinates } of corridors) {
    if (coordinates.length < 2) continue;
    const line = turf.lineString(coordinates);
    const buffered = turf.buffer(line, DISCOVER_CORRIDOR_BUFFER_KM, {
      units: "kilometers",
      steps: 12,
    });
    if (!buffered?.geometry) continue;
    const t = buffered.geometry.type;
    if (t === "Polygon" || t === "MultiPolygon") {
      out.push(buffered as Feature<Polygon | MultiPolygon>);
    }
  }
  return out;
}

function pointInAnyBuffer(
  pt: Feature<Point>,
  buffers: Feature<Polygon | MultiPolygon>[]
): boolean {
  return buffers.some((b) => turf.booleanPointInPolygon(pt, b));
}

/**
 * Keep demand/supply point features that fall within a buffer of the viewer’s commute
 * (primary + alternates). When there are no corridors yet, returns the collection unchanged.
 */
export function filterPointsToViewerCorridors(
  fc: FeatureCollection,
  corridors: DiscoverRouteCorridor[]
): FeatureCollection {
  if (!corridors.length) return fc;
  const buffers = corridorBufferPolygons(corridors);
  if (!buffers.length) return fc;

  const features = fc.features.filter((f) => {
    if (f.geometry?.type !== "Point") return false;
    const c = f.geometry.coordinates as [number, number];
    if (!Array.isArray(c) || c.length < 2) return false;
    return pointInAnyBuffer(turf.point(c), buffers);
  });

  return { type: "FeatureCollection", features };
}

/**
 * Keep other users’ route line features that intersect the viewer’s commute buffer.
 */
export function filterRouteLinesToViewerCorridors(
  fc: FeatureCollection,
  corridors: DiscoverRouteCorridor[]
): FeatureCollection {
  if (!corridors.length) return fc;
  const buffers = corridorBufferPolygons(corridors);
  if (!buffers.length) return fc;

  const features = fc.features.filter((f) => {
    const g = f.geometry;
    if (!g) return false;
    if (g.type === "LineString") {
      const coords = g.coordinates as [number, number][];
      if (coords.length < 2) return false;
      const line = turf.lineString(coords);
      return buffers.some((poly) => turf.booleanIntersects(line, poly));
    }
    if (g.type === "MultiLineString") {
      for (const part of g.coordinates as [number, number][][]) {
        if (!part || part.length < 2) continue;
        const line = turf.lineString(part);
        if (buffers.some((poly) => turf.booleanIntersects(line, poly))) return true;
      }
      return false;
    }
    return false;
  });

  return { type: "FeatureCollection", features };
}

function lineDistanceKm(pt: Feature<Point>, coordinates: [number, number][]): number {
  if (coordinates.length < 2) return Number.POSITIVE_INFINITY;
  const line = turf.lineString(coordinates);
  return turf.pointToLineDistance(pt, line, { units: "kilometers" });
}

/**
 * Each pickup point is counted in exactly one corridor band (the nearest polyline among bands
 * that contain the point). Sums match the number of orange demand points on the map; avoids
 * double-counting when primary and alternate buffers overlap.
 */
export function countPickupDemandByCorridorDisjoint(
  mapDemandPoints: FeatureCollection,
  corridors: DiscoverRouteCorridor[]
): { byCorridor: CorridorDemandCount[]; uniqueOnMap: number } {
  const points = mapDemandPoints.features
    .map((f) => {
      if (f.geometry?.type !== "Point") return null;
      const c = f.geometry.coordinates as [number, number];
      if (!Array.isArray(c) || c.length < 2) return null;
      return turf.point(c);
    })
    .filter((p): p is Feature<Point> => p != null);

  const uniqueOnMap = points.length;

  if (!corridors.length) {
    return { byCorridor: [], uniqueOnMap };
  }

  const buffers = corridorBufferPolygons(corridors);
  if (!buffers.length) {
    return {
      byCorridor: corridors.map((c) => ({ label: c.label, count: 0 })),
      uniqueOnMap,
    };
  }

  const counts = new Array(corridors.length).fill(0);

  for (const pt of points) {
    const inIdx: number[] = [];
    for (let i = 0; i < buffers.length; i++) {
      if (turf.booleanPointInPolygon(pt, buffers[i])) inIdx.push(i);
    }
    if (inIdx.length === 0) continue;
    let chosen = inIdx[0]!;
    if (inIdx.length > 1) {
      let bestD = lineDistanceKm(pt, corridors[chosen].coordinates);
      for (let k = 1; k < inIdx.length; k++) {
        const j = inIdx[k]!;
        const d = lineDistanceKm(pt, corridors[j].coordinates);
        if (d < bestD) {
          bestD = d;
          chosen = j;
        }
      }
    }
    counts[chosen] += 1;
  }

  return {
    byCorridor: corridors.map((c, i) => ({ label: c.label, count: counts[i] })),
    uniqueOnMap,
  };
}

export function formatDisjointCorridorPickupSummary(
  r: ReturnType<typeof countPickupDemandByCorridorDisjoint>
): string {
  if (!r.byCorridor.length) return "";
  const parts = r.byCorridor.map((p) => `${p.label}: ${p.count}`).join(" · ");
  const n = r.uniqueOnMap;
  const noun = n === 1 ? "rider" : "riders";
  return `${n} ${noun} on the map — ${parts}`;
}

/** @deprecated Prefer countPickupDemandByCorridorDisjoint for UI; this double-counts overlaps */
export function countDemandByRouteCorridor(
  demandPoints: FeatureCollection,
  corridors: DiscoverRouteCorridor[]
): CorridorDemandCount[] {
  if (!corridors.length) return [];

  const points = demandPoints.features
    .map((f) => {
      if (f.geometry?.type !== "Point") return null;
      const c = f.geometry.coordinates as [number, number];
      if (!Array.isArray(c) || c.length < 2) return null;
      return turf.point(c);
    })
    .filter((p): p is Feature<Point> => p != null);

  return corridors.map(({ label, coordinates }) => {
    if (coordinates.length < 2) return { label, count: 0 };
    const line = turf.lineString(coordinates);
    const corridor = turf.buffer(line, DISCOVER_CORRIDOR_BUFFER_KM, {
      units: "kilometers",
      steps: 12,
    });
    if (!corridor) return { label, count: 0 };
    let count = 0;
    for (const pt of points) {
      if (turf.booleanPointInPolygon(pt, corridor)) count += 1;
    }
    return { label, count };
  });
}
