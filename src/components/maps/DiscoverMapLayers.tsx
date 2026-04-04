/**
 * Native (iOS / Android) — WebView + MapLibre GL JS (Expo Go friendly).
 * See DiscoverMapLayers.web.tsx for DOM implementation.
 */
import { useMemo } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

interface DiscoverMapLayersProps {
  demandGeoJson: GeoJSON.FeatureCollection;
  supplyGeoJson: GeoJSON.FeatureCollection;
  routeGeoJson: GeoJSON.FeatureCollection;
  title?: string;
  /** Map viewport height in px (default 280). */
  mapHeight?: number;
  /** When there is no demand/supply/route data, center here [lng, lat] (e.g. home). */
  fallbackCenter?: [number, number];
  /** When true, show a compact loading bar above the map (RPC in flight). */
  remoteLoading?: boolean;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ML_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const ML_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

const DEFAULT_CENTER: [number, number] = [138.6, -34.85];

function buildMapHtml(
  demand: GeoJSON.FeatureCollection,
  supply: GeoJSON.FeatureCollection,
  routes: GeoJSON.FeatureCollection,
  fallbackCenter: [number, number]
): string {
  const demandJson = JSON.stringify(demand);
  const supplyJson = JSON.stringify(supply);
  const routeJson = JSON.stringify(routes);
  const fb = JSON.stringify(fallbackCenter);

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <link href="${ML_CSS}" rel="stylesheet"/>
  <script src="${ML_JS}"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body, #map { width:100%; height:100%; overflow:hidden; background:#e8eef3; touch-action: none; }
    #empty {
      display:none; position:absolute; left:10px; right:10px; bottom:10px;
      background:rgba(255,255,255,0.95); border-radius:10px; padding:10px;
      font-family:-apple-system,sans-serif; font-size:12px; color:#374151;
      text-align:center; line-height:1.45;
      box-shadow:0 1px 4px rgba(0,0,0,0.08);
    }
  </style>
</head>
<body>
<div id="map"></div>
<div id="empty">No route or pickup signals in this view yet. Complete your commute in Profile, or widen to Nearby commuters. The map is centered on your saved home area when available.</div>
<script>
var DEMAND = ${demandJson};
var SUPPLY = ${supplyJson};
var ROUTES = ${routeJson};
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
  style: '${MAP_STYLE}',
  center: FALLBACK,
  zoom: 11,
  attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

map.on('load', function () {
  map.addSource('demand', { type: 'geojson', data: DEMAND });
  map.addLayer({
    id: 'demand-heat', type: 'heatmap', source: 'demand',
    paint: {
      'heatmap-intensity': 0.9,
      'heatmap-radius': 28,
      'heatmap-opacity': 0.68,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(33,102,172,0)',
        0.3, 'rgba(103,169,207,0.8)',
        0.6, 'rgba(253,219,199,1)',
        1,   'rgba(178,24,43,1)'
      ]
    }
  });

  map.addSource('supply', {
    type: 'geojson', data: SUPPLY,
    cluster: true, clusterRadius: 42
  });
  map.addLayer({
    id: 'supply-circles', type: 'circle', source: 'supply',
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-radius': 7, 'circle-color': '#0B8457', 'circle-opacity': 0.88 }
  });
  map.addLayer({
    id: 'supply-clusters', type: 'circle', source: 'supply',
    filter: ['has', 'point_count'],
    paint: { 'circle-radius': 17, 'circle-color': '#1A1A2E', 'circle-opacity': 0.82 }
  });
  map.addLayer({
    id: 'supply-count', type: 'symbol', source: 'supply',
    filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
    paint: { 'text-color': '#FFFFFF' }
  });

  map.addSource('routes', { type: 'geojson', data: ROUTES });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#2563EB', 'line-width': 4, 'line-opacity': 0.82 }
  });

  var bounds = new maplibregl.LngLatBounds();
  [DEMAND, SUPPLY].forEach(function (fc) {
    fc.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });
  });
  ROUTES.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 52, maxZoom: 13, duration: 650 });
  } else {
    map.setCenter(FALLBACK);
    map.setZoom(11);
  }

  var hasData = DEMAND.features.length + SUPPLY.features.length + ROUTES.features.length > 0;
  if (!hasData) document.getElementById('empty').style.display = 'block';
});
</script>
</body>
</html>`;
}

export function DiscoverMapLayers({
  demandGeoJson,
  supplyGeoJson,
  routeGeoJson,
  title = "Commute map",
  mapHeight = 280,
  fallbackCenter = DEFAULT_CENTER,
  remoteLoading = false,
}: DiscoverMapLayersProps) {
  const html = useMemo(
    () => buildMapHtml(demandGeoJson, supplyGeoJson, routeGeoJson, fallbackCenter),
    [demandGeoJson, supplyGeoJson, routeGeoJson, fallbackCenter]
  );

  const centerKey = `${fallbackCenter[0]},${fallbackCenter[1]}`;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{title}</Text>
        {remoteLoading ? (
          <View style={styles.remoteLoading}>
            <ActivityIndicator size="small" color="#0B8457" />
            <Text style={styles.remoteLoadingText}>Updating…</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.mapClip}>
        <WebView
          key={centerKey}
          source={{ html }}
          style={[styles.map, { height: mapHeight }]}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
          mixedContentMode="compatibility"
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          androidLayerType="hardware"
          nestedScrollEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loading, { height: mapHeight }]}>
              <ActivityIndicator color="#0B8457" />
              <Text style={styles.loadingText}>Loading map…</Text>
            </View>
          )}
        />
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#B91C1C" }]} />
          <Text style={styles.legendText}>Rider demand</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#0B8457" }]} />
          <Text style={styles.legendText}>Drivers</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine]} />
          <Text style={styles.legendText}>Routes</Text>
        </View>
      </View>
      {Platform.OS === "android" ? (
        <Text style={styles.panHint}>Pinch and drag inside the map to zoom and pan.</Text>
      ) : (
        <Text style={styles.panHint}>Use two fingers to zoom; drag to move the map.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A2E",
    flex: 1,
  },
  remoteLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  remoteLoadingText: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "600",
  },
  mapClip: {
    marginHorizontal: 10,
    marginBottom: 4,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  map: {
    minHeight: 160,
    backgroundColor: "#e8eef3",
  },
  loading: {
    backgroundColor: "#e8eef3",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: "#6B7280",
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLine: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#2563EB",
  },
  legendText: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "600",
  },
  panHint: {
    fontSize: 11,
    color: "#9CA3AF",
    paddingHorizontal: 14,
    paddingBottom: 12,
    lineHeight: 15,
  },
});
