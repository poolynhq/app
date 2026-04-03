/** Downsample a [lng, lat][] path for storage (keeps first + last). */
export function simplifyRouteCoords(
  raw: [number, number][],
  max: number
): [number, number][] {
  if (raw.length <= max) return raw;
  const step = (raw.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => raw[Math.round(i * step)]);
}

/** Mapbox may return [lng, lat] or [lng, lat, elevation]. */
export function normalizeRouteCoords(
  raw: ReadonlyArray<ReadonlyArray<number>>
): [number, number][] {
  const out: [number, number][] = [];
  for (const pt of raw) {
    if (!pt?.length) continue;
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    out.push([lng, lat]);
  }
  return out;
}

/** Remove consecutive duplicate vertices (helps PostGIS + shrinks degenerate simplification). */
export function dedupeConsecutiveCoords(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const c of coords) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
  }
  return out;
}

/**
 * EWKT for geography(LineString,4326). PostgREST accepts this string for geography columns;
 * raw GeoJSON objects often yield "parse error - invalid geometry".
 */
export function lineStringToGeographyEwkt(coords: [number, number][]): string {
  const pairs = coords.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
  return `SRID=4326;LINESTRING(${pairs})`;
}
