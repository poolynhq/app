import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

// Keep this interface in sync with MapPinPickerModal.web.tsx
// (both files define it locally to avoid cross-platform Metro bundling issues)
export interface MapPinPickerModalProps {
  visible: boolean;
  initialLat?: number;
  initialLng?: number;
  onConfirm: (lat: number, lng: number, address: string) => void;
  onClose: () => void;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`
    );
    const data = (await res.json()) as { features?: { place_name: string }[] };
    return data.features?.[0]?.place_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

// OpenFreeMap: free, no API key, native MapLibre GL JS support.
// Mapbox styles use a proprietary "name" property that MapLibre GL JS v4 rejects.
const FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

function buildMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #f0f0f0; }
    #map { position: absolute; inset: 0; }
    #hint {
      position: absolute; bottom: 20px; left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.68); color: #fff;
      padding: 9px 20px; border-radius: 24px;
      font-family: -apple-system, sans-serif; font-size: 14px;
      pointer-events: none; white-space: nowrap; z-index: 10;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="hint">Tap anywhere to place your pin</div>
  <script>
    var map = new maplibregl.Map({
      container: 'map',
      style: '${FREE_MAP_STYLE}',
      center: [${lng}, ${lat}],
      zoom: 13
    });
    var marker = null;
    map.on('click', function(e) {
      var lat = e.lngLat.lat;
      var lng = e.lngLat.lng;
      if (marker) marker.remove();
      marker = new maplibregl.Marker({ color: '#0B8457' })
        .setLngLat([lng, lat])
        .addTo(map);
      document.getElementById('hint').textContent = 'Pin placed. Tap Confirm';
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pin', lat: lat, lng: lng }));
    });
  </script>
</body>
</html>`;
}

export function MapPinPickerModal({
  visible,
  initialLat = -37.8136,
  initialLng = 144.9631,
  onConfirm,
  onClose,
}: MapPinPickerModalProps) {
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    if (!pendingPin) return;
    setConfirming(true);
    try {
      const address = await reverseGeocode(pendingPin.lat, pendingPin.lng);
      onConfirm(pendingPin.lat, pendingPin.lng, address);
      setPendingPin(null);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.wrapper}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Drop a pin</Text>
          <View style={{ width: 38 }} />
        </View>

        <WebView
          source={{ html: buildMapHtml(initialLat, initialLng) }}
          style={{ flex: 1 }}
          javaScriptEnabled
          originWhitelist={["*"]}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data) as { type: string; lat: number; lng: number };
              if (msg.type === "pin") setPendingPin({ lat: msg.lat, lng: msg.lng });
            } catch {
              // ignore malformed messages
            }
          }}
        />

        {pendingPin && (
          <Text style={styles.coordHint}>
            {pendingPin.lat.toFixed(5)}, {pendingPin.lng.toFixed(5)}
          </Text>
        )}

        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirmBtn, !pendingPin && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!pendingPin || confirming}
          >
            {confirming ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.confirmText}>Confirm pin</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A2E" },
  coordHint: {
    textAlign: "center",
    fontSize: 12,
    color: "#0B8457",
    paddingVertical: 6,
    fontFamily: "monospace",
    backgroundColor: "#F0FDF4",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  cancelBtn: {
    flex: 1,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  cancelText: { fontSize: 16, color: "#374151", fontWeight: "600" },
  confirmBtn: {
    flex: 2,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#0B8457",
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
