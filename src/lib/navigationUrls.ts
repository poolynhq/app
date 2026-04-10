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

/** Google Maps dir URLs: keep waypoints conservative for mobile app compatibility. */
const GOOGLE_WEB_MAX_PICKUP_WAYPOINTS = 8;

export type GoogleCrewRouteParams = {
  /** When set, passed as origin= so Maps anchors the route to a fresh GPS fix. */
  origin: { lat: number; lng: number } | null;
  pickupsInVisitOrder: { lat: number; lng: number }[];
  /** Last stop of the trip (e.g. work on morning run, home on return). */
  finalDestination: { lat: number; lng: number } | null;
};

function appendOrigin(qs: string, origin: { lat: number; lng: number } | null): string {
  if (!origin) return qs;
  return `${qs}&origin=${origin.lat},${origin.lng}`;
}

/**
 * Builds a universal Google Maps directions URL (works in browser and opens the Maps app on iOS/Android).
 */
export function buildGoogleMapsCrewDirectionsUrl(
  params: GoogleCrewRouteParams
): { url: string; truncated: boolean; usedCount: number; totalCount: number } {
  const { origin, pickupsInVisitOrder, finalDestination } = params;
  const total = pickupsInVisitOrder.length;

  if (total === 0) {
    if (finalDestination) {
      let qs = `api=1&travelmode=driving&destination=${finalDestination.lat},${finalDestination.lng}`;
      qs = appendOrigin(qs, origin);
      return {
        url: `https://www.google.com/maps/dir/?${qs}`,
        truncated: false,
        usedCount: 0,
        totalCount: 0,
      };
    }
    return { url: "", truncated: false, usedCount: 0, totalCount: 0 };
  }

  const capped =
    total > GOOGLE_WEB_MAX_PICKUP_WAYPOINTS
      ? pickupsInVisitOrder.slice(0, GOOGLE_WEB_MAX_PICKUP_WAYPOINTS)
      : pickupsInVisitOrder;
  const truncated = capped.length < total;

  if (!finalDestination) {
    if (capped.length === 1) {
      let qs = `api=1&travelmode=driving&destination=${capped[0].lat},${capped[0].lng}`;
      qs = appendOrigin(qs, origin);
      return {
        url: `https://www.google.com/maps/dir/?${qs}`,
        truncated,
        usedCount: capped.length,
        totalCount: total,
      };
    }
    const dest = capped[capped.length - 1];
    const mid = capped.slice(0, -1);
    const wps = mid.map((p) => `${p.lat},${p.lng}`).join("|");
    let qs = `api=1&travelmode=driving&waypoints=${encodeURIComponent(wps)}&destination=${dest.lat},${dest.lng}`;
    qs = appendOrigin(qs, origin);
    return {
      url: `https://www.google.com/maps/dir/?${qs}`,
      truncated,
      usedCount: capped.length,
      totalCount: total,
    };
  }

  if (capped.length === 1) {
    const w = `${capped[0].lat},${capped[0].lng}`;
    const d = `${finalDestination.lat},${finalDestination.lng}`;
    let qs = `api=1&travelmode=driving&waypoints=${encodeURIComponent(w)}&destination=${encodeURIComponent(d)}`;
    qs = appendOrigin(qs, origin);
    return {
      url: `https://www.google.com/maps/dir/?${qs}`,
      truncated,
      usedCount: capped.length,
      totalCount: total,
    };
  }

  const wps = capped.map((p) => `${p.lat},${p.lng}`).join("|");
  let qs = `api=1&travelmode=driving&waypoints=${encodeURIComponent(wps)}&destination=${finalDestination.lat},${finalDestination.lng}`;
  qs = appendOrigin(qs, origin);
  return {
    url: `https://www.google.com/maps/dir/?${qs}`,
    truncated,
    usedCount: capped.length,
    totalCount: total,
  };
}

/** Opens Google Maps (app or browser) with full crew route; prefer over google.navigation: for multi-stop. */
export function openGoogleCrewDrivingRoute(params: GoogleCrewRouteParams): {
  truncated: boolean;
  usedCount: number;
  totalCount: number;
} {
  const { url, truncated, usedCount, totalCount } = buildGoogleMapsCrewDirectionsUrl(params);
  if (url) void Linking.openURL(url);
  return { truncated, usedCount, totalCount };
}

/**
 * Web/PWA: driving directions with several pickup stops (waypoints), then optional work as final destination.
 * Prefer {@link openGoogleCrewDrivingRoute} with origin + finalDestination for parity with native.
 */
export function openGoogleWebCrewPickupRoute(
  pickupsInVisitOrder: { lat: number; lng: number }[],
  work: { lat: number; lng: number } | null
): { truncated: boolean; usedCount: number; totalCount: number } {
  return openGoogleCrewDrivingRoute({
    origin: null,
    pickupsInVisitOrder,
    finalDestination: work,
  });
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
