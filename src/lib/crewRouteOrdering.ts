import type { CrewMemberMapPin } from "@/lib/crewMessaging";
import {
  distanceMeters,
  projectionT,
  distancePointToSegmentMeters,
} from "@/lib/geoSegmentDistance";

export { distanceMeters, projectionT, distancePointToSegmentMeters } from "@/lib/geoSegmentDistance";

const T_EPS = 1e-7;

/** Wider than float noise so riders near the driver on the corridor axis are not dropped from visit order. */
const T_DRIVER_BAND = 1e-4;

/**
 * Order pickups along the commute axis (home→work or work→home), breaking ties by nearness to GPS origin.
 * Reduces “hook” detours compared to pure greedy nearest-neighbor.
 */
export function orderPickupsAlongCommute(
  origin: { lat: number; lng: number },
  pins: CrewMemberMapPin[],
  segmentStart: { lat: number; lng: number },
  segmentEnd: { lat: number; lng: number }
): CrewMemberMapPin[] {
  if (pins.length <= 1) return [...pins];
  const scored = pins.map((pin) => {
    const t = projectionT(segmentStart, segmentEnd, { lat: pin.lat, lng: pin.lng });
    const d0 = distanceMeters(origin, { lat: pin.lat, lng: pin.lng });
    return { pin, t, d0 };
  });
  scored.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    return a.d0 - b.d0;
  });
  return scored.map((s) => s.pin);
}

/**
 * Driving visit order when the driver may start **mid-corridor**: pick up everyone **behind** the driver
 * along the commute segment (lower projection `t`) in order from the far end of that side toward the driver,
 * then everyone **ahead** of the driver (higher `t`) toward the shared destination.
 * Matches “go to the far pickup on that side first, then work toward destination.”
 */
export function orderPickupsForDriverPoolRoute(
  driverPin: CrewMemberMapPin,
  passengerPins: CrewMemberMapPin[],
  segmentStart: { lat: number; lng: number },
  segmentEnd: { lat: number; lng: number }
): CrewMemberMapPin[] {
  if (passengerPins.length === 0) return [];
  const tDriver = projectionT(segmentStart, segmentEnd, { lat: driverPin.lat, lng: driverPin.lng });
  const scored = passengerPins.map((pin) => ({
    pin,
    t: projectionT(segmentStart, segmentEnd, { lat: pin.lat, lng: pin.lng }),
  }));
  const behind = scored.filter((s) => s.t < tDriver - T_DRIVER_BAND).sort((a, b) => a.t - b.t);
  /** Same corridor position as the driver (was dropped entirely before). */
  const coincident = scored
    .filter((s) => Math.abs(s.t - tDriver) <= T_DRIVER_BAND)
    .sort((a, b) => a.pin.userId.localeCompare(b.pin.userId));
  const ahead = scored.filter((s) => s.t > tDriver + T_DRIVER_BAND).sort((a, b) => a.t - b.t);
  return [...behind.map((s) => s.pin), ...coincident.map((s) => s.pin), ...ahead.map((s) => s.pin)];
}

/** Nearest-neighbor from origin (legacy fallback when commute segment unknown). */
export function orderPickupsGreedy(
  origin: { lat: number; lng: number },
  pins: CrewMemberMapPin[]
): CrewMemberMapPin[] {
  const remaining = [...pins];
  const ordered: CrewMemberMapPin[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = distanceMeters(current, { lat: remaining[0].lat, lng: remaining[0].lng });
    for (let i = 1; i < remaining.length; i++) {
      const d = distanceMeters(current, { lat: remaining[i].lat, lng: remaining[i].lng });
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }
  return ordered;
}

export type ResolvedCommuteLeg = "to_work" | "to_home";

/** Pick segment for ordering + final destination from crew pattern and active leg. */
export function resolveCommuteGeometry(params: {
  pattern: "to_work" | "to_home" | "round_trip";
  activeLeg: ResolvedCommuteLeg;
  home: { lat: number; lng: number } | null;
  work: { lat: number; lng: number } | null;
}): {
  leg: ResolvedCommuteLeg;
  segmentStart: { lat: number; lng: number };
  segmentEnd: { lat: number; lng: number };
  finalDestination: { lat: number; lng: number } | null;
} | null {
  const { pattern, activeLeg, home, work } = params;
  if (!home || !work) return null;

  if (pattern === "to_work") {
    return {
      leg: "to_work",
      segmentStart: home,
      segmentEnd: work,
      finalDestination: work,
    };
  }
  if (pattern === "to_home") {
    return {
      leg: "to_home",
      segmentStart: work,
      segmentEnd: home,
      finalDestination: home,
    };
  }
  // round_trip: leg chosen at trip start
  if (activeLeg === "to_work") {
    return {
      leg: "to_work",
      segmentStart: home,
      segmentEnd: work,
      finalDestination: work,
    };
  }
  return {
    leg: "to_home",
    segmentStart: work,
    segmentEnd: home,
    finalDestination: home,
  };
}

/** Expected start of trip for validation: beginning of commute segment for this leg. */
export function expectedTripStartAnchor(params: {
  pattern: "to_work" | "to_home" | "round_trip";
  activeLeg: ResolvedCommuteLeg;
  home: { lat: number; lng: number } | null;
  work: { lat: number; lng: number } | null;
}): { lat: number; lng: number } | null {
  const g = resolveCommuteGeometry({ ...params });
  return g?.segmentStart ?? null;
}
