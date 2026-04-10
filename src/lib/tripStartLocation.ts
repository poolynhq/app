import * as Location from "expo-location";

/**
 * Best-effort fix for trip start: navigation accuracy + short refinement window
 * so Google Maps receives a stable origin= and the device has a fresh GPS lock.
 */
export async function acquireTripStartCoordinates(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== Location.PermissionStatus.GRANTED) return null;

  const readings: { lat: number; lng: number; acc: number }[] = [];
  const take = (c: Location.LocationObjectCoords) => {
    readings.push({
      lat: c.latitude,
      lng: c.longitude,
      acc: c.accuracy ?? 9999,
    });
  };

  try {
    const a = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
    take(a.coords);
  } catch {
    try {
      const b = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      take(b.coords);
    } catch {
      return null;
    }
  }

  try {
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 400,
        distanceInterval: 0,
      },
      (loc) => take(loc.coords)
    );
    await new Promise((r) => setTimeout(r, 2200));
    sub.remove();
  } catch {
    /* keep first fix */
  }

  if (readings.length === 0) return null;
  readings.sort((x, y) => x.acc - y.acc);
  const top = readings[0];
  return { lat: top.lat, lng: top.lng };
}
