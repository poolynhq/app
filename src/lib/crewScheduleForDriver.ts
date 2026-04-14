/**
 * Build a pool commute schedule plan using the **designated driver's** home pin and commute duration,
 * with passenger pickups ordered for a **mid-corridor driver**: behind the driver along the segment first,
 * then ahead toward the destination (same as the crew card map and `orderPickupsForDriverPoolRoute`).
 *
 * When the driver changes, call this with the new driver's pin so pickup order and per-rider ready times
 * stay aligned with `computeCrewSchedulePlan` in `crewSchedulePlan.ts`.
 *
 * **Shared workplace:** We use the viewer's saved work coordinates as the crew workplace (everyone
 * commutes to the same site). The driver's evening leg starts from that point.
 */

import type { CrewMemberMapPin, CrewCommutePattern, CrewScheduleMode } from "@/lib/crewMessaging";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  orderPickupsForDriverPoolRoute,
  resolveCommuteGeometry,
  type ResolvedCommuteLeg,
} from "@/lib/crewRouteOrdering";
import { computeCrewSchedulePlan, type CrewSchedulePlanResult } from "@/lib/crewSchedulePlan";

export type CrewScheduleForDriverParams = {
  commutePattern: CrewCommutePattern;
  /** Corridor line uses the viewer's saved home and work (shared route / workplace). */
  viewerHome: unknown;
  viewerWork: unknown;
  driverUserId: string;
  /** Home pins for members in the crew (includes driver). */
  memberPins: CrewMemberMapPin[];
  /** Passengers to include in the pool leg (excluding the driver). */
  passengerUserIds: string[];
  mode: CrewScheduleMode;
  anchorMinutes: number;
  /** Driver's base corridor minutes (e.g. from their `commute_routes` row). */
  baseCorridorMinutes: number;
  /** Extra minutes per passenger pickup, keyed by user id (from detour preview). */
  extraMinByUserId: Record<string, number>;
};

function defaultExtra(extraMinByUserId: Record<string, number>, userId: string): number {
  const v = extraMinByUserId[userId];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 12;
}

/**
 * Returns null if viewer commute geometry cannot be resolved (no home/work) or the driver has no pin.
 */
export function computeCrewSchedulePlanForDriver(
  params: CrewScheduleForDriverParams
): CrewSchedulePlanResult | null {
  const home = parseGeoPoint(params.viewerHome as unknown);
  const work = parseGeoPoint(params.viewerWork as unknown);
  if (!home || !work) return null;

  const pattern = params.commutePattern;
  const activeLeg: ResolvedCommuteLeg = pattern === "to_home" ? "to_home" : "to_work";
  const geometry = resolveCommuteGeometry({
    pattern,
    activeLeg,
    home,
    work,
  });
  if (!geometry) return null;

  const pinByUser = new Map(params.memberPins.map((p) => [p.userId, p]));
  const driverPin = pinByUser.get(params.driverUserId);
  if (!driverPin) return null;

  const passengerPins: CrewMemberMapPin[] = [];
  for (const uid of params.passengerUserIds) {
    if (uid === params.driverUserId) continue;
    const p = pinByUser.get(uid);
    if (p) passengerPins.push(p);
  }

  const ordered = orderPickupsForDriverPoolRoute(
    driverPin,
    passengerPins,
    geometry.segmentStart,
    geometry.segmentEnd
  );

  const orderedPickups = ordered.map((pin) => ({
    pin,
    extraMin: defaultExtra(params.extraMinByUserId, pin.userId),
  }));

  return computeCrewSchedulePlan({
    mode: params.mode,
    anchorMinutes: params.anchorMinutes,
    baseCorridorMinutes: Math.max(1, params.baseCorridorMinutes),
    orderedPickups,
  });
}
