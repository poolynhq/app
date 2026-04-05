import { simplifyRouteCoords, normalizeRouteCoords } from "@/lib/mapboxRouteGeometry";
import { fetchRouteInfo, mapboxTokenPresent } from "@/lib/mapboxCommutePreview";

const MAX_ROUTE_VERTICES = 90;

export type DiscoverRouteCorridor = {
  label: string;
  coordinates: [number, number][];
};

function asLineStringFeature(
  coordinates: [number, number][],
  routeKey: string,
  routeLabel: string
): GeoJSON.Feature {
  const c = simplifyRouteCoords(coordinates, MAX_ROUTE_VERTICES);
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: c },
    properties: { route_key: routeKey, route_label: routeLabel },
  };
}

/** Parse LineString GeoJSON returned from get_my_commute_route_geojson (or similar). */
export function parseStoredLineStringGeometry(geom: unknown): [number, number][] | null {
  if (!geom || typeof geom !== "object") return null;
  const o = geom as { type?: string; coordinates?: unknown };
  if (o.type !== "LineString" || !Array.isArray(o.coordinates)) return null;
  const normalized = normalizeRouteCoords(o.coordinates as number[][]);
  return normalized.length >= 2 ? normalized : null;
}

/**
 * Primary path: stored commute_routes geometry (same as matching).
 * Alternates: Mapbox Directions when token present.
 */
export async function buildDiscoverViewerRouteFeatures(
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  storedRouteGeometry: unknown
): Promise<{ features: GeoJSON.Feature[]; routeCorridors: DiscoverRouteCorridor[] }> {
  const features: GeoJSON.Feature[] = [];
  const routeCorridors: DiscoverRouteCorridor[] = [];

  let primaryCoords = parseStoredLineStringGeometry(storedRouteGeometry);

  let routeInfo: Awaited<ReturnType<typeof fetchRouteInfo>> = null;
  if (mapboxTokenPresent()) {
    routeInfo = await fetchRouteInfo(home, work);
  }

  if (!primaryCoords?.length && routeInfo?.primary?.coords?.length) {
    primaryCoords = routeInfo.primary.coords;
  }

  if (primaryCoords && primaryCoords.length >= 2) {
    const f = asLineStringFeature(primaryCoords, "primary", "Your route");
    features.push(f);
    routeCorridors.push({
      label: "Primary route",
      coordinates: (f.geometry as GeoJSON.LineString).coordinates as [number, number][],
    });
  }

  if (routeInfo?.alternates?.length) {
    routeInfo.alternates.forEach((alt, i) => {
      if (!alt.coords?.length || alt.coords.length < 2) return;
      const f = asLineStringFeature(alt.coords, `alt_${i}`, `Alternate ${i + 1}`);
      features.push(f);
      routeCorridors.push({
        label: `Alternate ${i + 1}`,
        coordinates: (f.geometry as GeoJSON.LineString).coordinates as [number, number][],
      });
    });
  }

  return { features, routeCorridors };
}
