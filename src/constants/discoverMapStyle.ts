/**
 * Basemap for MapLibre discover / home corridor maps.
 * OpenFreeMap "Liberty" currently 404s glyph PBFs (Open Sans), which breaks symbol layers
 * and can prevent overlays from painting reliably in some MapLibre builds.
 */
export const DISCOVER_MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Viewer primary commute polyline. */
export const DISCOVER_VIEWER_ROUTE_PRIMARY = "#0B8457";
/**
 * First Mapbox alternate — must differ from {@link DISCOVER_PEER_RIDE_ROUTE} so “my other path”
 * is not confused with someone else’s posted trip (same blue as before caused that mix-up).
 */
export const DISCOVER_VIEWER_ROUTE_ALT0 = "#0D9488";
export const DISCOVER_VIEWER_ROUTE_ALT1 = "#CA8A04";
export const DISCOVER_VIEWER_ROUTE_ALT2 = "#7C3AED";
export const DISCOVER_VIEWER_ROUTE_ALT_FALLBACK = "#64748B";

/** Other members’ scheduled/active ride paths. */
export const DISCOVER_PEER_RIDE_ROUTE = "#2563EB";

/** Map overlay scale (MapLibre px). Keep native WebView and web DOM maps aligned. */
export const DISCOVER_MAP_HEATMAP_RADIUS_PX = 22;
export const DISCOVER_MAP_CLUSTER_RADIUS_PX = 36;
export const DISCOVER_MAP_SUPPLY_DOT_RADIUS = 5;
export const DISCOVER_MAP_SUPPLY_CLUSTER_RADIUS = 13;
export const DISCOVER_MAP_PEER_LINE_WIDTH = 3;
export const DISCOVER_MAP_VIEWER_PRIMARY_WIDTH = 5;
export const DISCOVER_MAP_VIEWER_ALT_WIDTH = 3;
export const DISCOVER_MAP_PIN_HOME_RADIUS = 7;
export const DISCOVER_MAP_PIN_WORK_RADIUS = 6;
export const DISCOVER_MAP_PIN_STROKE_WIDTH = 2;
