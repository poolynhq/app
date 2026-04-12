/**
 * Native (iOS / Android): WebView + MapLibre GL JS (Expo Go friendly).
 * See DiscoverMapLayers.web.tsx for DOM implementation.
 */
import { useMemo } from "react";
import { View, Text, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import type { MapLayerEmphasis } from "@/lib/mapLayerEmphasis";
import {
  DISCOVER_MAP_CLUSTER_RADIUS_PX,
  DISCOVER_MAP_HEATMAP_RADIUS_PX,
  DISCOVER_MAP_PEER_LINE_WIDTH,
  DISCOVER_MAP_PIN_HOME_RADIUS,
  DISCOVER_MAP_PIN_STROKE_WIDTH,
  DISCOVER_MAP_PIN_WORK_RADIUS,
  DISCOVER_MAP_STYLE_URL,
  DISCOVER_MAP_SUPPLY_CLUSTER_RADIUS,
  DISCOVER_MAP_SUPPLY_DOT_RADIUS,
  DISCOVER_MAP_VIEWER_ALT_WIDTH,
  DISCOVER_MAP_VIEWER_PRIMARY_WIDTH,
  DISCOVER_PEER_RIDE_ROUTE,
  DISCOVER_VIEWER_ROUTE_ALT0,
  DISCOVER_VIEWER_ROUTE_ALT1,
  DISCOVER_VIEWER_ROUTE_ALT2,
  DISCOVER_VIEWER_ROUTE_ALT_FALLBACK,
  DISCOVER_VIEWER_ROUTE_PRIMARY,
} from "@/constants/discoverMapStyle";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface DiscoverMapLayersProps {
  demandGeoJson: GeoJSON.FeatureCollection;
  supplyGeoJson: GeoJSON.FeatureCollection;
  routeGeoJson: GeoJSON.FeatureCollection;
  /** Home / work pins (same as Profile → Commute). */
  viewerPinsGeoJson?: GeoJSON.FeatureCollection;
  /** Stored driving route + Mapbox alternates (no straight crow line). */
  viewerMyRoutesGeoJson?: GeoJSON.FeatureCollection;
  /** When driving, boost demand heat; when riding, boost driver dots. */
  layerEmphasis?: MapLayerEmphasis;
  title?: string;
  /** Map viewport height in px (default 280). */
  mapHeight?: number;
  /** When there is no demand/supply/route data, center here [lng, lat] (e.g. home). */
  fallbackCenter?: [number, number];
  /** When true, show a compact loading bar above the map (RPC in flight). */
  remoteLoading?: boolean;
  /** Tap an alternate route line (not primary) to promote it to the thick “main” style. */
  onViewerRouteAlternateTap?: (routeKey: string) => void;
  /**
   * Home Mingle: drop the title row and footer legend so the map stays visible; shorten in-map hints.
   */
  compactMapChrome?: boolean;
}

const ML_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const ML_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

const DEFAULT_CENTER: [number, number] = [138.6, -34.85];

function buildMapHtml(
  demand: GeoJSON.FeatureCollection,
  supply: GeoJSON.FeatureCollection,
  routes: GeoJSON.FeatureCollection,
  viewerPins: GeoJSON.FeatureCollection,
  viewerRoutes: GeoJSON.FeatureCollection,
  fallbackCenter: [number, number],
  emphasis: MapLayerEmphasis,
  compactHints: boolean
): string {
  const demandJson = JSON.stringify(demand);
  const supplyJson = JSON.stringify(supply);
  const routeJson = JSON.stringify(routes);
  const viewerPinsJson = JSON.stringify(viewerPins);
  const viewerRoutesJson = JSON.stringify(viewerRoutes);
  const fb = JSON.stringify(fallbackCenter);
  const emphJson = JSON.stringify(emphasis);
  const styleJson = JSON.stringify(DISCOVER_MAP_STYLE_URL);
  const suppressEmptyOverlay = JSON.stringify(compactHints);

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
<div id="empty"></div>
<script>
var DEMAND = ${demandJson};
var SUPPLY = ${supplyJson};
var ROUTES = ${routeJson};
var VIEWER_PINS = ${viewerPinsJson};
var VIEWER_ROUTES = ${viewerRoutesJson};
var FALLBACK = ${fb};
var EMPHASIS = ${emphJson};

function applyLayerEmphasis(map, e) {
  var heatO = e === 'demand' ? 0.92 : e === 'supply' ? 0.38 : 0.72;
  var supplyDotO = e === 'supply' ? 0.94 : e === 'demand' ? 0.52 : 0.88;
  var clusterO = e === 'supply' ? 0.9 : e === 'demand' ? 0.58 : 0.82;
  map.setPaintProperty('demand-heat', 'heatmap-opacity', heatO);
  map.setPaintProperty('supply-circles', 'circle-opacity', supplyDotO);
  map.setPaintProperty('supply-clusters', 'circle-opacity', clusterO);
}

function bringViewerLayersToFront(map) {
  ['viewer-my-routes-line', 'viewer-my-routes-line-hit', 'viewer-home', 'viewer-work', 'viewer-home-label', 'viewer-work-label'].forEach(function (id) {
    if (map.getLayer(id)) {
      try { map.moveLayer(id); } catch (e) { /* noop */ }
    }
  });
}

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
  zoom: 11,
  attributionControl: false
});

map.on('load', function () {
  map.addSource('demand', { type: 'geojson', data: DEMAND });
  map.addLayer({
    id: 'demand-heat', type: 'heatmap', source: 'demand',
    paint: {
      'heatmap-intensity': 1,
      'heatmap-radius': ${DISCOVER_MAP_HEATMAP_RADIUS_PX},
      'heatmap-opacity': 0.72,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(255,247,237,0)',
        0.15,'rgba(254,215,170,0.45)',
        0.4, 'rgba(251,146,60,0.75)',
        0.7, 'rgba(234,88,12,0.88)',
        1,   'rgba(185,28,28,0.95)'
      ]
    }
  });

  map.addSource('supply', {
    type: 'geojson', data: SUPPLY,
    cluster: true, clusterRadius: ${DISCOVER_MAP_CLUSTER_RADIUS_PX}
  });
  map.addLayer({
    id: 'supply-circles', type: 'circle', source: 'supply',
    filter: ['!', ['has', 'point_count']],
    paint: { 'circle-radius': ${DISCOVER_MAP_SUPPLY_DOT_RADIUS}, 'circle-color': '#0B8457', 'circle-opacity': 0.88 }
  });
  map.addLayer({
    id: 'supply-clusters', type: 'circle', source: 'supply',
    filter: ['has', 'point_count'],
    paint: { 'circle-radius': ${DISCOVER_MAP_SUPPLY_CLUSTER_RADIUS}, 'circle-color': '#1A1A2E', 'circle-opacity': 0.82 }
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
    paint: { 'line-color': '${DISCOVER_PEER_RIDE_ROUTE}', 'line-width': ${DISCOVER_MAP_PEER_LINE_WIDTH}, 'line-opacity': 0.82 }
  });

  map.addSource('viewer-routes', { type: 'geojson', data: VIEWER_ROUTES });
  map.addSource('viewer-pins', { type: 'geojson', data: VIEWER_PINS });
  map.addLayer({
    id: 'viewer-my-routes-line', type: 'line', source: 'viewer-routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': [
        'match', ['get', 'route_key'],
        'primary', '${DISCOVER_VIEWER_ROUTE_PRIMARY}',
        'alt_0', '${DISCOVER_VIEWER_ROUTE_ALT0}',
        'alt_1', '${DISCOVER_VIEWER_ROUTE_ALT1}',
        'alt_2', '${DISCOVER_VIEWER_ROUTE_ALT2}',
        '${DISCOVER_VIEWER_ROUTE_ALT_FALLBACK}'
      ],
      'line-width': ['match', ['get', 'route_key'], 'primary', ${DISCOVER_MAP_VIEWER_PRIMARY_WIDTH}, ${DISCOVER_MAP_VIEWER_ALT_WIDTH}],
      'line-opacity': 0.92
    }
  });
  map.addLayer({
    id: 'viewer-my-routes-line-hit', type: 'line', source: 'viewer-routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#000000',
      'line-width': 22,
      'line-opacity': 0
    }
  });
  map.addLayer({
    id: 'viewer-home', type: 'circle', source: 'viewer-pins',
    filter: ['==', ['get', 'kind'], 'home'],
    paint: {
      'circle-radius': ${DISCOVER_MAP_PIN_HOME_RADIUS},
      'circle-color': '#EA580C',
      'circle-opacity': 0.95,
      'circle-stroke-width': ${DISCOVER_MAP_PIN_STROKE_WIDTH},
      'circle-stroke-color': '#FFFFFF'
    }
  });
  map.addLayer({
    id: 'viewer-work', type: 'circle', source: 'viewer-pins',
    filter: ['==', ['get', 'kind'], 'work'],
    paint: {
      'circle-radius': ${DISCOVER_MAP_PIN_WORK_RADIUS},
      'circle-color': '#1D4ED8',
      'circle-opacity': 0.95,
      'circle-stroke-width': ${DISCOVER_MAP_PIN_STROKE_WIDTH},
      'circle-stroke-color': '#FFFFFF'
    }
  });
  map.addLayer({
    id: 'viewer-home-label', type: 'symbol', source: 'viewer-pins',
    filter: ['==', ['get', 'kind'], 'home'],
    layout: {
      'text-field': 'Home',
      'text-size': 11,
      'text-offset': [0, -1.8],
      'text-anchor': 'bottom',
      'text-allow-overlap': true
    },
    paint: { 'text-color': '#9A3412', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }
  });
  map.addLayer({
    id: 'viewer-work-label', type: 'symbol', source: 'viewer-pins',
    filter: ['==', ['get', 'kind'], 'work'],
    layout: {
      'text-field': 'Work',
      'text-size': 11,
      'text-offset': [0, -1.8],
      'text-anchor': 'bottom',
      'text-allow-overlap': true
    },
    paint: { 'text-color': '#1E40AF', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }
  });

  applyLayerEmphasis(map, EMPHASIS);
  bringViewerLayersToFront(map);

  var bounds = new maplibregl.LngLatBounds();
  [DEMAND, SUPPLY, VIEWER_PINS, VIEWER_ROUTES].forEach(function (fc) {
    fc.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });
  });
  ROUTES.features.forEach(function (f) { extendFromGeometry(bounds, f.geometry); });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 650 });
  } else {
    map.setCenter(FALLBACK);
    map.setZoom(11);
  }

  var hasPeerData = DEMAND.features.length + SUPPLY.features.length + ROUTES.features.length > 0;
  var hasViewerPins = VIEWER_PINS.features.length > 0;
  var hasViewerRoutes = VIEWER_ROUTES.features.length > 0;
  var emptyEl = document.getElementById('empty');
  var suppressEmptyOverlay = ${suppressEmptyOverlay};
  if (suppressEmptyOverlay) {
    emptyEl.style.display = 'none';
  } else if (!hasPeerData && !hasViewerPins) {
    emptyEl.textContent = 'No commute pins yet. Add home & work under Profile → Commute, or switch to Any commuter. Orange heat = others’ demand; green = drivers; solid blue lines = others’ posted trips (not your alternates).';
    emptyEl.style.display = 'block';
  } else if (!hasPeerData && (hasViewerPins || hasViewerRoutes)) {
    emptyEl.textContent = 'Your route: dark green = primary; teal / amber / purple = your optional paths when Mapbox is on. Tap an alternate line to make it your main route. Work pin is blue (not a line). Separate solid blue lines = others’ posted trips. Heat = demand in scope.';
    emptyEl.style.display = 'block';
  }

  function postRouteTap(routeKey) {
    if (!routeKey || routeKey === 'primary') return;
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'viewer_route_tap', route_key: routeKey }));
    }
  }
  map.on('click', 'viewer-my-routes-line-hit', function (e) {
    var f = e.features && e.features[0];
    if (!f || !f.properties) return;
    postRouteTap(f.properties.route_key);
  });
});
</script>
</body>
</html>`;
}

export function DiscoverMapLayers({
  demandGeoJson,
  supplyGeoJson,
  routeGeoJson,
  viewerPinsGeoJson = EMPTY_FC,
  viewerMyRoutesGeoJson = EMPTY_FC,
  layerEmphasis = "neutral",
  title = "Commute map",
  mapHeight = 280,
  fallbackCenter = DEFAULT_CENTER,
  remoteLoading = false,
  onViewerRouteAlternateTap,
  compactMapChrome = false,
}: DiscoverMapLayersProps) {
  const html = useMemo(
    () =>
      buildMapHtml(
        demandGeoJson,
        supplyGeoJson,
        routeGeoJson,
        viewerPinsGeoJson,
        viewerMyRoutesGeoJson,
        fallbackCenter,
        layerEmphasis,
        compactMapChrome
      ),
    [
      demandGeoJson,
      supplyGeoJson,
      routeGeoJson,
      viewerPinsGeoJson,
      viewerMyRoutesGeoJson,
      fallbackCenter,
      layerEmphasis,
      compactMapChrome,
    ]
  );

  const viewerGeometryKey = useMemo(() => {
    const pins = viewerPinsGeoJson.features.map((f) => JSON.stringify(f.geometry)).join("|");
    const routes = viewerMyRoutesGeoJson.features.map((f) => JSON.stringify(f.geometry)).join("|");
    const routeKeys = viewerMyRoutesGeoJson.features
      .map((f) => String((f.properties as { route_key?: string } | null)?.route_key ?? ""))
      .join("|");
    return `${pins}||${routes}||${routeKeys}`;
  }, [viewerPinsGeoJson, viewerMyRoutesGeoJson]);

  // Do not include layerEmphasis: remounting the WebView on Driving/Riding toggle wipes layers and flickers.
  const centerKey = `${fallbackCenter[0]},${fallbackCenter[1]},${viewerGeometryKey}`;

  const showMapHeader = !compactMapChrome;

  return (
    <View style={[styles.container, compactMapChrome && styles.containerCompactChrome]}>
      {showMapHeader ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{title}</Text>
          {remoteLoading ? (
            <View style={styles.remoteLoading}>
              <ActivityIndicator size="small" color="#0B8457" />
              <Text style={styles.remoteLoadingText}>Updating…</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.mapClip}>
        {!showMapHeader && remoteLoading ? (
          <View style={styles.compactUpdatingBar}>
            <ActivityIndicator size="small" color="#0B8457" />
            <Text style={styles.remoteLoadingText}>Updating…</Text>
          </View>
        ) : null}
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
          onMessage={(e) => {
            if (!onViewerRouteAlternateTap) return;
            try {
              const msg = JSON.parse(e.nativeEvent.data) as { type?: string; route_key?: string };
              if (msg.type === "viewer_route_tap" && msg.route_key && msg.route_key !== "primary") {
                onViewerRouteAlternateTap(msg.route_key);
              }
            } catch {
              /* ignore */
            }
          }}
          renderLoading={() => (
            <View style={[styles.loading, { height: mapHeight }]}>
              <ActivityIndicator color="#0B8457" />
              <Text style={styles.loadingText}>Loading map…</Text>
            </View>
          )}
        />
      </View>
      {!compactMapChrome ? (
        <>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLinePrimary]} />
              <Text style={styles.legendText}>Your main route</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLineAlt]} />
              <Text style={styles.legendText}>Your alternates (teal…)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#EA580C" }]} />
              <Text style={styles.legendText}>Your home</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#1D4ED8" }]} />
              <Text style={styles.legendText}>Your work</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: "#FDBA74" }]} />
              <Text style={styles.legendText}>Others’ demand</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#0B8457" }]} />
              <Text style={styles.legendText}>Drivers</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine]} />
              <Text style={styles.legendText}>Others’ trip lines</Text>
            </View>
          </View>
          {Platform.OS === "android" ? (
            <Text style={styles.panHint}>Pinch and drag inside the map to zoom and pan.</Text>
          ) : (
            <Text style={styles.panHint}>Use two fingers to zoom; drag to move the map.</Text>
          )}
        </>
      ) : null}
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
  containerCompactChrome: {
    paddingTop: 10,
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
    position: "relative",
    marginHorizontal: 10,
    marginBottom: 4,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  compactUpdatingBar: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.92)",
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
  legendSwatch: {
    width: 12,
    height: 8,
    borderRadius: 3,
  },
  legendLine: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: DISCOVER_PEER_RIDE_ROUTE,
  },
  legendLinePrimary: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: DISCOVER_VIEWER_ROUTE_PRIMARY,
  },
  legendLineAlt: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: DISCOVER_VIEWER_ROUTE_ALT0,
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
