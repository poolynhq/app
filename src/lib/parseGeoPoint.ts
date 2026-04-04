/**
 * Parse PostGIS geography(Point) values from Supabase/PostgREST.
 * May arrive as WKT string, GeoJSON object, or JSON string.
 */
export function parseGeoPoint(value: unknown): { lat: number; lng: number } | null {
  if (value == null) return null;

  // Raw [lng, lat] or [lng, lat, z] from some serializers
  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    // EWKT from some PostGIS clients: SRID=4326;POINT(lng lat)
    const ewkt =
      /SRID=\d+;\s*POINT\s*(?:Z\s*)?\(\s*([-\d.]+)\s+([-\d.]+)(?:\s+[-\d.]+)?/i.exec(
        trimmed
      );
    if (ewkt) {
      const lng = parseFloat(ewkt[1]);
      const lat = parseFloat(ewkt[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    // POINT(lng lat) or POINT Z (lng lat z)
    const wkt =
      /^POINT\s*(?:Z\s*)?\(\s*([-\d.]+)\s+([-\d.]+)(?:\s+[-\d.]+)?\s*\)/i.exec(trimmed);
    if (wkt) {
      const lng = parseFloat(wkt[1]);
      const lat = parseFloat(wkt[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    if (trimmed.startsWith("{")) {
      try {
        return parseGeoPoint(JSON.parse(trimmed) as unknown);
      } catch {
        return null;
      }
    }
    return null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (o.type === "Point" && Array.isArray(o.coordinates)) {
      const c = o.coordinates as number[];
      if (c.length >= 2) {
        const lng = Number(c[0]);
        const lat = Number(c[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      }
    }
    if (o.type === "Feature" && o.geometry && typeof o.geometry === "object") {
      return parseGeoPoint(o.geometry);
    }
  }

  return null;
}
