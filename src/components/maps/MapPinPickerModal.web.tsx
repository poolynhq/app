import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DISCOVER_MAP_STYLE_URL } from "@/constants/discoverMapStyle";

// Props defined locally — do NOT import from the native file.
// Metro's dependency resolver runs before TypeScript stripping, so even
// `import type` would pull the WebView-dependent native file into the web bundle.
export interface MapPinPickerModalProps {
  visible: boolean;
  initialLat?: number;
  initialLng?: number;
  onConfirm: (lat: number, lng: number, address: string) => void;
  onClose: () => void;
}

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    // v6 reverse geocoding resolves business/industrial premises to their POI name
    // (e.g. dropping a pin on a warehouse returns "Lineage, Tugger Way, Edinburgh…")
    // v6 reverse: "poi" is not a valid type (422). With limit=1, docs require a single `types` value.
    const res = await fetch(
      `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${MAPBOX_TOKEN}&types=address&limit=1`
    );
    const data = (await res.json()) as {
      features?: { properties: { full_address?: string } }[];
    };
    const address = data.features?.[0]?.properties?.full_address;
    if (address) return address;
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

let mlLoaded = false;

function loadMapLibre(): Promise<void> {
  if (mlLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    if (!document.getElementById("maplibre-css")) {
      const link = document.createElement("link");
      link.id = "maplibre-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
    script.onload = () => {
      mlLoaded = true;
      resolve();
    };
    document.head.appendChild(script);
  });
}

export function MapPinPickerModal({
  visible,
  initialLat = -37.8136,
  initialLng = 144.9631,
  onConfirm,
  onClose,
}: MapPinPickerModalProps) {
  // useRef<any> because React Native Web View IS an HTMLDivElement at runtime
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!visible) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
      setPendingPin(null);
      return;
    }

    const timer = setTimeout(async () => {
      if (!containerRef.current) return;
      await loadMapLibre();
      const ml = (window as any).maplibregl as any;
      if (!ml || mapRef.current) return;

      const map = new ml.Map({
        container: containerRef.current,
        style: DISCOVER_MAP_STYLE_URL,
        center: [initialLng, initialLat],
        zoom: 13,
      });
      mapRef.current = map;

      map.on("click", (e: any) => {
        const { lng, lat } = e.lngLat as { lng: number; lat: number };
        if (markerRef.current) markerRef.current.remove();
        markerRef.current = new ml.Marker({ color: "#0B8457" })
          .setLngLat([lng, lat])
          .addTo(map);
        setPendingPin({ lat, lng });
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [visible, initialLat, initialLng]);

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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrapper}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Drop a pin</Text>
          <View style={{ width: 38 }} />
        </View>

        {/* React Native Web renders View as a <div> — MapLibre attaches to the DOM node */}
        <View ref={containerRef} style={styles.mapContainer} />

        <Text style={pendingPin ? styles.coordHint : styles.tapHint}>
          {pendingPin
            ? `${pendingPin.lat.toFixed(5)}, ${pendingPin.lng.toFixed(5)}`
            : "Click anywhere on the map to place your pin"}
        </Text>

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
      </View>
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
    paddingTop: 52,
    paddingBottom: 12,
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
  mapContainer: { flex: 1 },
  tapHint: {
    textAlign: "center",
    fontSize: 13,
    color: "#6B7280",
    paddingVertical: 10,
    backgroundColor: "#F9FAFB",
  },
  coordHint: {
    textAlign: "center",
    fontSize: 12,
    color: "#0B8457",
    paddingVertical: 10,
    fontFamily: "monospace",
    backgroundColor: "#F0FDF4",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    paddingBottom: 28,
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
