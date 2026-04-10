/**
 * Geometry-first commute matching (Mapbox + PostGIS prefilter).
 * See docs/POOLYN_MATCHING_SPEC.md
 */

import * as turf from "@turf/turf";
import type { Feature, LineString } from "geojson";
import { supabase } from "@/lib/supabase";
import type { Schedule, User } from "@/types/database";
import { computePairCommuteScheduleOverlap } from "@/lib/commuteScheduleOverlap";
import {
  computePassengerCostBreakdown,
  type CostBreakdownCents,
} from "@/lib/costModel";
import { POOLYN_MINGLE_MIN_POOL_RIDERS, POOLYN_MAX_POOL_RIDERS_FOR_SPLIT } from "@/lib/poolynPricingConfig";
import { fairnessSeedUint32, fairnessUnit } from "@/lib/fairnessHash";
import { getBaselineCommute, type LngLat } from "@/lib/mapboxDirections";
import { computeDriverPassengerDetourMetrics } from "@/lib/detourRouteEngine";

export type RideCardIntent = "passenger" | "driver";

export interface RideOpportunityCard {
  opportunityId: string;
  /** Set for reservation RPC only — never show in UI */
  driverUserId: string;
  /** Opaque id for UI keys — not a DB id until reserved */
  driverRouteId: string;
  passengerRouteId: string;
  /** Hidden until confirm — use vehicle class only */
  overlapPercent: number;
  detourMinutes: number;
  detourDistanceM: number;
  pickupEtaLabel: string;
  arrivalEtaLabel: string;
  vehicleClassLabel: string;
  seatsAvailable: number;
  passengerCostCents: number;
  costBreakdown: CostBreakdownCents;
  /** Riders used to split detour + pooled corridor (includes this passenger when riding). */
  assumedPoolRiders: number;
  trustReliability: number;
  /** For driver viewer: passenger reliability */
  counterpartyReliability: number;
  routeOverlapScore: number;
  matchScore: number;
  /** Present when viewer is driver; same_org vs cross-network passenger */
  matchScope?: "same_org" | "outer_network";
  /** Paying passenger; `org_id` on profile — server uses subscription at commit. */
  passengerHasWorkplaceOrgOnProfile: boolean;
}

export interface PrefilterRow {
  driver_id: string;
  passenger_id: string;
  driver_route_id: string;
  passenger_route_id: string;
  overlap_ratio_initial: number;
  match_scope: string;
}

function parseLngLatFromUserPoint(geo: string | null): LngLat | null {
  if (!geo || typeof geo !== "string") return null;
  const wkt = /^POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(geo);
  if (wkt) return [parseFloat(wkt[1]), parseFloat(wkt[2])];
  try {
    const j = JSON.parse(geo) as { type?: string; coordinates?: [number, number] };
    if (j?.coordinates?.length === 2) return [j.coordinates[0], j.coordinates[1]];
  } catch {
    /* ignore */
  }
  return null;
}

function vehicleClassLabel(c: string): string {
  const m: Record<string, string> = {
    compact: "Compact",
    sedan: "Sedan",
    suv: "SUV",
    large_suv: "Large SUV",
    electric: "Electric",
  };
  return m[c] ?? "Sedan";
}

function canActAsPassenger(u: User): boolean {
  if (u.role === "passenger") return true;
  if (u.role !== "both") return false;
  return u.active_mode !== "driver";
}

function canActAsDriver(u: User): boolean {
  if (u.role === "driver") return true;
  if (u.role !== "both") return false;
  return u.active_mode !== "passenger";
}

async function fetchActiveSchedulesForUsers(
  userIds: string[]
): Promise<Map<string, Schedule | null>> {
  const map = new Map<string, Schedule | null>();
  if (userIds.length === 0) return map;
  for (const id of userIds) map.set(id, null);

  const { data } = await supabase
    .from("schedules")
    .select(
      "user_id, type, weekday_times, tolerance_mins, active, id, created_at, updated_at, shift_start, shift_end"
    )
    .in("user_id", userIds)
    .eq("active", true)
    .order("updated_at", { ascending: false });

  for (const row of data ?? []) {
    const uid = row.user_id as string;
    if (map.get(uid) !== null) continue;
    map.set(uid, row as Schedule);
  }
  return map;
}

/** Discover / UI: whether this profile can see driver-side commute opportunities */
export function canViewerActAsDriver(u: User): boolean {
  return canActAsDriver(u);
}

function formatEta(durationS: number): string {
  const m = Math.round(durationS / 60);
  if (m < 60) return `~${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `~${h}h ${mm}m`;
}

/**
 * Expand prefilter rows into scored ride cards (passenger intent: viewer looks for drivers).
 */
export async function getRideOpportunities(
  viewer: User,
  options: { intent: RideCardIntent; maxDetourMins?: number }
): Promise<RideOpportunityCard[]> {
  const { intent } = options;
  if (!viewer.org_id) return [];

  /** Cross-org passengers only when driver opted in on the server (RLS + prefilter stay aligned). */
  const rpcIncludePool =
    intent === "driver" && viewer.driver_show_outer_network_riders === true;

  const { data: raw, error } = await supabase.rpc("prefilter_commute_match_pairs", {
    p_viewer_id: viewer.id,
    p_include_local_pool: rpcIncludePool,
  });
  if (error || !Array.isArray(raw)) return [];

  const rows = raw as PrefilterRow[];
  const filtered = rows.filter((r) => {
    if (intent === "passenger") {
      return r.passenger_id === viewer.id && canActAsPassenger(viewer);
    }
    return r.driver_id === viewer.id && canActAsDriver(viewer);
  });

  const driverIds = [...new Set(filtered.map((r) => r.driver_id))];
  let maxDetourByDriver = new Map<string, number>();
  if (driverIds.length > 0) {
    const { data: driverPrefRows } = await supabase
      .from("driver_preferences")
      .select("user_id, max_detour_mins")
      .in("user_id", driverIds);
    maxDetourByDriver = new Map(
      (driverPrefRows ?? []).map((p) => [p.user_id as string, p.max_detour_mins as number])
    );
  }

  const { data: cfgJson } = await supabase.rpc("get_matching_config", {
    p_org_id: viewer.org_id,
  });
  const cfg = (cfgJson ?? {}) as Record<string, unknown>;

  const overlapMin =
    typeof cfg.overlap_min_ratio === "number" ? cfg.overlap_min_ratio : 0.12;
  const corridorM =
    typeof cfg.corridor_buffer_m === "number" ? cfg.corridor_buffer_m : 400;

  const maxPairs = 12;
  const out: RideOpportunityCard[] = [];

  const pairUserIds = [...new Set(filtered.flatMap((r) => [r.driver_id, r.passenger_id]))];
  const scheduleByUserId = await fetchActiveSchedulesForUsers(pairUserIds);

  for (const row of filtered.slice(0, maxPairs * 2)) {
    if (out.length >= maxPairs) break;

    const driverId = row.driver_id;
    const passengerId = row.passenger_id;

    const { data: driverUser } = await supabase
      .from("users")
      .select(
        "id, home_location, work_location, reliability_score, detour_tolerance_mins, schedule_flex_mins, vehicles(seats, vehicle_class, active)"
      )
      .eq("id", driverId)
      .single();
    const { data: passengerUser } = await supabase
      .from("users")
      .select(
        "id, org_id, home_location, pickup_location, work_location, reliability_score, schedule_flex_mins"
      )
      .eq("id", passengerId)
      .single();

    if (!driverUser || !passengerUser) continue;

    const schedResult = computePairCommuteScheduleOverlap(
      scheduleByUserId.get(driverId) ?? undefined,
      scheduleByUserId.get(passengerId) ?? undefined,
      (driverUser.schedule_flex_mins as number | null | undefined) ?? 15,
      (passengerUser.schedule_flex_mins as number | null | undefined) ?? 15
    );
    if (!schedResult.passes) continue;
    const timeOverlap = schedResult.ratio;

    const dHome = parseLngLatFromUserPoint(driverUser.home_location as string | null);
    const dWork = parseLngLatFromUserPoint(driverUser.work_location as string | null);
    const pHome = parseLngLatFromUserPoint(passengerUser.home_location as string | null);
    const pPickup = parseLngLatFromUserPoint(passengerUser.pickup_location as string | null);
    const pWork = parseLngLatFromUserPoint(passengerUser.work_location as string | null);
    if (!dHome || !dWork || !pHome || !pWork) continue;

    const passengerBoarding = pPickup ?? pHome;
    const maxAlternateFromHomeM = 8000;
    if (
      pPickup &&
      turf.distance(turf.point(pPickup), turf.point(pHome), { units: "meters" }) > maxAlternateFromHomeM
    ) {
      continue;
    }

    const baseline = await getBaselineCommute(dHome, dWork);
    if (!baseline) continue;

    const driverLine = turf.lineString(baseline.coordinates);
    const np = turf.nearestPointOnLine(driverLine, turf.point(passengerBoarding), {
      units: "meters",
    });
    const nd = turf.nearestPointOnLine(driverLine, turf.point(pWork), {
      units: "meters",
    });
    const pickup: LngLat = (np.geometry.coordinates as [number, number]) ?? passengerBoarding;
    const dropoff: LngLat = (nd.geometry.coordinates as [number, number]) ?? pWork;
    const idxP = (np.properties as { index?: number })?.index ?? 0;
    const idxD = (nd.properties as { index?: number })?.index ?? 0;

    if (turf.distance(turf.point(pickup), turf.point(passengerBoarding), { units: "meters" }) > corridorM)
      continue;
    if (turf.distance(turf.point(dropoff), turf.point(pWork), { units: "meters" }) > corridorM) continue;

    const detourMetrics = await computeDriverPassengerDetourMetrics({
      driver_origin: dHome,
      driver_destination: dWork,
      passenger_pickup: pickup,
      passenger_dropoff: dropoff,
      baselineRouteIfKnown: baseline,
    });
    if (!detourMetrics.ok) continue;

    const dm = detourMetrics.data;
    const withPass = {
      distanceM: dm.adjusted_distance_meters,
      durationS: dm.adjusted_duration_seconds,
      coordinates: dm.adjusted_polyline,
    };

    const detourM = dm.added_distance_meters;
    const detourS = dm.added_duration_seconds;
    const detourMin = detourS / 60;
    const tol =
      maxDetourByDriver.get(driverId) ??
      driverUser.detour_tolerance_mins ??
      (typeof cfg.default_detour_tolerance_mins === "number"
        ? cfg.default_detour_tolerance_mins
        : 12);
    if (detourMin > tol + 0.01) continue;

    const lineFeat = driverLine as Feature<LineString>;
    const startPt = idxP <= idxD ? turf.point(pickup) : turf.point(dropoff);
    const endPt = idxP <= idxD ? turf.point(dropoff) : turf.point(pickup);
    const slice = turf.lineSlice(startPt, endPt, lineFeat);
    const passengerSegmentM = turf.length(slice, { units: "kilometers" }) * 1000;

    const vehList = driverUser.vehicles as
      | { seats?: number; vehicle_class?: string; active?: boolean }[]
      | null;
    const vehicle = vehList?.find((v) => v.active) ?? vehList?.[0];
    const vclass = (vehicle?.vehicle_class ?? "sedan") as
      | "compact"
      | "sedan"
      | "suv"
      | "large_suv"
      | "electric";
    const seatCount = Math.max(2, Number(vehicle?.seats) || 4);
    const assumedPoolRiders = Math.max(
      POOLYN_MINGLE_MIN_POOL_RIDERS,
      Math.min(POOLYN_MAX_POOL_RIDERS_FOR_SPLIT, seatCount - 1)
    );

    const costBreakdown = computePassengerCostBreakdown({
      baselineDistanceM: baseline.distanceM,
      baselineDurationS: baseline.durationS,
      withPassengerDistanceM: withPass.distanceM,
      withPassengerDurationS: withPass.durationS,
      passengerSegmentDistanceM: passengerSegmentM,
      detourChargeable: dm.is_detour_chargeable,
      addedDistanceKm: dm.added_distance_km,
      addedDurationSeconds: dm.added_duration_seconds,
      vehicleClass: vclass,
      poolRideAlongPassengerCount: assumedPoolRiders,
    });

    const overlapRatio =
      (row.overlap_ratio_initial as number) > 0
        ? row.overlap_ratio_initial
        : baseline.distanceM > 0
          ? Math.min(1, passengerSegmentM / baseline.distanceM)
          : 0;

    if (overlapRatio < overlapMin) continue;

    const relD = driverUser.reliability_score ?? 70;
    const relP = passengerUser.reliability_score ?? 70;
    const detourPenalty = Math.min(1, detourMin / 20);
    const matchScore =
      0.4 * overlapRatio +
      0.25 * timeOverlap +
      0.2 * (relD / 100) -
      0.15 * detourPenalty;

    const oppId = `${driverId.slice(0, 8)}-${passengerId.slice(0, 8)}-${row.driver_route_id.slice(0, 8)}`;
    const scope =
      row.match_scope === "outer_network"
        ? "outer_network"
        : row.match_scope === "same_org"
          ? "same_org"
          : undefined;

    out.push({
      opportunityId: oppId,
      driverUserId: driverId,
      driverRouteId: row.driver_route_id,
      passengerRouteId: row.passenger_route_id,
      passengerHasWorkplaceOrgOnProfile: Boolean(passengerUser.org_id),
      matchScope: intent === "driver" ? scope : undefined,
      overlapPercent: Math.round(overlapRatio * 100),
      detourMinutes: Math.round(detourMin * 10) / 10,
      detourDistanceM: detourM,
      pickupEtaLabel: formatEta(withPass.durationS * 0.25),
      arrivalEtaLabel: formatEta(withPass.durationS),
      vehicleClassLabel: vehicleClassLabel(vclass),
      seatsAvailable: Math.max(0, (vehicle?.seats ?? 4) - 1),
      passengerCostCents: costBreakdown.total_contribution,
      costBreakdown,
      assumedPoolRiders,
      trustReliability: intent === "passenger" ? relD : relP,
      counterpartyReliability: intent === "passenger" ? relP : relD,
      routeOverlapScore: overlapRatio,
      matchScore,
    });
  }

  const scopeRank = (c: RideOpportunityCard) =>
    c.matchScope === "outer_network" ? 1 : 0;

  out.sort((a, b) => {
    if (intent === "driver" && scopeRank(a) !== scopeRank(b)) return scopeRank(a) - scopeRank(b);
    if (a.detourMinutes !== b.detourMinutes) return a.detourMinutes - b.detourMinutes;
    if (b.overlapPercent !== a.overlapPercent) return b.overlapPercent - a.overlapPercent;
    return b.matchScore - a.matchScore;
  });

  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const dateStr = d.toISOString().slice(0, 10);
  const seed = await fairnessSeedUint32(viewer.id, dateStr);
  const top = out.slice(0, 20);
  const bucket = top.slice(0, Math.min(8, top.length));
  bucket.sort((a, b) => {
    const tie = fairnessUnit(seed, a.opportunityId.length) - fairnessUnit(seed, b.opportunityId.length);
    if (Math.abs(tie) > 1e-6) return tie;
    return b.matchScore - a.matchScore;
  });

  return [...bucket, ...top.slice(bucket.length)];
}

export async function reserveRideOpportunity(
  card: RideOpportunityCard
): Promise<{ ok: boolean; reservationId?: string; reason?: string }> {
  const { data, error } = await supabase.rpc("reserve_commute_ride", {
    p_driver_id: card.driverUserId,
    p_driver_route_id: card.driverRouteId,
    p_passenger_route_id: card.passengerRouteId,
    p_cost_breakdown: card.costBreakdown as unknown as Record<string, unknown>,
    p_passenger_cost_cents: card.passengerCostCents,
    p_overlap_ratio: card.routeOverlapScore,
    p_detour_distance_m: card.detourDistanceM,
    p_detour_time_s: card.detourMinutes * 60,
    p_pickup_eta_hint: card.pickupEtaLabel,
  });
  if (error) return { ok: false, reason: error.message };
  const payload = data as { ok?: boolean; reservation_id?: string; reservationId?: string; reason?: string };
  return {
    ok: payload.ok === true,
    reservationId: payload.reservation_id ?? payload.reservationId,
    reason: payload.reason,
  };
}
