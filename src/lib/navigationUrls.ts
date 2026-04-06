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
