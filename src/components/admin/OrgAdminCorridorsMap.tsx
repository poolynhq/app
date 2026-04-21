/**
 * Org admin: MapLibre map for auto commute corridors (home density heatmap + work-to-cluster axes).
 * Native (iOS/Android): WebView + inline MapLibre HTML. Web: OrgAdminCorridorsMap.web.tsx (DOM MapLibre, same pattern as DiscoverMapLayers).
 */
import { useMemo } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { DISCOVER_MAP_STYLE_URL } from "@/constants/discoverMapStyle";
import { Colors, FontSize, Spacing } from "@/constants/theme";

const ML_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const ML_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

const DEFAULT_CENTER: [number, number] = [138.6, -34.85];

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function workPinFc(work: { lng: number; lat: number } | null): GeoJSON.FeatureCollection {
  if (!work || !Number.isFinite(work.lng) || !Number.isFinite(work.lat)) return emptyFc();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "work" },
        geometry: { type: "Point", coordinates: [work.lng, work.lat] },
      },
    ],
  };
}

function buildMapHtml(
  homes: GeoJSON.FeatureCollection,
  axes: GeoJSON.FeatureCollection,
  workPin: GeoJSON.FeatureCollection,
  fallbackCenter: [number, number]
): string {
  const homesJson = JSON.stringify(homes);
  const axesJson = JSON.stringify(axes);
  const workJson = JSON.stringify(workPin);
  const fb = JSON.stringify(fallbackCenter);
  const styleJson = JSON.stringify(DISCOVER_MAP_STYLE_URL);

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <link href="${ML_CSS}" rel="stylesheet"/>
  <script src="${ML_JS}"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body, #map { width:100%; height:100%; overflow:hidden; background:#e8eef3; touch-action: none; }
  </style>
</head>
<body>
<div id="map"></div>
<script>
var HOMES = ${homesJson};
var AXES = ${axesJson};
var WORK = ${workJson};
var FALLBACK = ${fb};

function extendPoint(bounds, c) {
  if (Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) bounds.extend(c);
}
function extendFromGeometry(bounds, geom) {
  if (!geom) return;
  if (geom.type === 'Point') extendPoint(bounds, geom.coordinates);
  else if (geom.type === 'LineString') geom.coordinates.forEach(function (c) { extendPoint(bounds, c); });
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(function (line) { line.forEach(function (c) { extendPoint(bounds, c); }); });
}

var map = new maplibregl.Map({
  container: 'map',
  style: ${styleJson},
  center: FALLBACK,
  zoom: 10,
  attributionControl: false
});

map.on('load', function () {
  map.addSource('homes', { type: 'geojson', data: HOMES });
  map.addLayer({
    id: 'homes-heat',
    type: 'heatmap',
    source: 'homes',
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': 1,
      'heatmap-radius': 26,
      'heatmap-opacity': 0.78,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(236,253,245,0)',
        0.15, 'rgba(167,243,208,0.45)',
        0.35, 'rgba(52,211,153,0.72)',
        0.55, 'rgba(16,185,129,0.85)',
        0.8, 'rgba(5,150,105,0.92)',
        1, 'rgba(6,95,70,0.95)'
      ]
    }
  });

  map.addSource('axes', { type: 'geojson', data: AXES });
  map.addLayer({
    id: 'axes-line',
    type: 'line',
    source: 'axes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#0B8457',
      'line-width': 4,
      'line-opacity': 0.88
    }
  });

  map.addSource('work-pin', { type: 'geojson', data: WORK });
  map.addLayer({
    id: 'work-circle',
    type: 'circle',
    source: 'work-pin',
    filter: ['==', ['get', 'kind'], 'work'],
    paint: {
      'circle-radius': 8,
      'circle-color': '#1D4ED8',
      'circle-opacity': 0.95,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF'
    }
  });

  var bounds = new maplibregl.LngLatBounds();
  HOMES.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });
  AXES.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });
  WORK.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 500 });
  } else {
    map.setCenter(FALLBACK);
    map.setZoom(10);
  }
});
</script>
</body>
</html>`;
}

export type OrgAdminCorridorsMapProps = {
  homesGeoJson: GeoJSON.FeatureCollection;
  axisLinesGeoJson: GeoJSON.FeatureCollection;
  workCentroid: { lng: number; lat: number } | null;
  mapHeight?: number;
  /** When there is no geometry yet, center map here [lng, lat]. */
  fallbackCenter?: [number, number];
  /**
   * When the corridor list exists but GeoJSON is empty (e.g. older RPC shape), show this instead of the
   * default empty copy.
   */
  emptyGeometryHint?: string;
};

export function OrgAdminCorridorsMap({
  homesGeoJson,
  axisLinesGeoJson,
  workCentroid,
  mapHeight = 240,
  fallbackCenter = DEFAULT_CENTER,
  emptyGeometryHint,
}: OrgAdminCorridorsMapProps) {
  const workPin = useMemo(() => workPinFc(workCentroid), [workCentroid]);
  const html = useMemo(
    () => buildMapHtml(homesGeoJson, axisLinesGeoJson, workPin, fallbackCenter),
    [homesGeoJson, axisLinesGeoJson, workPin, fallbackCenter]
  );

  const hasData =
    (homesGeoJson.features?.length ?? 0) > 0 ||
    (axisLinesGeoJson.features?.length ?? 0) > 0 ||
    (workPin.features?.length ?? 0) > 0;

  if (!hasData) {
    return (
      <View style={[styles.placeholder, { minHeight: mapHeight }]}>
        <Text style={styles.placeholderText}>
          {emptyGeometryHint ??
            "Map appears when members have saved home locations and the server returns map geometry."}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height: mapHeight }]}>
      <WebView
        source={{ html }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        mixedContentMode="compatibility"
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.loading, { height: mapHeight }]}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        )}
      />
      <Text style={styles.legend}>
        Heat: home density by cluster. Green lines: workplace centroid to each cluster. Blue dot: combined
        workplace pins.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.sm,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  web: {
    flex: 1,
    width: "100%",
    backgroundColor: "#e8eef3",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#e8eef3",
  },
  legend: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    backgroundColor: Colors.surface,
  },
  placeholder: {
    justifyContent: "center",
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginTop: Spacing.sm,
  },
  placeholderText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
  },
});
