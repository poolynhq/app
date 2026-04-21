/**
 * Web / Expo web: MapLibre in the DOM (same pattern as DiscoverMapLayers.web.tsx).
 * Native uses OrgAdminCorridorsMap.tsx with WebView.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { DISCOVER_MAP_STYLE_URL } from "@/constants/discoverMapStyle";
import { Colors, FontSize, Spacing } from "@/constants/theme";

const DEFAULT_CENTER: [number, number] = [138.6, -34.85];

const ML_CSS_ID = "maplibre-css-org-admin-corridors";
const ML_SCRIPT_SRC = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

function loadMapLibre(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as unknown as { maplibregl?: unknown };
    if (w.maplibregl) {
      resolve();
      return;
    }
    if (!document.getElementById(ML_CSS_ID)) {
      const link = document.createElement("link");
      link.id = ML_CSS_ID;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${ML_SCRIPT_SRC}"]`);
    if (existing) {
      const tick = () => {
        if (w.maplibregl) resolve();
      };
      existing.addEventListener("load", tick);
      tick();
      requestAnimationFrame(tick);
      return;
    }
    const script = document.createElement("script");
    script.src = ML_SCRIPT_SRC;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

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

function collectBounds(
  collections: GeoJSON.FeatureCollection[]
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
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

export type OrgAdminCorridorsMapProps = {
  homesGeoJson: GeoJSON.FeatureCollection;
  axisLinesGeoJson: GeoJSON.FeatureCollection;
  workCentroid: { lng: number; lat: number } | null;
  mapHeight?: number;
  fallbackCenter?: [number, number];
  emptyGeometryHint?: string;
};

type Bundle = {
  homes: GeoJSON.FeatureCollection;
  axes: GeoJSON.FeatureCollection;
  workPin: GeoJSON.FeatureCollection;
  fallbackCenter: [number, number];
};

export function OrgAdminCorridorsMap({
  homesGeoJson,
  axisLinesGeoJson,
  workCentroid,
  mapHeight = 240,
  fallbackCenter = DEFAULT_CENTER,
  emptyGeometryHint,
}: OrgAdminCorridorsMapProps) {
  /** MapLibre needs a real pixel height; flex:1 inside ScrollView on RN-web often resolves to 0. */
  const legendBlockPx = 48;
  const canvasHeight = Math.max(168, mapHeight - legendBlockPx);

  const workPin = useMemo(() => workPinFc(workCentroid), [workCentroid]);
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const latestRef = useRef<Bundle>({
    homes: homesGeoJson,
    axes: axisLinesGeoJson,
    workPin,
    fallbackCenter,
  });
  latestRef.current = { homes: homesGeoJson, axes: axisLinesGeoJson, workPin, fallbackCenter };

  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const hasData =
    (homesGeoJson.features?.length ?? 0) > 0 ||
    (axisLinesGeoJson.features?.length ?? 0) > 0 ||
    (workPin.features?.length ?? 0) > 0;

  useEffect(() => {
    if (!hasData) {
      setMapReady(false);
      setLoading(false);
      return;
    }

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

      const ml = (window as unknown as { maplibregl?: { Map: new (o: object) => unknown } }).maplibregl;
      if (!ml?.Map) {
        if (mounted) setError(true);
        return;
      }

      const L = latestRef.current;
      const map = new ml.Map({
        container: containerRef.current,
        style: DISCOVER_MAP_STYLE_URL,
        center: L.fallbackCenter,
        zoom: 10,
        attributionControl: false,
      });
      mapRef.current = map;

      const safeResize = () => {
        try {
          map.resize();
        } catch {
          /* noop */
        }
      };

      map.on("load", () => {
        if (!mounted) return;
        const p = latestRef.current;

        map.addSource("homes", { type: "geojson", data: p.homes });
        map.addLayer({
          id: "homes-heat",
          type: "heatmap",
          source: "homes",
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": 1,
            "heatmap-radius": 26,
            "heatmap-opacity": 0.78,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(236,253,245,0)",
              0.15,
              "rgba(167,243,208,0.45)",
              0.35,
              "rgba(52,211,153,0.72)",
              0.55,
              "rgba(16,185,129,0.85)",
              0.8,
              "rgba(5,150,105,0.92)",
              1,
              "rgba(6,95,70,0.95)",
            ],
          },
        });

        map.addSource("axes", { type: "geojson", data: p.axes });
        map.addLayer({
          id: "axes-line",
          type: "line",
          source: "axes",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#0B8457",
            "line-width": 4,
            "line-opacity": 0.88,
          },
        });

        map.addSource("work-pin", { type: "geojson", data: p.workPin });
        map.addLayer({
          id: "work-circle",
          type: "circle",
          source: "work-pin",
          filter: ["==", ["get", "kind"], "work"],
          paint: {
            "circle-radius": 8,
            "circle-color": "#1D4ED8",
            "circle-opacity": 0.95,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#FFFFFF",
          },
        });

        const bounds = collectBounds([p.homes, p.axes, p.workPin]);
        if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 500 });
        else map.flyTo({ center: p.fallbackCenter, zoom: 10, duration: 0 });

        requestAnimationFrame(() => {
          safeResize();
          requestAnimationFrame(safeResize);
        });

        if (mounted) {
          setLoading(false);
          setMapReady(true);
        }
      });

      map.on("error", () => {
        if (mounted) setLoading(false);
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
  }, [hasData]);

  useEffect(() => {
    if (!mapReady || !hasData) return;
    const map = mapRef.current;
    if (!map?.getSource?.("homes")) return;

    const p = latestRef.current;
    try {
      map.getSource("homes").setData(p.homes);
      map.getSource("axes").setData(p.axes);
      map.getSource("work-pin").setData(p.workPin);

      const bounds = collectBounds([p.homes, p.axes, p.workPin]);
      if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 400 });
      else map.flyTo({ center: p.fallbackCenter, zoom: 10, duration: 400 });
      requestAnimationFrame(() => {
        try {
          map.resize();
        } catch {
          /* noop */
        }
      });
    } catch {
      /* ignore */
    }
  }, [mapReady, hasData, homesGeoJson, axisLinesGeoJson, workPin, fallbackCenter]);

  useEffect(() => {
    if (!mapReady || typeof ResizeObserver === "undefined") return;
    const el = containerRef.current as HTMLElement | null;
    const map = mapRef.current;
    if (!el || !map?.resize) return;
    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* noop */
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady]);

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

  if (error) {
    return (
      <View style={[styles.placeholder, { minHeight: mapHeight }]}>
        <Text style={styles.placeholderText}>Map could not be loaded in this browser.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height: mapHeight }]}>
      <View
        ref={containerRef}
        style={[styles.mapCanvas, { height: canvasHeight, width: "100%" }]}
      />
      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : null}
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
    borderWidth: 1,
    borderColor: "#E5E7EB",
    position: "relative",
  },
  mapCanvas: {
    backgroundColor: "#e8eef3",
    alignSelf: "stretch",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(232,238,243,0.85)",
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
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  placeholderText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
  },
});
