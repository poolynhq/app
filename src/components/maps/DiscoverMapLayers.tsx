/**
 * Native (iOS / Android) implementation of the Discover map.
 *
 * Uses react-native-webview + MapLibre GL JS loaded from CDN —
 * the same technique as MapPinPickerModal.tsx so it works inside
 * Expo Go without a custom native build.
 *
 * The web version (DiscoverMapLayers.web.tsx) uses the browser's
 * DOM directly so there is no WebView involved.
 */
import { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

interface DiscoverMapLayersProps {
  demandGeoJson: GeoJSON.FeatureCollection;
  supplyGeoJson: GeoJSON.FeatureCollection;
  routeGeoJson: GeoJSON.FeatureCollection;
  title?: string;
  /** Map viewport height in px (default 220). */
  mapHeight?: number;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ML_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const ML_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

function buildMapHtml(
  demand: GeoJSON.FeatureCollection,
  supply: GeoJSON.FeatureCollection,
  routes: GeoJSON.FeatureCollection
): string {
  // Stringify once — embedded directly into the HTML so MapLibre
  // can read the data without any postMessage round-trip.
  const demandJson = JSON.stringify(demand);
  const supplyJson = JSON.stringify(supply);
  const routeJson = JSON.stringify(routes);

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <link href="${ML_CSS}" rel="stylesheet"/>
  <script src="${ML_JS}"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body, #map { width:100%; height:100%; overflow:hidden; background:#f0f4f0; }
    #empty {
      display:none; position:absolute; left:12px; right:12px; bottom:12px;
      background:rgba(255,255,255,0.92); border-radius:10px; padding:10px;
      font-family:-apple-system,sans-serif; font-size:12px; color:#374151;
      text-align:center; line-height:1.4;
    }
  </style>
</head>
<body>
<div id="map"></div>
<div id="empty">Route density will appear as commuters save their schedules and post rides.</div>
<script>
var DEMAND = ${demandJson};
var SUPPLY = ${supplyJson};
var ROUTES = ${routeJson};

var map = new maplibregl.Map({
  container: 'map',
  style: '${MAP_STYLE}',
  center: [138.62, -34.73],
  zoom: 10,
  attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

map.on('load', function () {
  // ── Demand heatmap ────────────────────────────────────
  map.addSource('demand', { type: 'geojson', data: DEMAND });
  map.addLayer({
    id: 'demand-heat', type: 'heatmap', source: 'demand',
    paint: {
      'heatmap-intensity': 0.9,
      'heatmap-radius': 25,
      'heatmap-opacity': 0.65,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(33,102,172,0)',
        0.3, 'rgba(103,169,207,0.8)',
        0.6, 'rgba(253,219,199,1)',
        1,   'rgba(178,24,43,1)'
      ]
    }
  });

  // ── Supply clusters ──────────────────────────────────
  map.addSource('supply', {
    type: 'geojson', data: SUPPLY,
    cluster: true, clusterRadius: 40
  });
  map.addLayer({
    id: 'supply-circles', type: 'circle', source: 'supply',
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-radius': 6, 'circle-color': '#0B8457', 'circle-opacity': 0.85 }
  });
  map.addLayer({
    id: 'supply-clusters', type: 'circle', source: 'supply',
    filter: ['has', 'point_count'],
    paint: { 'circle-radius': 16, 'circle-color': '#1A1A2E', 'circle-opacity': 0.8 }
  });
  map.addLayer({
    id: 'supply-count', type: 'symbol', source: 'supply',
    filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
    paint: { 'text-color': '#FFFFFF' }
  });

  // ── Route lines ──────────────────────────────────────
  map.addSource('routes', { type: 'geojson', data: ROUTES });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#3B82F6', 'line-width': 3, 'line-opacity': 0.8 }
  });

  // ── Auto-fit bounds ──────────────────────────────────
  var all = DEMAND.features.concat(SUPPLY.features);
  if (all.length > 0) {
    var bounds = new maplibregl.LngLatBounds();
    all.forEach(function (f) {
      if (f.geometry && f.geometry.type === 'Point') {
        bounds.extend(f.geometry.coordinates);
      }
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 600 });
    }
  }

  var hasData = all.length > 0 || ROUTES.features.length > 0;
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
  mapHeight = 220,
}: DiscoverMapLayersProps) {
  // Re-build HTML only when data changes, not on every render
  const html = useMemo(
    () => buildMapHtml(demandGeoJson, supplyGeoJson, routeGeoJson),
    [demandGeoJson, supplyGeoJson, routeGeoJson]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{title}</Text>
      <WebView
        source={{ html }}
        style={[styles.map, { height: mapHeight }]}
        javaScriptEnabled
        originWhitelist={["*"]}
        // Allow loading CDN scripts and map tiles over HTTPS
        mixedContentMode="compatibility"
        scrollEnabled={false}
        // Suppress "Reload" prompt if CDN is slow
        renderLoading={() => <View style={[styles.loading, { height: mapHeight }]} />}
        startInLoadingState
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F0F4F0",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1A1A2E",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: "#FFFFFF",
  },
  map: { minHeight: 160 },
  loading: { backgroundColor: "#F0F4F0" },
});
