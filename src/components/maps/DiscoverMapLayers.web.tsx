import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
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

type MapLayerBundle = {
  demandGeoJson: GeoJSON.FeatureCollection;
  supplyGeoJson: GeoJSON.FeatureCollection;
  routeGeoJson: GeoJSON.FeatureCollection;
  viewerPinsGeoJson: GeoJSON.FeatureCollection;
  viewerMyRoutesGeoJson: GeoJSON.FeatureCollection;
  fallbackCenter: [number, number];
  layerEmphasis: MapLayerEmphasis;
};

function applyLayerEmphasis(map: any, e: MapLayerEmphasis) {
  if (!map.getLayer("demand-heat")) return;
  const heatO = e === "demand" ? 0.92 : e === "supply" ? 0.38 : 0.72;
  const supplyDotO = e === "supply" ? 0.94 : e === "demand" ? 0.52 : 0.88;
  const clusterO = e === "supply" ? 0.9 : e === "demand" ? 0.58 : 0.82;
  map.setPaintProperty("demand-heat", "heatmap-opacity", heatO);
  map.setPaintProperty("supply-circles", "circle-opacity", supplyDotO);
  map.setPaintProperty("supply-clusters", "circle-opacity", clusterO);
}

interface DiscoverMapLayersProps {
  demandGeoJson: GeoJSON.FeatureCollection;
  supplyGeoJson: GeoJSON.FeatureCollection;
  routeGeoJson: GeoJSON.FeatureCollection;
  viewerPinsGeoJson?: GeoJSON.FeatureCollection;
  viewerMyRoutesGeoJson?: GeoJSON.FeatureCollection;
  layerEmphasis?: MapLayerEmphasis;
  title?: string;
  mapHeight?: number;
  /** [lng, lat] when there is no data to fit */
  fallbackCenter?: [number, number];
  remoteLoading?: boolean;
  onViewerRouteAlternateTap?: (routeKey: string) => void;
  /** Shorter empty-state copy so the map stays readable (e.g. Home Mingle). */
  compactMapChrome?: boolean;
}

const ML_CSS_ID = "maplibre-css-discover";
const ML_SCRIPT_SRC = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

// Reuse the already-loaded MapLibre bundle (shared with MapPinPickerModal)
function loadMapLibre(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).maplibregl) { resolve(); return; }
    if (!document.getElementById(ML_CSS_ID)) {
      const link = document.createElement("link");
      link.id = ML_CSS_ID;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${ML_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = ML_SCRIPT_SRC;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

function collectBounds(
  collections: GeoJSON.FeatureCollection[]
): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let found = false;

  for (const col of collections) {
    for (const f of col.features) {
      const geom = f.geometry;
      if (!geom) continue;

      const pts: [number, number][] = [];
      if (geom.type === "Point") pts.push(geom.coordinates as [number, number]);
      else if (geom.type === "LineString") pts.push(...(geom.coordinates as [number, number][]));
      else if (geom.type === "MultiLineString")
        pts.push(...(geom.coordinates.flat() as [number, number][]));

      for (const [lng, lat] of pts) {
        if (!isFinite(lng) || !isFinite(lat)) continue;
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
        found = true;
      }
    }
  }

  return found ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

const DEFAULT_CENTER: [number, number] = [138.6, -34.85];

const VIEWER_LAYER_IDS = [
  "viewer-my-routes-line",
  "viewer-my-routes-line-hit",
  "viewer-home",
  "viewer-work",
  "viewer-home-label",
  "viewer-work-label",
] as const;

/** Liberty / some basemap stacks paint custom layers under symbols; move viewer to the top. */
function bringViewerLayersToFront(map: any) {
  for (const id of VIEWER_LAYER_IDS) {
    if (map.getLayer(id)) {
      try {
        map.moveLayer(id);
      } catch {
        /* noop */
      }
    }
  }
}

export function DiscoverMapLayers({
  demandGeoJson,
  supplyGeoJson,
  routeGeoJson,
  viewerPinsGeoJson = EMPTY_FC,
  viewerMyRoutesGeoJson = EMPTY_FC,
  layerEmphasis = "neutral",
  title = "Commute map",
  mapHeight = 240,
  fallbackCenter = DEFAULT_CENTER,
  remoteLoading = false,
  onViewerRouteAlternateTap,
  compactMapChrome = false,
}: DiscoverMapLayersProps) {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const routeTapRef = useRef(onViewerRouteAlternateTap);
  routeTapRef.current = onViewerRouteAlternateTap;
  const latestRef = useRef<MapLayerBundle>({
    demandGeoJson,
    supplyGeoJson,
    routeGeoJson,
    viewerPinsGeoJson,
    viewerMyRoutesGeoJson,
    fallbackCenter,
    layerEmphasis,
  });
  latestRef.current = {
    demandGeoJson,
    supplyGeoJson,
    routeGeoJson,
    viewerPinsGeoJson,
    viewerMyRoutesGeoJson,
    fallbackCenter,
    layerEmphasis,
  };

  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState(false);

  const hasPeerData =
    demandGeoJson.features.length > 0 ||
    supplyGeoJson.features.length > 0 ||
    routeGeoJson.features.length > 0;
  const hasViewerPins = viewerPinsGeoJson.features.length > 0;
  const hasViewerRoutes = viewerMyRoutesGeoJson.features.length > 0;

  // Initialise map once on mount
  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(async () => {
      if (!containerRef.current || mapRef.current) return;
      try {
        await loadMapLibre();
      } catch {
        if (mounted) setError(true);
        return;
      }
      if (!mounted) return;

      const ml = (window as any).maplibregl;
      if (!ml) { setError(true); return; }

      const L = latestRef.current;
      const map = new ml.Map({
        container: containerRef.current,
        style: DISCOVER_MAP_STYLE_URL,
        center: L.fallbackCenter,
        zoom: 11,
        attributionControl: false,
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!mounted) return;

        const p = latestRef.current;

        // ── Demand heatmap (pickup origins) ─────────────────────────────────
        map.addSource("demand", { type: "geojson", data: p.demandGeoJson });
        map.addLayer({
          id: "demand-heat",
          type: "heatmap",
          source: "demand",
          paint: {
            "heatmap-intensity": 1,
            "heatmap-radius": DISCOVER_MAP_HEATMAP_RADIUS_PX,
            "heatmap-opacity": 0.72,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(255,247,237,0)",
              0.15, "rgba(254,215,170,0.45)",
              0.4, "rgba(251,146,60,0.75)",
              0.7, "rgba(234,88,12,0.88)",
              1, "rgba(185,28,28,0.95)",
            ],
          },
        });

        // ── Supply clusters (driver origins) ────────────────────────────────
        map.addSource("supply", {
          type: "geojson",
          data: p.supplyGeoJson,
          cluster: true,
          clusterRadius: DISCOVER_MAP_CLUSTER_RADIUS_PX,
        });
        map.addLayer({
          id: "supply-circles",
          type: "circle",
          source: "supply",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": DISCOVER_MAP_SUPPLY_DOT_RADIUS,
            "circle-color": "#0B8457",
            "circle-opacity": 0.85,
          },
        });
        map.addLayer({
          id: "supply-clusters",
          type: "circle",
          source: "supply",
          filter: ["has", "point_count"],
          paint: {
            "circle-radius": DISCOVER_MAP_SUPPLY_CLUSTER_RADIUS,
            "circle-color": "#1A1A2E",
            "circle-opacity": 0.8,
          },
        });
        map.addLayer({
          id: "supply-count",
          type: "symbol",
          source: "supply",
          filter: ["has", "point_count"],
          layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
          paint: { "text-color": "#FFFFFF" },
        });

        // ── Route lines ──────────────────────────────────────────────────────
        map.addSource("routes", { type: "geojson", data: p.routeGeoJson });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": DISCOVER_PEER_RIDE_ROUTE,
            "line-width": DISCOVER_MAP_PEER_LINE_WIDTH,
            "line-opacity": 0.82,
          },
        });

        map.addSource("viewer-routes", { type: "geojson", data: p.viewerMyRoutesGeoJson });
        map.addSource("viewer-pins", { type: "geojson", data: p.viewerPinsGeoJson });
        map.addLayer({
          id: "viewer-my-routes-line",
          type: "line",
          source: "viewer-routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": [
              "match",
              ["get", "route_key"],
              "primary",
              DISCOVER_VIEWER_ROUTE_PRIMARY,
              "alt_0",
              DISCOVER_VIEWER_ROUTE_ALT0,
              "alt_1",
              DISCOVER_VIEWER_ROUTE_ALT1,
              "alt_2",
              DISCOVER_VIEWER_ROUTE_ALT2,
              DISCOVER_VIEWER_ROUTE_ALT_FALLBACK,
            ],
            "line-width": [
              "match",
              ["get", "route_key"],
              "primary",
              DISCOVER_MAP_VIEWER_PRIMARY_WIDTH,
              DISCOVER_MAP_VIEWER_ALT_WIDTH,
            ],
            "line-opacity": 0.92,
          },
        });
        map.addLayer({
          id: "viewer-my-routes-line-hit",
          type: "line",
          source: "viewer-routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#000000",
            "line-width": 22,
            "line-opacity": 0,
          },
        });
        map.addLayer({
          id: "viewer-home",
          type: "circle",
          source: "viewer-pins",
          filter: ["==", ["get", "kind"], "home"],
          paint: {
            "circle-radius": DISCOVER_MAP_PIN_HOME_RADIUS,
            "circle-color": "#EA580C",
            "circle-opacity": 0.95,
            "circle-stroke-width": DISCOVER_MAP_PIN_STROKE_WIDTH,
            "circle-stroke-color": "#FFFFFF",
          },
        });
        map.addLayer({
          id: "viewer-work",
          type: "circle",
          source: "viewer-pins",
          filter: ["==", ["get", "kind"], "work"],
          paint: {
            "circle-radius": DISCOVER_MAP_PIN_WORK_RADIUS,
            "circle-color": "#1D4ED8",
            "circle-opacity": 0.95,
            "circle-stroke-width": DISCOVER_MAP_PIN_STROKE_WIDTH,
            "circle-stroke-color": "#FFFFFF",
          },
        });
        map.addLayer({
          id: "viewer-home-label",
          type: "symbol",
          source: "viewer-pins",
          filter: ["==", ["get", "kind"], "home"],
          layout: {
            "text-field": "Home",
            "text-size": 11,
            "text-offset": [0, -1.8],
            "text-anchor": "bottom",
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#9A3412", "text-halo-color": "#FFFFFF", "text-halo-width": 1.5 },
        });
        map.addLayer({
          id: "viewer-work-label",
          type: "symbol",
          source: "viewer-pins",
          filter: ["==", ["get", "kind"], "work"],
          layout: {
            "text-field": "Work",
            "text-size": 11,
            "text-offset": [0, -1.8],
            "text-anchor": "bottom",
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#1E40AF", "text-halo-color": "#FFFFFF", "text-halo-width": 1.5 },
        });

        applyLayerEmphasis(map, p.layerEmphasis);
        bringViewerLayersToFront(map);

        const bounds = collectBounds([
          p.demandGeoJson,
          p.supplyGeoJson,
          p.routeGeoJson,
          p.viewerPinsGeoJson,
          p.viewerMyRoutesGeoJson,
        ]);
        if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 600 });
        else map.flyTo({ center: p.fallbackCenter, zoom: 11, duration: 0 });

        map.once("idle", () => {
          if (!mounted) return;
          bringViewerLayersToFront(map);
        });

        if (mounted) {
          setLoading(false);
          setMapReady(true);
        }
      });

      map.on("error", () => {
        if (mounted) { setLoading(false); }
      });
    }, 120);

    return () => {
      mounted = false;
      clearTimeout(timer);
      setMapReady(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Single map instance; initial `load` reads `latestRef` (not mount props). Updates: effect below.
  }, []);

  // Push latest GeoJSON after the map + sources exist (avoids stale mount closure / loading race).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.getSource?.("demand")) return;

    const p = latestRef.current;
    try {
      (map.getSource("demand") as any).setData(p.demandGeoJson);
      (map.getSource("supply") as any).setData(p.supplyGeoJson);
      (map.getSource("routes") as any).setData(p.routeGeoJson);
      const vRoutes = map.getSource("viewer-routes");
      const vPins = map.getSource("viewer-pins");
      if (vRoutes) (vRoutes as any).setData(p.viewerMyRoutesGeoJson);
      if (vPins) (vPins as any).setData(p.viewerPinsGeoJson);
      applyLayerEmphasis(map, p.layerEmphasis);
      bringViewerLayersToFront(map);

      const bounds = collectBounds([
        p.demandGeoJson,
        p.supplyGeoJson,
        p.routeGeoJson,
        p.viewerPinsGeoJson,
        p.viewerMyRoutesGeoJson,
      ]);
      if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 400 });
      else map.flyTo({ center: p.fallbackCenter, zoom: 11, duration: 400 });
    } catch {
      /* ignore transient MapLibre errors during style swap */
    }
  }, [
    mapReady,
    demandGeoJson,
    supplyGeoJson,
    routeGeoJson,
    viewerPinsGeoJson,
    viewerMyRoutesGeoJson,
    fallbackCenter,
    layerEmphasis,
  ]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map?.on) return;
    const layerId = "viewer-my-routes-line-hit";
    const handler = (e: { features?: GeoJSON.Feature[] }) => {
      const f = e.features?.[0];
      const key = (f?.properties as { route_key?: string } | undefined)?.route_key;
      if (key && key !== "primary") routeTapRef.current?.(key);
    };
    map.on("click", layerId, handler);
    return () => {
      try {
        map.off("click", layerId, handler);
      } catch {
        /* noop */
      }
    };
  }, [mapReady]);

  if (error) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderTitle}>{title}</Text>
        <Text style={styles.placeholderBody}>Map could not be loaded in this browser.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: mapHeight }]}>
      <View ref={containerRef} style={styles.map} />

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#0B8457" />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      )}
      {!loading && remoteLoading && (
        <View style={styles.updatingBar}>
          <ActivityIndicator size="small" color="#0B8457" />
          <Text style={styles.updatingBarText}>Updating layers…</Text>
        </View>
      )}

      {!loading && !compactMapChrome && !hasPeerData && !hasViewerPins && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>
            No commute pins yet. Add home and work under Profile → Commute, or switch to Any commuter. Orange heat
            = others’ demand; green = drivers; solid blue = others’ posted trips (not your alternates).
          </Text>
        </View>
      )}
      {!loading && !compactMapChrome && !hasPeerData && (hasViewerPins || hasViewerRoutes) && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>
            Your route: dark green = primary; teal / amber / purple = optional paths when Mapbox is on. Tap an
            alternate line to make it your main route. Work pin is blue. Solid blue lines = others’ posted trips.
            Heat = demand in this scope.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 180,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  map: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F4F0",
    gap: 8,
  },
  loadingText: { fontSize: 13, color: "#6B7280" },
  updatingBar: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  updatingBarText: { fontSize: 12, color: "#6B7280", fontWeight: "600" },
  emptyOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    padding: 10,
  },
  emptyText: { fontSize: 12, color: "#374151", textAlign: "center", lineHeight: 17 },
  placeholder: {
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  placeholderTitle: { fontSize: 16, fontWeight: "700", color: "#1A1A2E", marginBottom: 6 },
  placeholderBody: { fontSize: 13, color: "#6B7280", lineHeight: 18 },
});
