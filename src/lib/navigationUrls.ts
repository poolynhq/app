import { Linking, Platform } from "react-native";
import { showAlert } from "@/lib/platformAlert";

function openAppleMaps(lat: number, lng: number) {
  void Linking.openURL(`http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`);
}

function openGoogleWeb(lat: number, lng: number) {
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat},${lng}`
  );
}

/** Web/PWA: one intermediate stop, then destination (e.g. one pickup then work). */
export function openGoogleWebDirectionsViaWaypoint(
  waypoint: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): void {
  const w = `${waypoint.lat},${waypoint.lng}`;
  const d = `${destination.lat},${destination.lng}`;
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&travelmode=driving&waypoints=${encodeURIComponent(w)}&destination=${encodeURIComponent(d)}`
  );
}

/** Google Maps web URLs support a limited number of intermediate stops. */
const GOOGLE_WEB_MAX_PICKUP_WAYPOINTS = 8;

/**
 * Web/PWA: driving directions with several pickup stops (waypoints), then optional work as final destination.
 * Origin is the user’s current location in Google Maps when they omit it (typical mobile behavior).
 */
export function openGoogleWebCrewPickupRoute(
  pickupsInVisitOrder: { lat: number; lng: number }[],
  work: { lat: number; lng: number } | null
): { truncated: boolean; usedCount: number; totalCount: number } {
  const total = pickupsInVisitOrder.length;
  if (total === 0) return { truncated: false, usedCount: 0, totalCount: 0 };

  const capped =
    total > GOOGLE_WEB_MAX_PICKUP_WAYPOINTS
      ? pickupsInVisitOrder.slice(0, GOOGLE_WEB_MAX_PICKUP_WAYPOINTS)
      : pickupsInVisitOrder;
  const truncated = capped.length < total;

  if (!work) {
    if (capped.length === 1) {
      openGoogleWeb(capped[0].lat, capped[0].lng);
      return { truncated, usedCount: capped.length, totalCount: total };
    }
    const dest = capped[capped.length - 1];
    const mid = capped.slice(0, -1);
    const wps = mid.map((p) => `${p.lat},${p.lng}`).join("|");
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&travelmode=driving&waypoints=${encodeURIComponent(wps)}&destination=${dest.lat},${dest.lng}`
    );
    return { truncated, usedCount: capped.length, totalCount: total };
  }

  if (capped.length === 1) {
    openGoogleWebDirectionsViaWaypoint(capped[0], work);
    return { truncated, usedCount: capped.length, totalCount: total };
  }

  const wps = capped.map((p) => `${p.lat},${p.lng}`).join("|");
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&travelmode=driving&waypoints=${encodeURIComponent(wps)}&destination=${work.lat},${work.lng}`
  );
  return { truncated, usedCount: capped.length, totalCount: total };
}

function openWaze(lat: number, lng: number) {
  void Linking.openURL(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`);
}

/** Prefer native Google navigation on Android; iOS uses Google Maps URL scheme with http fallback. */
function openGoogleMapsApp(lat: number, lng: number) {
  if (Platform.OS === "android") {
    void Linking.openURL(`google.navigation:q=${lat},${lng}`).catch(() => openGoogleWeb(lat, lng));
    return;
  }
  const scheme = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
  void Linking.canOpenURL(scheme).then((ok) => {
    if (ok) void Linking.openURL(scheme);
    else openGoogleWeb(lat, lng);
  });
}

/**
 * Opens driving turn-by-turn in Google Maps (Android) or Apple Maps (iOS).
 * Prefer {@link presentDrivingNavigationPicker} when the user should choose the app.
 */
export function openDrivingDirectionsTo(lat: number, lng: number): void {
  if (Platform.OS === "web") {
    openGoogleWeb(lat, lng);
    return;
  }
  if (Platform.OS === "ios") {
    openAppleMaps(lat, lng);
    return;
  }
  openGoogleMapsApp(lat, lng);
}

/**
 * Lets the commuter pick Apple Maps, Google Maps, or Waze (web falls back to Google in the browser).
 */
export function presentDrivingNavigationPicker(lat: number, lng: number): void {
  if (Platform.OS === "web") {
    openGoogleWeb(lat, lng);
    return;
  }

  if (Platform.OS === "ios") {
    showAlert("Turn-by-turn navigation", "Choose a maps app.", [
      { text: "Apple Maps", onPress: () => openAppleMaps(lat, lng) },
      { text: "Google Maps", onPress: () => openGoogleMapsApp(lat, lng) },
      { text: "Waze", onPress: () => openWaze(lat, lng) },
      { text: "Cancel", style: "cancel" },
    ]);
    return;
  }

  showAlert("Turn-by-turn navigation", "Choose a maps app.", [
    { text: "Google Maps", onPress: () => openGoogleMapsApp(lat, lng) },
    { text: "Waze", onPress: () => openWaze(lat, lng) },
    { text: "Browser", onPress: () => openGoogleWeb(lat, lng) },
    { text: "Cancel", style: "cancel" },
  ]);
}
