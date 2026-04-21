/**
 * Haversine distance and point-to-segment distance on the sphere (small segments).
 * Shared by crew route ordering and cost attribution (no crew-specific imports).
 */

export function distanceMeters(
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

/** 0–1 position of P projected onto segment A→B (clamped). */
export function projectionT(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  p: { lat: number; lng: number }
): number {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-18) return 0;
  const t = (apx * abx + apy * aby) / ab2;
  return Math.max(0, Math.min(1, t));
}

/** Shortest distance from P to segment A→B (geodesic via plane approximation on small segments). */
export function distancePointToSegmentMeters(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const t = projectionT(a, b, p);
  const ix = a.lng + t * (b.lng - a.lng);
  const iy = a.lat + t * (b.lat - a.lat);
  return distanceMeters(p, { lat: iy, lng: ix });
}
