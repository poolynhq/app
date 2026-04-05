import type { User } from "@/types/database";
import { parseGeoPoint } from "@/lib/parseGeoPoint";

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Split combined viewer FC into dedicated sources (line vs pins) for reliable MapLibre layers. */
export function splitViewerCommuteFeatureCollection(fc: GeoJSON.FeatureCollection): {
  line: GeoJSON.FeatureCollection;
  pins: GeoJSON.FeatureCollection;
} {
  const lineFeatures = fc.features.filter((f) => f.geometry?.type === "LineString");
  const pinFeatures = fc.features.filter((f) => f.geometry?.type === "Point");
  return {
    line: { type: "FeatureCollection", features: lineFeatures },
    pins: { type: "FeatureCollection", features: pinFeatures },
  };
}

function lngLatPair(pt: { lat: number; lng: number }): [number, number] {
  return [Number(pt.lng), Number(pt.lat)];
}

/** Home / work pins only (driving routes come from commute_routes + Mapbox on discover map). */
export function buildViewerPinsOnly(homeRaw: unknown, workRaw: unknown): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const home = parseGeoPoint(homeRaw);
  const work = parseGeoPoint(workRaw);
  if (home) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: lngLatPair(home) },
      properties: { kind: "home" },
    });
  }
  if (work) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: lngLatPair(work) },
      properties: { kind: "work" },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Build viewer commute GeoJSON from raw DB geography (legacy: straight line + pins).
 * Prefer discover map flow: pins via {@link buildViewerPinsOnly} + driving routes from DB/Mapbox.
 */
export function buildViewerCommuteMapFeaturesFromRaw(
  homeRaw: unknown,
  workRaw: unknown
): GeoJSON.FeatureCollection {
  const home = parseGeoPoint(homeRaw);
  const work = parseGeoPoint(workRaw);
  const pins = buildViewerPinsOnly(homeRaw, workRaw);
  if (!home || !work) return pins;

  const withLine: GeoJSON.Feature[] = [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [lngLatPair(home), lngLatPair(work)],
      },
      properties: { kind: "commute_line" },
    },
    ...pins.features,
  ];
  return { type: "FeatureCollection", features: withLine };
}

/**
 * Viewer commute: straight home→work line (orientation), plus home/work pins.
 * (Not included in get_map_layers_for_discover aggregates.)
 */
export function buildViewerCommuteMapFeatures(profile: User | null): GeoJSON.FeatureCollection {
  if (!profile) return empty;
  return buildViewerCommuteMapFeaturesFromRaw(
    profile.home_location as unknown,
    profile.work_location as unknown
  );
}
