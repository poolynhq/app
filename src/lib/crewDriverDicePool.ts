/**
 * Crew driver dice: only members at the **ends** of the ordered commute corridor (not mid-route homes),
 * and within max distance of the segment (detour band). Matches “pickups along commute” ordering.
 */

import type { CrewMemberMapPin } from "@/lib/crewMessaging";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  distanceMeters,
  distancePointToSegmentMeters,
  projectionT,
  resolveCommuteGeometry,
  type ResolvedCommuteLeg,
} from "@/lib/crewRouteOrdering";

/** ~15 km from home–work line; tune with corridor / detour product rules. */
export const CREW_DICE_MAX_CORRIDOR_DISTANCE_M = 15_000;

/**
 * One pin per user. If a user has multiple pins near the corridor, keep the one with smallest
 * projection `t` (leading along segment start → end).
 */
function dedupeOnePinPerUserMinT(
  pins: CrewMemberMapPin[],
  segmentStart: { lat: number; lng: number },
  segmentEnd: { lat: number; lng: number }
): CrewMemberMapPin[] {
  const byUser = new Map<string, CrewMemberMapPin[]>();
  for (const p of pins) {
    const arr = byUser.get(p.userId) ?? [];
    arr.push(p);
    byUser.set(p.userId, arr);
  }
  const out: CrewMemberMapPin[] = [];
  for (const arr of byUser.values()) {
    if (arr.length === 1) {
      out.push(arr[0]!);
      continue;
    }
    arr.sort(
      (a, b) =>
        projectionT(segmentStart, segmentEnd, { lat: a.lat, lng: a.lng }) -
        projectionT(segmentStart, segmentEnd, { lat: b.lat, lng: b.lng })
    );
    out.push(arr[0]!);
  }
  return out;
}

/** Order by commute-axis projection only (no viewer-home tie-break). Stable tie: userId. */
function sortPinsByCorridorTOnly(
  pins: CrewMemberMapPin[],
  segmentStart: { lat: number; lng: number },
  segmentEnd: { lat: number; lng: number }
): CrewMemberMapPin[] {
  if (pins.length <= 1) return [...pins];
  const scored = pins.map((pin) => ({
    pin,
    t: projectionT(segmentStart, segmentEnd, { lat: pin.lat, lng: pin.lng }),
  }));
  scored.sort((a, b) => {
    if (Math.abs(a.t - b.t) > 1e-8) return a.t - b.t;
    return a.pin.userId.localeCompare(b.pin.userId);
  });
  return scored.map((s) => s.pin);
}

export type CrewDriverDiceEligibilityReason =
  | "ok"
  | "no_geometry"
  | "too_few_pins"
  | "too_few_near_corridor"
  | "no_two_endpoints";

export function computeCrewDriverDiceEligibility(params: {
  memberPins: CrewMemberMapPin[];
  commutePattern: "to_work" | "to_home" | "round_trip";
  /** For round_trip; defaults to toward-work leg. */
  activeLeg?: ResolvedCommuteLeg;
  viewerHome: unknown;
  viewerWork: unknown;
  /** When set, defines the commute segment (same for every viewer). Defaults to viewer home/work. */
  corridorAnchorHome?: unknown;
  corridorAnchorWork?: unknown;
  /** Override corridor distance cap (metres). */
  maxCorridorDistanceM?: number;
}): { eligibleUserIds: string[]; reason: CrewDriverDiceEligibilityReason } {
  const home = parseGeoPoint(
    (params.corridorAnchorHome ?? params.viewerHome) as unknown
  );
  const work = parseGeoPoint(
    (params.corridorAnchorWork ?? params.viewerWork) as unknown
  );
  if (!home || !work) {
    return { eligibleUserIds: [], reason: "no_geometry" };
  }

  const pattern = params.commutePattern;
  const activeLeg: ResolvedCommuteLeg =
    params.activeLeg ?? (pattern === "to_home" ? "to_home" : "to_work");

  const g = resolveCommuteGeometry({ pattern, activeLeg, home, work });
  if (!g) return { eligibleUserIds: [], reason: "no_geometry" };

  if (params.memberPins.length < 2) {
    return { eligibleUserIds: [], reason: "too_few_pins" };
  }

  const maxD = params.maxCorridorDistanceM ?? CREW_DICE_MAX_CORRIDOR_DISTANCE_M;
  const near = params.memberPins.filter(
    (p) =>
      distancePointToSegmentMeters({ lat: p.lat, lng: p.lng }, g.segmentStart, g.segmentEnd) <= maxD
  );
  if (near.length < 2) {
    return { eligibleUserIds: [], reason: "too_few_near_corridor" };
  }

  const nearDeduped = dedupeOnePinPerUserMinT(near, g.segmentStart, g.segmentEnd);
  const ordered = sortPinsByCorridorTOnly(nearDeduped, g.segmentStart, g.segmentEnd);
  const distinct = ordered.map((p) => p.userId);
  if (distinct.length < 2) {
    return { eligibleUserIds: [], reason: "no_two_endpoints" };
  }

  return {
    eligibleUserIds: [distinct[0]!, distinct[distinct.length - 1]!],
    reason: "ok",
  };
}

/** One crew member eligible for the spin wheel (corridor-ordered list). */
export type CrewWheelMember = {
  userId: string;
  displayName: string;
  /** True when not at either end of the ordered corridor (3+ people). */
  isMidRoute: boolean;
};

/**
 * Corridor-ordered pool for the spin wheel. By default the two **end** homes each get half the
 * wheel (selected); mid-route homes can be toggled on with a warning. List order: the two corridor
 * ends are adjacent at the top (farther from today's destination first), then mid-route members.
 */
export function computeCrewDriverWheelPool(params: {
  memberPins: CrewMemberMapPin[];
  commutePattern: "to_work" | "to_home" | "round_trip";
  activeLeg?: ResolvedCommuteLeg;
  viewerHome: unknown;
  viewerWork: unknown;
  /** When set, defines the commute segment (same for every viewer). Defaults to viewer home/work. */
  corridorAnchorHome?: unknown;
  corridorAnchorWork?: unknown;
  maxCorridorDistanceM?: number;
}): { reason: CrewDriverDiceEligibilityReason; members: CrewWheelMember[]; defaultSelectedIds: string[] } {
  const home = parseGeoPoint(
    (params.corridorAnchorHome ?? params.viewerHome) as unknown
  );
  const work = parseGeoPoint(
    (params.corridorAnchorWork ?? params.viewerWork) as unknown
  );
  if (!home || !work) {
    return { reason: "no_geometry", members: [], defaultSelectedIds: [] };
  }

  const pattern = params.commutePattern;
  const activeLeg: ResolvedCommuteLeg =
    params.activeLeg ?? (pattern === "to_home" ? "to_home" : "to_work");

  const g = resolveCommuteGeometry({ pattern, activeLeg, home, work });
  if (!g) return { reason: "no_geometry", members: [], defaultSelectedIds: [] };

  if (params.memberPins.length < 2) {
    return { reason: "too_few_pins", members: [], defaultSelectedIds: [] };
  }

  const maxD = params.maxCorridorDistanceM ?? CREW_DICE_MAX_CORRIDOR_DISTANCE_M;
  const near = params.memberPins.filter(
    (p) =>
      distancePointToSegmentMeters({ lat: p.lat, lng: p.lng }, g.segmentStart, g.segmentEnd) <= maxD
  );
  if (near.length < 2) {
    return { reason: "too_few_near_corridor", members: [], defaultSelectedIds: [] };
  }

  const nearDeduped = dedupeOnePinPerUserMinT(near, g.segmentStart, g.segmentEnd);
  const ordered = sortPinsByCorridorTOnly(nearDeduped, g.segmentStart, g.segmentEnd);
  const distinct = ordered.map((p) => p.userId);
  const nameBy = new Map<string, string>();
  for (const p of ordered) {
    nameBy.set(p.userId, (p.fullName || "Member").trim() || "Member");
  }
  if (distinct.length < 2) {
    return { reason: "no_two_endpoints", members: [], defaultSelectedIds: [] };
  }

  const n = distinct.length;
  const pinByUserId = new Map<string, CrewMemberMapPin>();
  for (const p of ordered) {
    pinByUserId.set(p.userId, p);
  }

  const dest = g.finalDestination;
  const membersByCorridor: CrewWheelMember[] = distinct.map((userId, idx) => ({
    userId,
    displayName: nameBy.get(userId) ?? "Member",
    isMidRoute: n > 2 && idx > 0 && idx < n - 1,
  }));

  const endA = distinct[0]!;
  const endB = distinct[n - 1]!;
  const mids = n > 2 ? distinct.slice(1, -1) : [];

  const distToDest = (userId: string) => {
    const p = pinByUserId.get(userId);
    if (!p || !dest) return 0;
    return distanceMeters({ lat: p.lat, lng: p.lng }, dest);
  };

  /** Corridor ends (default wheel pair) stay adjacent at the top: farther from destination first, then the other end. */
  const endsForList = [endA, endB].sort((a, b) => distToDest(b) - distToDest(a));
  /** Mid-route members below, farthest from destination first (among mids only). */
  const midsSorted = [...mids].sort((a, b) => distToDest(b) - distToDest(a));
  const displayIds = [...endsForList, ...midsSorted];

  const byUserId = new Map(membersByCorridor.map((m) => [m.userId, m]));
  const members = displayIds.map((id) => byUserId.get(id)!);

  const defaultSelectedIds = [endA, endB];

  return { reason: "ok", members, defaultSelectedIds };
}
