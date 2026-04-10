import { useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  commuteRouteBoundingBox,
  type RouteInfo,
} from "@/lib/mapboxCommutePreview";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type Props = {
  home: { lat: number; lng: number };
  work: { lat: number; lng: number };
  routeInfo: RouteInfo | null;
  /** Highlighted route index (0 = primary). */
  highlightIndex: number;
  height: number;
};

function buildHtml(
  home: { lat: number; lng: number },
  work: { lat: number; lng: number },
  routeInfo: RouteInfo | null,
  highlightIndex: number
): string {
  const routes = routeInfo
    ? [routeInfo.primary, ...routeInfo.alternates].filter((r) => r.coords?.length >= 2)
    : [];
  const hi =
    routes.length > 0 ? Math.min(Math.max(0, highlightIndex), routes.length - 1) : 0;
  const bounds = commuteRouteBoundingBox(home, work, routeInfo);
  const payload = {
    token: MAPBOX_TOKEN,
    bounds,
    home: [home.lng, home.lat] as [number, number],
    work: [work.lng, work.lat] as [number, number],
    routes: routes.map((r) => r.coords),
    highlightIndex: hi,
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.js"></script>
<style>
  * { box-sizing: border-box; }
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  (function () {
    var P = ${JSON.stringify(payload)};
    mapboxgl.accessToken = P.token;
    var map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [(P.bounds[0] + P.bounds[2]) / 2, (P.bounds[1] + P.bounds[3]) / 2],
      zoom: 12,
      attributionControl: true
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', function () {
      map.fitBounds(
        [[P.bounds[0], P.bounds[1]], [P.bounds[2], P.bounds[3]]],
        { padding: 36, maxZoom: 14, duration: 0 }
      );

      var order = [];
      for (var i = 0; i < P.routes.length; i++) {
        if (i !== P.highlightIndex) order.push(i);
      }
      if (P.routes[P.highlightIndex]) order.push(P.highlightIndex);

      order.forEach(function (idx) {
        var coords = P.routes[idx];
        if (!coords || coords.length < 2) return;
        var isHi = idx === P.highlightIndex;
        map.addSource('r' + idx, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords }
          }
        });
        map.addLayer({
          id: 'l' + idx,
          type: 'line',
          source: 'r' + idx,
          paint: {
            'line-color': isHi ? '#0B8457' : '#3B82F6',
            'line-width': isHi ? 5 : 3,
            'line-opacity': isHi ? 0.92 : 0.48
          }
        });
      });

      new mapboxgl.Marker({ color: '#0B8457' }).setLngLat(P.home).addTo(map);
      new mapboxgl.Marker({ color: '#E74C3C' }).setLngLat(P.work).addTo(map);
    });
  })();
</script>
</body>
</html>`;
}

/**
 * Pan/zoom Mapbox GL map for commute preview (native clients). Web falls back to static image in the parent.
 */
export function CommuteRouteInteractiveMap({
  home,
  work,
  routeInfo,
  highlightIndex,
  height,
}: Props) {
  const html = useMemo(
    () => buildHtml(home, work, routeInfo, highlightIndex),
    [home.lat, home.lng, work.lat, work.lng, routeInfo, highlightIndex]
  );

  if (!MAPBOX_TOKEN || Platform.OS === "web") return null;

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        source={{ html }}
        style={styles.web}
        scrollEnabled={false}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#E5E7EB",
  },
  web: { flex: 1, backgroundColor: "transparent" },
});
