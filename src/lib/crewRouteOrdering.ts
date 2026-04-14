import type { CrewMemberMapPin } from "@/lib/crewMessaging";

const T_EPS = 1e-7;

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** 0–1 position of P projected onto segment A→B (clamped). */
export function projectionT(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  p: { lat: number; lng: number }
): number {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-18) return 0;
  const t = (apx * abx + apy * aby) / ab2;
  return Math.max(0, Math.min(1, t));
}

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
  const behind = scored.filter((s) => s.t < tDriver - T_EPS).sort((a, b) => a.t - b.t);
  const ahead = scored.filter((s) => s.t > tDriver + T_EPS).sort((a, b) => a.t - b.t);
  return [...behind.map((s) => s.pin), ...ahead.map((s) => s.pin)];
}

/** Shortest distance from P to segment A→B (geodesic via plane approximation on small segments). */
export function distancePointToSegmentMeters(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const t = projectionT(a, b, p);
  const ix = a.lng + t * (b.lng - a.lng);
  const iy = a.lat + t * (b.lat - a.lat);
  return distanceMeters(p, { lat: iy, lng: ix });
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
