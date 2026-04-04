import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface DiscoverMapLayersProps {
  demandGeoJson: GeoJSON.FeatureCollection;
  supplyGeoJson: GeoJSON.FeatureCollection;
  routeGeoJson: GeoJSON.FeatureCollection;
  viewerGeoJson?: GeoJSON.FeatureCollection;
  title?: string;
  mapHeight?: number;
  /** [lng, lat] when there is no data to fit */
  fallbackCenter?: [number, number];
  remoteLoading?: boolean;
}

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
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

export function DiscoverMapLayers({
  demandGeoJson,
  supplyGeoJson,
  routeGeoJson,
  viewerGeoJson = EMPTY_FC,
  title = "Commute map",
  mapHeight = 240,
  fallbackCenter = DEFAULT_CENTER,
  remoteLoading = false,
}: DiscoverMapLayersProps) {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const hasPeerData =
    demandGeoJson.features.length > 0 ||
    supplyGeoJson.features.length > 0 ||
    routeGeoJson.features.length > 0;
  const hasViewerPins = viewerGeoJson.features.length > 0;

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

      const map = new ml.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: fallbackCenter,
        zoom: 11,
        attributionControl: false,
      });
      mapRef.current = map;

      map.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");

      map.on("load", () => {
        if (!mounted) return;

        // ── Demand heatmap (pickup origins) ─────────────────────────────────
        map.addSource("demand", { type: "geojson", data: demandGeoJson });
        map.addLayer({
          id: "demand-heat",
          type: "heatmap",
          source: "demand",
          paint: {
            "heatmap-intensity": 1,
            "heatmap-radius": 30,
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
          data: supplyGeoJson,
          cluster: true,
          clusterRadius: 40,
        });
        map.addLayer({
          id: "supply-circles",
          type: "circle",
          source: "supply",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-radius": 6, "circle-color": "#0B8457", "circle-opacity": 0.85 },
        });
        map.addLayer({
          id: "supply-clusters",
          type: "circle",
          source: "supply",
          filter: ["has", "point_count"],
          paint: { "circle-radius": 16, "circle-color": "#1A1A2E", "circle-opacity": 0.8 },
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
        map.addSource("routes", { type: "geojson", data: routeGeoJson });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "routes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#2563EB", "line-width": 4, "line-opacity": 0.82 },
        });

        map.addSource("viewer", { type: "geojson", data: viewerGeoJson });
        map.addLayer({
          id: "viewer-home",
          type: "circle",
          source: "viewer",
          filter: ["==", ["get", "kind"], "home"],
          paint: {
            "circle-radius": 11,
            "circle-color": "#EA580C",
            "circle-opacity": 0.95,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#FFFFFF",
          },
        });
        map.addLayer({
          id: "viewer-work",
          type: "circle",
          source: "viewer",
          filter: ["==", ["get", "kind"], "work"],
          paint: {
            "circle-radius": 10,
            "circle-color": "#1D4ED8",
            "circle-opacity": 0.95,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#FFFFFF",
          },
        });
        map.addLayer({
          id: "viewer-home-label",
          type: "symbol",
          source: "viewer",
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
          source: "viewer",
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

        const bounds = collectBounds([demandGeoJson, supplyGeoJson, routeGeoJson, viewerGeoJson]);
        if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 600 });
        else map.flyTo({ center: fallbackCenter, zoom: 11, duration: 0 });

        if (mounted) setLoading(false);
      });

      map.on("error", () => {
        if (mounted) { setLoading(false); }
      });
    }, 120);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Single map instance; GeoJSON updates in the following effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data sources reactively when props change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loading) return;

    const demandSrc = map.getSource("demand");
    if (demandSrc) demandSrc.setData(demandGeoJson);

    const supplySrc = map.getSource("supply");
    if (supplySrc) supplySrc.setData(supplyGeoJson);

    const routeSrc = map.getSource("routes");
    if (routeSrc) routeSrc.setData(routeGeoJson);

    const viewerSrc = map.getSource("viewer");
    if (viewerSrc) viewerSrc.setData(viewerGeoJson);

    const bounds = collectBounds([demandGeoJson, supplyGeoJson, routeGeoJson, viewerGeoJson]);
    if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 400 });
    else map.flyTo({ center: fallbackCenter, zoom: 11, duration: 400 });
  }, [demandGeoJson, supplyGeoJson, routeGeoJson, viewerGeoJson, loading, fallbackCenter]);

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

      {!loading && !hasPeerData && !hasViewerPins && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>
            No commute pins yet. Add home and work under Profile → Commute. Orange heat = others’
            demand; green = drivers; blue lines = posted ride routes.
          </Text>
        </View>
      )}
      {!loading && !hasPeerData && hasViewerPins && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyText}>
            Your home (orange) and work (blue) are shown. Heat fills in as others save commutes or
            post rides in this scope.
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
