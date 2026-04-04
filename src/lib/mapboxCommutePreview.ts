import { simplifyRouteCoords } from "@/lib/mapboxRouteGeometry";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

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

/** Driving routes with alternatives (Mapbox Directions API). */
export async function fetchRouteInfo(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): Promise<RouteInfo | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}?access_token=${MAPBOX_TOKEN}&alternatives=true&geometries=geojson&overview=full`
    );
    const data = (await res.json()) as {
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    if (!data.routes?.length) return null;
    const mapped = data.routes.map((r) => ({
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      coords: simplifyRouteCoords(r.geometry.coordinates, 22),
    }));
    const [primary, ...alternates] = mapped;
    return { primary, alternates: alternates.slice(0, 2) };
  } catch {
    return null;
  }
}

/** Static map with route overlays + pins (start = green, end = red). */
export function buildStaticCommuteMapUrl(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  routeInfo: RouteInfo | null,
  size = "600x260@2x"
): string {
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

  overlays.push(`pin-l+0B8457(${start.lng},${start.lat})`);
  overlays.push(`pin-l+E74C3C(${end.lng},${end.lat})`);

  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size}?padding=70&access_token=${MAPBOX_TOKEN}`;
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
