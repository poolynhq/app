import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { parseGeoPoint } from "@/lib/parseGeoPoint";

const MAX_BODY_LEN = 2000;

/** Max crews a single user may belong to (join + create). */
export const MAX_CREWS_PER_USER = 3;

export type CrewCommutePattern = "to_work" | "to_home" | "round_trip";

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
};

export type CrewTripInstanceRow = {
  id: string;
  crew_id: string;
  trip_date: string;
  designated_driver_user_id: string | null;
  excluded_pickup_user_ids: string[];
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
      "id, name, invite_code, org_id, commute_pattern, sticker_emoji, sticker_image_url, locked_route_distance_m, locked_route_duration_s"
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
  const { data: crew, error: e1 } = await supabase
    .from("crews")
    .insert({
      name,
      created_by: params.userId,
      org_id: params.orgId,
      commute_pattern: params.commutePattern ?? "to_work",
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
    too_many_crews: `You can be in up to ${MAX_CREWS_PER_USER} crews. Leave one under Profile → Poolyn Crews before joining another.`,
  };
  return { ok: false, reason: human[reason] ?? reason };
}

export async function getOrCreateTripInstance(
  crewId: string,
  tripDate: string
): Promise<{ ok: true; row: CrewTripInstanceRow } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from("crew_trip_instances")
    .upsert({ crew_id: crewId, trip_date: tripDate }, { onConflict: "crew_id,trip_date" })
    .select("id, crew_id, trip_date, designated_driver_user_id, excluded_pickup_user_ids")
    .single();
  if (error || !data) return { ok: false, reason: error?.message ?? "trip_instance_failed" };
  const row = data as Record<string, unknown>;
  const excluded = row.excluded_pickup_user_ids;
  return {
    ok: true,
    row: {
      id: row.id as string,
      crew_id: row.crew_id as string,
      trip_date: row.trip_date as string,
      designated_driver_user_id: (row.designated_driver_user_id as string | null) ?? null,
      excluded_pickup_user_ids: Array.isArray(excluded)
        ? (excluded as string[])
        : [],
    },
  };
}

export async function fetchCrewTripInstance(
  tripInstanceId: string
): Promise<CrewTripInstanceRow | null> {
  const { data, error } = await supabase
    .from("crew_trip_instances")
    .select("id, crew_id, trip_date, designated_driver_user_id, excluded_pickup_user_ids")
    .eq("id", tripInstanceId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const excluded = row.excluded_pickup_user_ids;
  return {
    id: row.id as string,
    crew_id: row.crew_id as string,
    trip_date: row.trip_date as string,
    designated_driver_user_id: (row.designated_driver_user_id as string | null) ?? null,
    excluded_pickup_user_ids: Array.isArray(excluded) ? (excluded as string[]) : [],
  };
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
      "id, name, invite_code, org_id, commute_pattern, sticker_emoji, sticker_image_url, locked_route_distance_m, locked_route_duration_s"
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
      subtitle = "Roll dice to pick today’s driver";
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
