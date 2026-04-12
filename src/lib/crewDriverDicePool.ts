/**
 * Crew driver dice: only members at the **ends** of the ordered commute corridor (not mid-route homes),
 * and within max distance of the segment (detour band). Matches “pickups along commute” ordering.
 */

import type { CrewMemberMapPin } from "@/lib/crewMessaging";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  distancePointToSegmentMeters,
  orderPickupsAlongCommute,
  resolveCommuteGeometry,
  type ResolvedCommuteLeg,
} from "@/lib/crewRouteOrdering";

/** ~15 km from home–work line; tune with corridor / detour product rules. */
export const CREW_DICE_MAX_CORRIDOR_DISTANCE_M = 15_000;

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
  /** Override corridor distance cap (metres). */
  maxCorridorDistanceM?: number;
}): { eligibleUserIds: string[]; reason: CrewDriverDiceEligibilityReason } {
  const home = parseGeoPoint(params.viewerHome as unknown);
  const work = parseGeoPoint(params.viewerWork as unknown);
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

  const ordered = orderPickupsAlongCommute(home, near, g.segmentStart, g.segmentEnd);

  const distinct: string[] = [];
  for (const p of ordered) {
    if (!distinct.includes(p.userId)) distinct.push(p.userId);
  }
  if (distinct.length < 2) {
    return { eligibleUserIds: [], reason: "no_two_endpoints" };
  }

  return {
    eligibleUserIds: [distinct[0], distinct[distinct.length - 1]],
    reason: "ok",
  };
}
