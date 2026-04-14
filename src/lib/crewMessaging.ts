import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { computeCrewEqualCorridorRiderBreakdown } from "@/lib/costModel";

const MAX_BODY_LEN = 2000;

/** Max crews a single user may belong to (join + create). */
export const MAX_CREWS_PER_USER = 3;

export type CrewCommutePattern = "to_work" | "to_home" | "round_trip";

/** Daily schedule anchor saved on the crew (local clock, minutes from midnight). */
export type CrewScheduleMode = "arrival" | "start";

export type CrewListRow = {
  id: string;
  name: string;
  invite_code: string;
  org_id: string | null;
  commute_pattern: CrewCommutePattern;
  sticker_emoji: string | null;
  sticker_image_url: string | null;
  /** Snapshot from crew creation; map/stats ignore later profile route changes. */
  locked_route_distance_m?: number | null;
  locked_route_duration_s?: number | null;
  schedule_mode?: CrewScheduleMode;
  schedule_anchor_minutes?: number;
  estimated_pool_drive_minutes?: number;
};

export type CrewTripInstanceRow = {
  id: string;
  crew_id: string;
  trip_date: string;
  designated_driver_user_id: string | null;
  excluded_pickup_user_ids: string[];
  trip_started_at: string | null;
  trip_finished_at: string | null;
  poolyn_credits_settled_at: string | null;
  settlement_summary: Json | null;
  /** First user who recorded trip start (for notify/ack when driver is known). */
  trip_started_by_user_id: string | null;
  /** Map of user id to ISO time when they tapped ready for pickup. */
  rider_pickup_ready_at: Json | null;
  departure_readiness_reminder_sent_at: string | null;
};

/** Driver or trip starter: not expected to send rider pickup ack. */
export function crewTripPickupAckDriverishId(trip: CrewTripInstanceRow): string | null {
  return trip.designated_driver_user_id ?? trip.trip_started_by_user_id ?? null;
}

export function parseRiderPickupReadyMap(raw: Json | null | undefined): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * True when this member should see "I am ready for pickup" during an active trip.
 *
 * The rider readiness window is open while trip_started_at is set and trip_finished_at is null.
 * Within that window, every non-excluded, non-driver crew member is expected to acknowledge.
 * The ack is one-way: once tapped it cannot be retracted (server merges the timestamp into
 * rider_pickup_ready_at, never removes it). The driver/starter is never asked to ack their
 * own trip start; they are identified by crewTripPickupAckDriverishId (designated driver first,
 * then the user who pressed Start Poolyn if no designated driver was set before start).
 */
export function viewerShouldAckPickupReady(trip: CrewTripInstanceRow, viewerId: string): boolean {
  // Window check: trip must be live (started, not finished).
  if (!trip.trip_started_at || trip.trip_finished_at) return false;
  const ex = new Set(trip.excluded_pickup_user_ids ?? []);
  // Excluded riders do not receive the prompt.
  if (ex.has(viewerId)) return false;
  const d = crewTripPickupAckDriverishId(trip);
  // If no driverish user is known, ack system is not yet active.
  if (!d) return false;
  // Driver/starter does not ack their own trip.
  if (viewerId === d) return false;
  const map = parseRiderPickupReadyMap(trip.rider_pickup_ready_at);
  // Already acked - do not show the prompt again.
  if (map[viewerId]) return false;
  return true;
}

/**
 * Count of pickup riders who have not yet acknowledged readiness during an active trip.
 * Used by the driver (and the finish-trip flow) to surface a warning before settling credits.
 *
 * Returns 0 when the trip is not in progress, has no applicable riders, or all riders have acked.
 */
export function countPendingPickupAcks(
  trip: CrewTripInstanceRow,
  rosterUserIds: string[]
): number {
  // Window check mirrors viewerShouldAckPickupReady.
  if (!trip.trip_started_at || trip.trip_finished_at) return 0;
  const driverish = crewTripPickupAckDriverishId(trip);
  const ex = new Set(trip.excluded_pickup_user_ids ?? []);
  const ready = parseRiderPickupReadyMap(trip.rider_pickup_ready_at);
  return rosterUserIds.filter(
    (uid) => uid !== driverish && !ex.has(uid) && !ready[uid]
  ).length;
}

export type CrewTripSettlementRiderLine = {
  user_id: string;
  full_name?: string;
  credits_contribution?: number;
  credits_crew_admin_fee?: number;
  credits_total_debited?: number;
  is_org_member?: boolean;
};

export type CrewTripSettlementSummary = {
  crew_name?: string;
  trip_date?: string;
  route_label?: string;
  commute_pattern?: string;
  distance_km?: number | null;
  duration_mins?: number | null;
  contribution_credits_per_rider?: number;
  crew_explorer_admin_fee_rate?: number;
  riders?: CrewTripSettlementRiderLine[];
  driver_user_id?: string;
  driver_full_name?: string;
  driver_credits_earned?: number;
  total_crew_admin_credits_from_explorers?: number;
};

export type CompletedCrewTripHistoryRow = {
  id: string;
  crewId: string;
  crewName: string;
  tripDate: string;
  tripFinishedAt: string;
  settlementSummary: CrewTripSettlementSummary | null;
};

export type CrewMessageRow = {
  id: string;
  sender_id: string | null;
  body: string;
  kind: string;
  meta: Json;
  sent_at: string;
  sender_name: string | null;
};

export type CrewInboxRow = {
  tripInstanceId: string;
  crewId: string;
  crewName: string;
  tripDate: string;
  designatedDriverUserId: string | null;
  subtitle: string;
};

export type CrewInvitePendingRow = {
  id: string;
  crew_id: string;
  crew_name: string;
  message: string | null;
  invited_by_name: string | null;
  created_at: string;
};

export type CrewMemberMapPin = {
  userId: string;
  fullName: string | null;
  lat: number;
  lng: number;
};

export async function listPendingCrewInvites(userId: string): Promise<CrewInvitePendingRow[]> {
  const { data: invs, error } = await supabase
    .from("crew_invitations")
    .select("id, crew_id, message, created_at, invited_by_user_id")
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error || !invs?.length) return [];

  const crewIds = [...new Set(invs.map((i) => i.crew_id as string))];
  const byIds = [...new Set(invs.map((i) => i.invited_by_user_id as string))];
  const [{ data: crews }, { data: inviters }] = await Promise.all([
    supabase.from("crews").select("id, name").in("id", crewIds),
    supabase.from("users").select("id, full_name").in("id", byIds),
  ]);
  const crewNameBy = new Map((crews ?? []).map((c) => [c.id, (c.name as string) ?? "Crew"]));
  const nameBy = new Map((inviters ?? []).map((u) => [u.id, (u.full_name as string | null) ?? null]));

  return invs.map((i) => ({
    id: i.id as string,
    crew_id: i.crew_id as string,
    crew_name: crewNameBy.get(i.crew_id as string) ?? "Crew",
    message: (i.message as string | null) ?? null,
    invited_by_name: nameBy.get(i.invited_by_user_id as string) ?? null,
    created_at: i.created_at as string,
  }));
}

export async function respondToCrewInvite(
  invitationId: string,
  accept: boolean
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_respond_crew_invitation", {
    p_invitation_id: invitationId,
    p_accept: accept,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) return { ok: true };
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "failed" };
}

/** Home pins for map preview (approximate areas only). */
export async function fetchCrewMemberHomePins(crewId: string): Promise<CrewMemberMapPin[]> {
  const { data: members, error: e1 } = await supabase
    .from("crew_members")
    .select("user_id")
    .eq("crew_id", crewId);
  if (e1 || !members?.length) return [];
  const userIds = members.map((m) => m.user_id as string);
  const { data: users, error: e2 } = await supabase
    .from("users")
    .select("id, full_name, home_location")
    .in("id", userIds);
  if (e2 || !users?.length) return [];
  const out: CrewMemberMapPin[] = [];
  for (const u of users) {
    const pt = parseGeoPoint(u.home_location as unknown);
    if (!pt) continue;
    out.push({
      userId: u.id as string,
      fullName: (u.full_name as string | null) ?? null,
      lat: pt.lat,
      lng: pt.lng,
    });
  }
  return out;
}

/** Crew owner's saved commute pins (canonical corridor anchor for dice/wheel hints). */
export async function fetchCrewOwnerHomeWork(
  crewId: string
): Promise<{ home_location: unknown; work_location: unknown } | null> {
  const { data: row, error } = await supabase
    .from("crew_members")
    .select("user_id")
    .eq("crew_id", crewId)
    .eq("role", "owner")
    .maybeSingle();
  if (error || !row?.user_id) return null;
  const { data: u, error: e2 } = await supabase
    .from("users")
    .select("home_location, work_location")
    .eq("id", row.user_id as string)
    .maybeSingle();
  if (e2 || !u) return null;
  return { home_location: u.home_location, work_location: u.work_location };
}

export type CrewRosterMember = { userId: string; fullName: string | null };

/** People with a pending in-app invite — not yet in crew_members until they accept. */
export type PendingCrewInvitee = {
  userId: string;
  fullName: string | null;
  lat: number | null;
  lng: number | null;
};

export async function fetchPendingCrewInvitees(crewId: string): Promise<PendingCrewInvitee[]> {
  const { data: invs, error } = await supabase
    .from("crew_invitations")
    .select("invited_user_id")
    .eq("crew_id", crewId)
    .eq("status", "pending");
  if (error || !invs?.length) return [];
  const ids = [...new Set(invs.map((i) => i.invited_user_id as string))];
  const { data: users, error: e2 } = await supabase
    .from("users")
    .select("id, full_name, home_location")
    .in("id", ids);
  if (e2 || !users?.length) return [];
  const order = new Map(ids.map((id, i) => [id, i]));
  return [...users]
    .sort((a, b) => (order.get(a.id as string) ?? 0) - (order.get(b.id as string) ?? 0))
    .map((u) => {
      const pt = parseGeoPoint(u.home_location as unknown);
      return {
        userId: u.id as string,
        fullName: (u.full_name as string | null) ?? null,
        lat: pt?.lat ?? null,
        lng: pt?.lng ?? null,
      };
    });
}

export async function isCrewOwner(crewId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("crew_members")
    .select("role")
    .eq("crew_id", crewId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) === "owner";
}

export async function deleteCrewAsOwner(crewId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase.from("crews").delete().eq("id", crewId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function countPendingCrewInvitationsForCrew(crewId: string): Promise<number> {
  const { count, error } = await supabase
    .from("crew_invitations")
    .select("*", { count: "exact", head: true })
    .eq("crew_id", crewId)
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}

export async function fetchCrewRoster(crewId: string): Promise<CrewRosterMember[]> {
  const { data: members, error: e1 } = await supabase
    .from("crew_members")
    .select("user_id")
    .eq("crew_id", crewId);
  if (e1 || !members?.length) return [];
  const userIds = members.map((m) => m.user_id as string);
  const { data: users, error: e2 } = await supabase
    .from("users")
    .select("id, full_name")
    .in("id", userIds);
  if (e2 || !users?.length) return [];
  const order = new Map(userIds.map((id, i) => [id, i]));
  return [...users]
    .sort((a, b) => (order.get(a.id as string) ?? 0) - (order.get(b.id as string) ?? 0))
    .map((u) => ({
      userId: u.id as string,
      fullName: (u.full_name as string | null) ?? null,
    }));
}

export async function countCrewMembers(crewId: string): Promise<number> {
  const { count, error } = await supabase
    .from("crew_members")
    .select("*", { count: "exact", head: true })
    .eq("crew_id", crewId);
  if (error) return 0;
  return count ?? 0;
}

export async function countCrewsForUser(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("crew_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return 0;
  return count ?? 0;
}

export async function listMyCrews(userId: string): Promise<CrewListRow[]> {
  const { data: links, error: e1 } = await supabase
    .from("crew_members")
    .select("crew_id")
    .eq("user_id", userId);
  if (e1 || !links?.length) return [];
  const ids = [...new Set(links.map((l) => l.crew_id as string))];
  const { data: crews, error: e2 } = await supabase
    .from("crews")
    .select(
      "id, name, invite_code, org_id, commute_pattern, sticker_emoji, sticker_image_url, locked_route_distance_m, locked_route_duration_s, schedule_mode, schedule_anchor_minutes, estimated_pool_drive_minutes"
    )
    .in("id", ids)
    .order("name");
  if (e2 || !crews) return [];
  return crews.map((raw) => {
    const c = raw as Record<string, unknown>;
    return {
      id: c.id as string,
      name: c.name as string,
      invite_code: c.invite_code as string,
      org_id: (c.org_id as string | null) ?? null,
      commute_pattern: ((c.commute_pattern as CrewCommutePattern) ?? "to_work") as CrewCommutePattern,
      sticker_emoji: (c.sticker_emoji as string | null) ?? null,
      sticker_image_url: (c.sticker_image_url as string | null) ?? null,
      locked_route_distance_m:
        typeof c.locked_route_distance_m === "number" ? c.locked_route_distance_m : null,
      locked_route_duration_s:
        typeof c.locked_route_duration_s === "number" ? c.locked_route_duration_s : null,
      schedule_mode:
        c.schedule_mode === "start" || c.schedule_mode === "arrival" ? c.schedule_mode : "arrival",
      schedule_anchor_minutes:
        typeof c.schedule_anchor_minutes === "number" ? c.schedule_anchor_minutes : 540,
      estimated_pool_drive_minutes:
        typeof c.estimated_pool_drive_minutes === "number" ? c.estimated_pool_drive_minutes : 45,
    };
  });
}

export async function createCrewInvitations(params: {
  crewId: string;
  invitedByUserId: string;
  inviteeUserIds: string[];
  message: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ids = params.inviteeUserIds.filter((id) => id && id !== params.invitedByUserId);
  if (!ids.length) return { ok: true };
  const rows = ids.map((invited_user_id) => ({
    crew_id: params.crewId,
    invited_user_id,
    invited_by_user_id: params.invitedByUserId,
    message: params.message,
  }));
  const { error } = await supabase.from("crew_invitations").insert(rows);
  if (error) {
    if (error.code === "23505") return { ok: true };
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function createCrew(params: {
  name: string;
  userId: string;
  orgId: string | null;
  commutePattern?: CrewCommutePattern;
  scheduleMode?: CrewScheduleMode;
  scheduleAnchorMinutes?: number;
  estimatedPoolDriveMinutes?: number;
}): Promise<{ ok: true; crewId: string } | { ok: false; reason: string }> {
  const name = params.name.trim();
  if (!name) return { ok: false, reason: "Name is required." };
  const n = await countCrewsForUser(params.userId);
  if (n >= MAX_CREWS_PER_USER) {
    return {
      ok: false,
      reason: `You can be in up to ${MAX_CREWS_PER_USER} crews. Leave one under Profile → Poolyn Crews before creating another.`,
    };
  }
  const mode: CrewScheduleMode = params.scheduleMode === "start" ? "start" : "arrival";
  const anchor =
    typeof params.scheduleAnchorMinutes === "number" &&
    params.scheduleAnchorMinutes >= 0 &&
    params.scheduleAnchorMinutes < 1440
      ? Math.floor(params.scheduleAnchorMinutes)
      : 540;
  const estDrive =
    typeof params.estimatedPoolDriveMinutes === "number" &&
    params.estimatedPoolDriveMinutes >= 1 &&
    params.estimatedPoolDriveMinutes <= 600
      ? Math.floor(params.estimatedPoolDriveMinutes)
      : 45;

  const { data: crew, error: e1 } = await supabase
    .from("crews")
    .insert({
      name,
      created_by: params.userId,
      org_id: params.orgId,
      commute_pattern: params.commutePattern ?? "to_work",
      schedule_mode: mode,
      schedule_anchor_minutes: anchor,
      estimated_pool_drive_minutes: estDrive,
    })
    .select("id")
    .single();
  if (e1 || !crew?.id) return { ok: false, reason: e1?.message ?? "Could not create crew." };
  const crewId = crew.id as string;
  const { error: e2 } = await supabase.from("crew_members").insert({
    crew_id: crewId,
    user_id: params.userId,
    role: "owner",
  });
  if (e2) return { ok: false, reason: e2.message };
  await supabase.rpc("poolyn_lock_crew_formation_route", { p_crew_id: crewId });
  return { ok: true, crewId };
}

export async function joinCrewByCode(
  code: string
): Promise<{ ok: true; crewId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_join_crew", {
    p_invite_code: code.trim(),
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true && typeof o.crew_id === "string") {
    return { ok: true, crewId: o.crew_id };
  }
  const reason = typeof o?.reason === "string" ? o.reason : "join_failed";
  const human: Record<string, string> = {
    crew_not_found: "No crew matches that code.",
    org_mismatch: "This crew belongs to another workplace. Use an invite from your organisation.",
    invalid_code: "Enter a valid invite code.",
    too_many_crews: `You can be in up to ${MAX_CREWS_PER_USER} crews. Leave or delete one in Crew Poolyn on Home before joining another.`,
  };
  return { ok: false, reason: human[reason] ?? reason };
}

const CREW_TRIP_INSTANCE_SELECT =
  "id, crew_id, trip_date, designated_driver_user_id, excluded_pickup_user_ids, trip_started_at, trip_finished_at, poolyn_credits_settled_at, settlement_summary, trip_started_by_user_id, rider_pickup_ready_at, departure_readiness_reminder_sent_at";

function crewTripInstanceFromRow(row: Record<string, unknown>): CrewTripInstanceRow {
  const excluded = row.excluded_pickup_user_ids;
  return {
    id: row.id as string,
    crew_id: row.crew_id as string,
    trip_date: row.trip_date as string,
    designated_driver_user_id: (row.designated_driver_user_id as string | null) ?? null,
    excluded_pickup_user_ids: Array.isArray(excluded) ? (excluded as string[]) : [],
    trip_started_at: (row.trip_started_at as string | null) ?? null,
    trip_finished_at: (row.trip_finished_at as string | null) ?? null,
    poolyn_credits_settled_at: (row.poolyn_credits_settled_at as string | null) ?? null,
    settlement_summary: (row.settlement_summary as Json | null) ?? null,
    trip_started_by_user_id: (row.trip_started_by_user_id as string | null) ?? null,
    rider_pickup_ready_at: (row.rider_pickup_ready_at as Json | null) ?? null,
    departure_readiness_reminder_sent_at:
      (row.departure_readiness_reminder_sent_at as string | null) ?? null,
  };
}

/**
 * Ensures a row exists for (crew, local date) without touching existing columns.
 * A plain PostgREST upsert with only crew_id + trip_date can overwrite other fields (e.g. trip_started_at) on conflict.
 */
export async function getOrCreateTripInstance(
  crewId: string,
  tripDate: string
): Promise<{ ok: true; row: CrewTripInstanceRow } | { ok: false; reason: string }> {
  const { data: existing, error: selErr } = await supabase
    .from("crew_trip_instances")
    .select(CREW_TRIP_INSTANCE_SELECT)
    .eq("crew_id", crewId)
    .eq("trip_date", tripDate)
    .maybeSingle();

  if (selErr) return { ok: false, reason: selErr.message };
  if (existing) {
    return { ok: true, row: crewTripInstanceFromRow(existing as Record<string, unknown>) };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("crew_trip_instances")
    .insert({ crew_id: crewId, trip_date: tripDate })
    .select(CREW_TRIP_INSTANCE_SELECT)
    .single();

  if (!insErr && inserted) {
    return { ok: true, row: crewTripInstanceFromRow(inserted as Record<string, unknown>) };
  }

  const dup =
    insErr?.code === "23505" ||
    (typeof insErr?.message === "string" && /duplicate|unique/i.test(insErr.message));
  if (dup) {
    const { data: again, error: againErr } = await supabase
      .from("crew_trip_instances")
      .select(CREW_TRIP_INSTANCE_SELECT)
      .eq("crew_id", crewId)
      .eq("trip_date", tripDate)
      .maybeSingle();
    if (!againErr && again) {
      return { ok: true, row: crewTripInstanceFromRow(again as Record<string, unknown>) };
    }
  }

  return { ok: false, reason: insErr?.message ?? "trip_instance_failed" };
}

export async function fetchCrewTripInstance(
  tripInstanceId: string
): Promise<CrewTripInstanceRow | null> {
  const { data, error } = await supabase
    .from("crew_trip_instances")
    .select(CREW_TRIP_INSTANCE_SELECT)
    .eq("id", tripInstanceId)
    .maybeSingle();
  if (error || !data) return null;
  return crewTripInstanceFromRow(data as Record<string, unknown>);
}

/** Notify riders once when local time is near the planned driver departure (see migration 0078). */
export async function tryDepartureReadinessReminder(params: {
  tripInstanceId: string;
  localMinutesFromMidnight: number;
  tripLocalDate: string;
}): Promise<void> {
  await supabase.rpc("poolyn_try_departure_readiness_reminder", {
    p_trip_instance_id: params.tripInstanceId,
    p_local_minutes: params.localMinutesFromMidnight,
    p_trip_local_date: params.tripLocalDate,
  });
}

/**
 * Updates the shared schedule snapshot on `crews` (anchor, mode, estimated pool drive).
 * Any crew member may call this via `poolyn_crew_update_schedule_snapshot` (for example after the driver changes).
 */
export async function updateCrewScheduleSnapshot(params: {
  crewId: string;
  scheduleMode: CrewScheduleMode;
  scheduleAnchorMinutes: number;
  estimatedPoolDriveMinutes: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_update_schedule_snapshot", {
    p_crew_id: params.crewId,
    p_schedule_mode: params.scheduleMode,
    p_schedule_anchor_minutes: params.scheduleAnchorMinutes,
    p_estimated_pool_drive_minutes: params.estimatedPoolDriveMinutes,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) return { ok: true };
  const reason = typeof o?.reason === "string" ? o.reason.replace(/_/g, " ") : "Could not update schedule.";
  return { ok: false, reason };
}

export async function updateCrewSettings(params: {
  crewId: string;
  name?: string;
  commute_pattern?: CrewCommutePattern;
  sticker_emoji?: string | null;
  sticker_image_url?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name.trim();
  if (params.commute_pattern !== undefined) patch.commute_pattern = params.commute_pattern;
  if (params.sticker_emoji !== undefined) {
    const s = params.sticker_emoji?.trim().slice(0, 16) ?? "";
    patch.sticker_emoji = s.length ? s : null;
  }
  if (params.sticker_image_url !== undefined) {
    const u = params.sticker_image_url?.trim() ?? "";
    patch.sticker_image_url = u.length ? u : null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from("crews").update(patch).eq("id", params.crewId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function setTripExcludedPickups(
  tripInstanceId: string,
  excludedUserIds: string[]
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase
    .from("crew_trip_instances")
    .update({ excluded_pickup_user_ids: excludedUserIds })
    .eq("id", tripInstanceId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function removeCrewMemberAsOwner(
  crewId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_owner_remove_member", {
    p_crew_id: crewId,
    p_target_user_id: targetUserId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) return { ok: true };
  const reason = typeof o?.reason === "string" ? o.reason : "failed";
  const human: Record<string, string> = {
    not_owner: "Only the crew owner can remove a member.",
    not_found_or_owner: "That member is not in the crew or cannot be removed.",
    cannot_remove_self_here: "Use leave crew if you want to remove yourself.",
  };
  return { ok: false, reason: human[reason] ?? reason };
}

export async function fetchCrewRow(crewId: string): Promise<CrewListRow | null> {
  const { data, error } = await supabase
    .from("crews")
    .select(
      "id, name, invite_code, org_id, commute_pattern, sticker_emoji, sticker_image_url, locked_route_distance_m, locked_route_duration_s, schedule_mode, schedule_anchor_minutes, estimated_pool_drive_minutes"
    )
    .eq("id", crewId)
    .maybeSingle();
  if (error || !data) return null;
  const c = data as Record<string, unknown>;
  return {
    id: c.id as string,
    name: c.name as string,
    invite_code: c.invite_code as string,
    org_id: (c.org_id as string | null) ?? null,
    commute_pattern: ((c.commute_pattern as CrewCommutePattern) ?? "to_work") as CrewCommutePattern,
    sticker_emoji: (c.sticker_emoji as string | null) ?? null,
    sticker_image_url: (c.sticker_image_url as string | null) ?? null,
    locked_route_distance_m:
      typeof c.locked_route_distance_m === "number" ? c.locked_route_distance_m : null,
    locked_route_duration_s:
      typeof c.locked_route_duration_s === "number" ? c.locked_route_duration_s : null,
    schedule_mode:
      c.schedule_mode === "start" || c.schedule_mode === "arrival" ? c.schedule_mode : "arrival",
    schedule_anchor_minutes:
      typeof c.schedule_anchor_minutes === "number" ? c.schedule_anchor_minutes : 540,
    estimated_pool_drive_minutes:
      typeof c.estimated_pool_drive_minutes === "number" ? c.estimated_pool_drive_minutes : 45,
  };
}

export async function fetchCrewName(crewId: string): Promise<string | null> {
  const { data } = await supabase.from("crews").select("name").eq("id", crewId).maybeSingle();
  return (data?.name as string | undefined)?.trim() || null;
}

export async function fetchCrewMessages(tripInstanceId: string): Promise<CrewMessageRow[]> {
  const { data: msgs, error } = await supabase
    .from("crew_messages")
    .select("id, sender_id, body, kind, meta, sent_at")
    .eq("crew_trip_instance_id", tripInstanceId)
    .order("sent_at", { ascending: true });
  if (error || !msgs?.length) return [];

  const senderIds = [...new Set(msgs.map((m) => m.sender_id).filter(Boolean))] as string[];
  let nameBy = new Map<string, string | null>();
  if (senderIds.length > 0) {
    const { data: users } = await supabase.from("users").select("id, full_name").in("id", senderIds);
    nameBy = new Map((users ?? []).map((u) => [u.id, u.full_name as string | null]));
  }

  return msgs.map((m) => ({
    id: m.id as string,
    sender_id: (m.sender_id as string | null) ?? null,
    body: m.body as string,
    kind: (m.kind as string) ?? "user",
    meta: (m.meta as Json) ?? {},
    sent_at: m.sent_at as string,
    sender_name: m.sender_id ? nameBy.get(m.sender_id as string) ?? null : null,
  }));
}

export async function sendCrewUserMessage(
  tripInstanceId: string,
  userId: string,
  body: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_BODY_LEN) return { ok: false, reason: "too_long" };
  const { error } = await supabase.from("crew_messages").insert({
    crew_trip_instance_id: tripInstanceId,
    sender_id: userId,
    body: trimmed,
    kind: "user",
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function setCrewDesignatedDriver(
  tripInstanceId: string,
  driverUserId: string
): Promise<{ ok: true; driverId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_set_designated_driver", {
    p_trip_instance_id: tripInstanceId,
    p_driver_user_id: driverUserId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true && typeof o.designated_driver_user_id === "string") {
    return { ok: true, driverId: o.designated_driver_user_id };
  }
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "set_driver_failed" };
}

export type CrewDriverSpinSessionRow = {
  crew_trip_instance_id: string;
  opened_by_user_id: string;
  pool_user_ids: string[];
  phase: "open" | "completed";
  winner_user_id: string | null;
  winner_index: number | null;
  created_at: string;
  updated_at: string;
};

function parseSpinSessionRow(data: Record<string, unknown>): CrewDriverSpinSessionRow {
  const pool = data.pool_user_ids;
  const ids = Array.isArray(pool) ? pool.filter((x): x is string => typeof x === "string") : [];
  return {
    crew_trip_instance_id: data.crew_trip_instance_id as string,
    opened_by_user_id: data.opened_by_user_id as string,
    pool_user_ids: ids,
    phase: data.phase === "completed" ? "completed" : "open",
    winner_user_id: (data.winner_user_id as string | null) ?? null,
    winner_index: typeof data.winner_index === "number" ? data.winner_index : null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export async function fetchCrewDriverSpinSession(
  tripInstanceId: string
): Promise<CrewDriverSpinSessionRow | null> {
  const { data, error } = await supabase
    .from("crew_driver_spin_sessions")
    .select("*")
    .eq("crew_trip_instance_id", tripInstanceId)
    .maybeSingle();
  if (error || !data) return null;
  return parseSpinSessionRow(data as Record<string, unknown>);
}

export async function openCrewDriverSpinSession(params: {
  tripInstanceId: string;
}): Promise<
  | { ok: true; openedByUserId: string; poolUserIds: string[] }
  | { ok: false; reason: string }
> {
  const { data, error } = await supabase.rpc("poolyn_crew_driver_spin_open", {
    p_trip_instance_id: params.tripInstanceId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) {
    const pool = o.pool_user_ids;
    const ids = Array.isArray(pool) ? pool.filter((x): x is string => typeof x === "string") : [];
    const ob = o.opened_by_user_id;
    if (typeof ob === "string" && ids.length >= 2) {
      return { ok: true, openedByUserId: ob, poolUserIds: ids };
    }
  }
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "spin_open_failed" };
}

export async function toggleCrewDriverSpinPool(
  tripInstanceId: string,
  add: boolean
): Promise<{ ok: true; poolUserIds: string[] } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_driver_spin_toggle", {
    p_trip_instance_id: tripInstanceId,
    p_add: add,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) {
    const pool = o.pool_user_ids;
    const ids = Array.isArray(pool) ? pool.filter((x): x is string => typeof x === "string") : [];
    return { ok: true, poolUserIds: ids };
  }
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "spin_toggle_failed" };
}

export async function executeCrewDriverSpin(tripInstanceId: string): Promise<
  | { ok: true; winnerUserId: string; winnerIndex: number }
  | { ok: false; reason: string }
> {
  const { data, error } = await supabase.rpc("poolyn_crew_driver_spin_execute", {
    p_trip_instance_id: tripInstanceId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true && typeof o.winner_user_id === "string" && typeof o.winner_index === "number") {
    return { ok: true, winnerUserId: o.winner_user_id, winnerIndex: o.winner_index };
  }
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "spin_execute_failed" };
}

export async function abandonCrewDriverSpinSession(
  tripInstanceId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_driver_spin_abandon", {
    p_trip_instance_id: tripInstanceId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) return { ok: true };
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "spin_abandon_failed" };
}

export async function recordCrewTripStarted(
  tripInstanceId: string
): Promise<{ ok: true; idempotent?: boolean } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_trip_record_started", {
    p_trip_instance_id: tripInstanceId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) return { ok: true, idempotent: o.idempotent === true };
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "start_failed" };
}

const ACK_PICKUP_REASONS: Record<string, string> = {
  not_authenticated: "Sign in again.",
  trip_not_found: "This trip is no longer available.",
  not_in_crew: "You are not in this crew.",
  trip_not_started: "The trip has not started yet.",
  trip_finished: "This trip is already finished.",
  excluded_from_pickup: "You were excluded from pickups today.",
  driver_no_ack: "Only riders confirm pickup readiness.",
  ack_unavailable: "Pickup confirmation is not available for this trip.",
};

export async function ackCrewTripPickupReady(
  tripInstanceId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_crew_trip_ack_pickup_ready", {
    p_trip_instance_id: tripInstanceId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) return { ok: true };
  const raw = typeof o?.reason === "string" ? o.reason : "ack_failed";
  return { ok: false, reason: ACK_PICKUP_REASONS[raw] ?? raw };
}

export async function finishAndSettleCrewTripCredits(params: {
  tripInstanceId: string;
  contributionCreditsPerRider: number;
}): Promise<
  | { ok: true; idempotent?: boolean; settlementSummary: CrewTripSettlementSummary | null }
  | { ok: false; reason: string; needed?: number; balance?: number }
> {
  const { data, error } = await supabase.rpc("poolyn_crew_trip_finish_and_settle_credits", {
    p_trip_instance_id: params.tripInstanceId,
    p_contribution_credits_per_rider: params.contributionCreditsPerRider,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true) {
    const raw = o.settlement_summary;
    const settlementSummary =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as CrewTripSettlementSummary)
        : null;
    return {
      ok: true,
      idempotent: o.idempotent === true,
      settlementSummary,
    };
  }
  if (o?.reason === "insufficient_credits") {
    return {
      ok: false,
      reason: "insufficient_credits",
      needed: typeof o.needed === "number" ? o.needed : undefined,
      balance: typeof o.balance === "number" ? o.balance : undefined,
    };
  }
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "settle_failed" };
}

/**
 * Same rider share as the crew card (locked corridor split). Credits use the same integer units as cents.
 */
export async function fetchCrewTripContributionForSettlement(params: {
  crewId: string;
  viewerUserId: string;
  /** Crew members paying today: not the designated driver and not in excluded pickups. */
  payingRiderCount: number;
}): Promise<
  | {
      ok: true;
      contributionCredits: number;
      poolRiders: number;
      distanceM: number | null;
      durationS: number | null;
    }
  | { ok: false; reason: string }
> {
  const { data: crew, error: e1 } = await supabase
    .from("crews")
    .select("locked_route_distance_m, locked_route_duration_s")
    .eq("id", params.crewId)
    .maybeSingle();
  if (e1 || !crew) return { ok: false, reason: "crew_not_found" };

  const poolRiders = Math.max(0, Math.floor(params.payingRiderCount));
  if (poolRiders < 1) {
    return { ok: true, contributionCredits: 0, poolRiders: 0, distanceM: null, durationS: null };
  }

  let distanceM =
    typeof crew.locked_route_distance_m === "number" ? crew.locked_route_distance_m : null;
  let durationS =
    typeof crew.locked_route_duration_s === "number" ? crew.locked_route_duration_s : null;

  if (distanceM == null || durationS == null) {
    const { data: cr } = await supabase
      .from("commute_routes")
      .select("distance_m, duration_s")
      .eq("user_id", params.viewerUserId)
      .eq("direction", "to_work")
      .maybeSingle();
    if (cr) {
      if (distanceM == null && typeof cr.distance_m === "number") distanceM = cr.distance_m;
      if (durationS == null && typeof cr.duration_s === "number") durationS = cr.duration_s;
    }
  }

  if (distanceM == null || durationS == null) {
    return { ok: false, reason: "no_route_stats" };
  }

  const bd = computeCrewEqualCorridorRiderBreakdown({
    lockedRouteDistanceM: distanceM,
    lockedRouteDurationS: durationS,
    poolRiderCount: poolRiders,
  });
  if (!bd) return { ok: false, reason: "pricing_unavailable" };

  return {
    ok: true,
    contributionCredits: bd.total_contribution,
    poolRiders,
    distanceM,
    durationS,
  };
}

export async function listMyCompletedCrewTripsForHistory(
  userId: string
): Promise<CompletedCrewTripHistoryRow[]> {
  const { data: links, error: e1 } = await supabase
    .from("crew_members")
    .select("crew_id")
    .eq("user_id", userId);
  if (e1 || !links?.length) return [];
  const crewIds = [...new Set(links.map((l) => l.crew_id as string))];

  const { data, error: e2 } = await supabase
    .from("crew_trip_instances")
    .select("id, crew_id, trip_date, trip_finished_at, settlement_summary")
    .in("crew_id", crewIds)
    .not("trip_finished_at", "is", null)
    .order("trip_finished_at", { ascending: false })
    .limit(40);

  if (e2) {
    if (__DEV__) console.warn("[listMyCompletedCrewTripsForHistory]", e2.message);
    return [];
  }
  if (!data?.length) return [];

  const nameIds = [...new Set(data.map((r) => r.crew_id as string))];
  const { data: crewRows } = await supabase.from("crews").select("id, name").in("id", nameIds);
  const nameBy = new Map((crewRows ?? []).map((c) => [c.id as string, (c.name as string)?.trim() || "Crew"]));

  const out: CompletedCrewTripHistoryRow[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const crewName = nameBy.get(row.crew_id as string) ?? "Crew";
    const finished = row.trip_finished_at as string | null;
    if (!finished) continue;
    const sumRaw = row.settlement_summary;
    const settlementSummary =
      sumRaw && typeof sumRaw === "object" && !Array.isArray(sumRaw)
        ? (sumRaw as CrewTripSettlementSummary)
        : null;
    out.push({
      id: row.id as string,
      crewId: row.crew_id as string,
      crewName,
      tripDate: row.trip_date as string,
      tripFinishedAt: finished,
      settlementSummary,
    });
  }
  return out;
}

export async function rollCrewDriverDice(
  tripInstanceId: string,
  eligibleUserIds?: string[] | null
): Promise<{ ok: true; driverId: string } | { ok: false; reason: string }> {
  const args: { p_trip_instance_id: string; p_eligible_user_ids?: string[] } = {
    p_trip_instance_id: tripInstanceId,
  };
  if (eligibleUserIds != null && eligibleUserIds.length > 0) {
    args.p_eligible_user_ids = eligibleUserIds;
  }
  const { data, error } = await supabase.rpc("poolyn_crew_roll_driver", args);
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o?.ok === true && typeof o.designated_driver_user_id === "string") {
    return { ok: true, driverId: o.designated_driver_user_id };
  }
  return { ok: false, reason: typeof o?.reason === "string" ? o.reason : "roll_failed" };
}

/** Today's trip chat per crew the user belongs to (for Messages inbox). */
export async function listTodaysCrewInboxRows(userId: string): Promise<CrewInboxRow[]> {
  const crews = await listMyCrews(userId);
  if (!crews.length) return [];
  const today = localDateKey();
  const rows: CrewInboxRow[] = [];
  for (const c of crews) {
    const inst = await getOrCreateTripInstance(c.id, today);
    if (!inst.ok) continue;
    const d = inst.row.designated_driver_user_id;
    let subtitle = "Today’s crew chat";
    if (d) {
      const { data: u } = await supabase.from("users").select("full_name").eq("id", d).maybeSingle();
      const n = (u?.full_name as string | undefined)?.trim();
      subtitle = n ? `Driver today: ${n}` : "Driver today assigned";
    } else {
      subtitle = "Use Randomize Driver on Home to pick today’s driver";
    }
    rows.push({
      tripInstanceId: inst.row.id,
      crewId: c.id,
      crewName: c.name,
      tripDate: today,
      designatedDriverUserId: d,
      subtitle,
    });
  }
  return rows;
}
