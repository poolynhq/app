/**
 * PostGIS EWKB / WKB hex (some PostgREST + geography combos return this instead of WKT).
 * Parses only Point (optionally with SRID flag); returns null for other types.
 */
function parseHexEwkbPoint(raw: string): { lat: number; lng: number } | null {
  let hex = raw.trim();
  if (hex.startsWith("\\x") || hex.startsWith("0x")) hex = hex.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 42) return null;

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  let o = 0;
  const le = bytes[o++] === 1;

  const readU32 = (): number => {
    if (o + 4 > bytes.length) return 0;
    const a = bytes[o]!;
    const b = bytes[o + 1]!;
    const c = bytes[o + 2]!;
    const d = bytes[o + 3]!;
    o += 4;
    return le
      ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
      : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  };

  const readF64 = (): number => {
    if (o + 8 > bytes.length) return NaN;
    const ab = new ArrayBuffer(8);
    const view = new DataView(ab);
    for (let i = 0; i < 8; i++) {
      view.setUint8(i, bytes[o + i]!);
    }
    o += 8;
    return le ? view.getFloat64(0, true) : view.getFloat64(0, false);
  };

  let type = readU32();
  const SRID_FLAG = 0x20000000;
  if (type & SRID_FLAG) {
    type ^= SRID_FLAG;
    readU32();
  }
  if (type !== 1) return null;
  const x = readF64();
  const y = readF64();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lng: x, lat: y };
}

/**
 * RPC / nested JSON sometimes returns GeoJSON as a stringified object. Parse when needed before `parseGeoPoint`.
 */
export function normalizeRpcGeoJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        return value;
      }
    }
    return value;
  }
  return value;
}

/**
 * Parse PostGIS geography(Point) values from Supabase/PostgREST.
 * May arrive as WKT string, hex EWKB, GeoJSON object, or JSON string.
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
    const hexPt = parseHexEwkbPoint(trimmed);
    if (hexPt) return hexPt;
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

/**
 * PostgREST / JSON often returns `double precision` RPC columns as strings.
 * Invalid or missing values must not become 0,0 (Null Island).
 */
export function parseRpcFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Reject (0,0) and out-of-range WGS84 coordinates. */
export function isPlausibleWgs84LatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 1e-7 && Math.abs(lng) < 1e-7) return false;
  return Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
}
