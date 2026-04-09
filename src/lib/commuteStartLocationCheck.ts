import * as Location from "expo-location";
import { haversineMeters } from "@/lib/geoDistance";
import { parseGeoPoint } from "@/lib/parseGeoPoint";

export type CommuteStartAnchor = "home" | "work";

/** Morning window: assume trip start is home (to work). Otherwise work (return / from-work leg). */
export function inferCommuteStartAnchorFromHour(hour: number): CommuteStartAnchor {
  return hour >= 5 && hour < 15 ? "home" : "work";
}

const WARN_METERS = 100;
const MAX_ACCEPT_DIFF_METERS = 500;

export type CommuteStartLocationResult =
  | { kind: "ok" }
  | { kind: "skip_no_anchor" }
  | { kind: "skip_web" }
  | { kind: "permission_denied" }
  | { kind: "position_unavailable" }
  | {
      kind: "away_from_start";
      meters: number;
      anchor: CommuteStartAnchor;
      /** User may acknowledge if within 500 m of saved start. */
      canAcceptDifference: boolean;
    };

/**
 * Lone Poolyn: compare device position to the saved commute start (home vs work by time of day).
 */
export async function evaluateCommuteStartLocation(profile: {
  home_location: unknown;
  work_location: unknown;
}): Promise<CommuteStartLocationResult> {
  const h = new Date().getHours();
  const anchor = inferCommuteStartAnchorFromHour(h);
  const geo =
    anchor === "home"
      ? parseGeoPoint(profile.home_location as unknown)
      : parseGeoPoint(profile.work_location as unknown);
  if (!geo) return { kind: "skip_no_anchor" };

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { kind: "permission_denied" };

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  }).catch(() => null);
  if (!pos) return { kind: "position_unavailable" };

  const meters = haversineMeters(
    { lat: pos.coords.latitude, lng: pos.coords.longitude },
    { lat: geo.lat, lng: geo.lng }
  );

  if (meters <= WARN_METERS) return { kind: "ok" };

  return {
    kind: "away_from_start",
    meters: Math.round(meters),
    anchor,
    canAcceptDifference: meters <= MAX_ACCEPT_DIFF_METERS,
  };
}
