import type { User } from "@/types/database";
import { parseGeoPoint } from "@/lib/parseGeoPoint";

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Home + work points for the signed-in user (not included in get_map_layers_for_discover aggregates).
 */
export function buildViewerCommuteMapFeatures(profile: User | null): GeoJSON.FeatureCollection {
  if (!profile) return empty;

  const features: GeoJSON.Feature[] = [];
  const home = parseGeoPoint(profile.home_location as unknown);
  if (home) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [home.lng, home.lat] },
      properties: { kind: "home" },
    });
  }
  const work = parseGeoPoint(profile.work_location as unknown);
  if (work) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [work.lng, work.lat] },
      properties: { kind: "work" },
    });
  }

  return { type: "FeatureCollection", features };
}
