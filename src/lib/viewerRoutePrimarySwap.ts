/**
 * Map-only: promote an alternate path to the thick "primary" styling by swapping
 * `route_key` with the server-provided primary. Geometry is unchanged.
 */
export function swapViewerRoutePrimaryFeatures(
  features: GeoJSON.Feature[],
  promotedAltKey: string
): GeoJSON.Feature[] {
  if (promotedAltKey === "primary" || !promotedAltKey.startsWith("alt_")) {
    return features;
  }
  const hasPrimary = features.some(
    (f) => (f.properties as { route_key?: string } | null)?.route_key === "primary"
  );
  const hasAlt = features.some(
    (f) => (f.properties as { route_key?: string } | null)?.route_key === promotedAltKey
  );
  if (!hasPrimary || !hasAlt) return features;

  return features.map((f) => {
    const k = (f.properties as { route_key?: string } | null)?.route_key;
    if (!k) return f;
    if (k === "primary") {
      return { ...f, properties: { ...f.properties, route_key: promotedAltKey } };
    }
    if (k === promotedAltKey) {
      return { ...f, properties: { ...f.properties, route_key: "primary" } };
    }
    return f;
  });
}

export function viewerMyRoutesDisplayCollection(
  base: GeoJSON.FeatureCollection,
  promotedAltKey: string | null
): GeoJSON.FeatureCollection {
  if (!promotedAltKey) return base;
  return {
    type: "FeatureCollection",
    features: swapViewerRoutePrimaryFeatures(base.features, promotedAltKey),
  };
}
