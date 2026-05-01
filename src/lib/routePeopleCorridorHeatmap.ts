export type RoutePeopleDemandPointRow = {
  user_id: string;
  full_name: string | null;
  org_name: string | null;
  pin_lng?: number | null;
  pin_lat?: number | null;
};

/**
 * One map point per directory row at the peer's saved commute pin (home, or work if that is what
 * matching used). Rows without valid coordinates are skipped. Feature properties carry identity for
 * map taps (circles mode).
 */
export function buildRoutePeopleDemandPointsGeoJson(rows: RoutePeopleDemandPointRow[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    const lng = row.pin_lng;
    const lat = row.pin_lat;
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        user_id: row.user_id,
        full_name: row.full_name ?? "",
        org_name: row.org_name ?? "",
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export function primaryCommuteLineCoords(
  viewerRoutes: GeoJSON.FeatureCollection
): [number, number][] | null {
  const f = viewerRoutes.features.find(
    (x) => String((x.properties as { route_key?: string } | null)?.route_key ?? "") === "primary"
  );
  if (!f || f.geometry.type !== "LineString") return null;
  const c = f.geometry.coordinates as [number, number][];
  return c.length >= 2 ? c : null;
}

export function homeWorkFallbackLine(pins: GeoJSON.FeatureCollection): [number, number][] | null {
  let home: [number, number] | null = null;
  let work: [number, number] | null = null;
  for (const feat of pins.features) {
    if (feat.geometry.type !== "Point") continue;
    const k = String((feat.properties as { kind?: string } | null)?.kind ?? "");
    const c = feat.geometry.coordinates as [number, number];
    if (k === "home") home = c;
    if (k === "work") work = c;
  }
  if (home && work) return [home, work];
  return null;
}
