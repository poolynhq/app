import { Linking, Platform } from "react-native";

/** Opens turn-by-turn in Google Maps (Android) or Apple Maps (iOS). */
export function openDrivingDirectionsTo(lat: number, lng: number): void {
  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
      : `google.navigation:q=${lat},${lng}`;
  void Linking.openURL(url).catch(() => {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${lat},${lng}`
    );
  });
}
