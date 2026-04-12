import { supabase } from "@/lib/supabase";
import {
  driverOrgVehiclePlain,
  listMyUpcomingRidesAsPassenger,
  type PassengerUpcomingRide,
} from "@/lib/passengerRides";
import { listMyUpcomingRidesAsDriver, type DriverUpcomingRide } from "@/lib/driverRides";

const MAX_BODY_LEN = 2000;

export type RideMessageThread = {
  rideId: string;
  departAt: string;
  direction: string;
  title: string;
  subtitle: string;
};

export type RideMessageRow = {
  id: string;
  sender_id: string;
  body: string;
  sent_at: string;
  sender_name: string | null;
};

function formatDepart(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function adhocRouteSubtitle(r: {
  adhocOriginLabel: string | null;
  adhocDestinationLabel: string | null;
  departAt: string;
}) {
  const route = `${(r.adhocOriginLabel ?? "Start").trim()} → ${(r.adhocDestinationLabel ?? "End").trim()}`;
  return `${route} · ${formatDepart(r.departAt)}`;
}

function threadTitlePassenger(r: PassengerUpcomingRide): string {
  const name = (r.driverName ?? "").trim() || "your driver";
  const sol = r.passengerSearchOriginLabel?.trim();
  const sdl = r.passengerSearchDestLabel?.trim();
  if (r.poolynContext === "adhoc" && sol && sdl) {
    return `${sol} → ${sdl}`;
  }
  if (r.poolynContext === "adhoc") {
    const t = r.adhocTripTitle?.trim();
    if (t) return `${t} · With ${name}`;
    return `With ${name} · Dated trip`;
  }
  return `With ${name}`;
}

function threadSubtitlePassenger(r: PassengerUpcomingRide): string {
  const ov = driverOrgVehiclePlain(r);
  const ovBit = ov ? ` · ${ov}` : "";
  if (r.poolynContext === "adhoc") {
    const sol = r.passengerSearchOriginLabel?.trim();
    const sdl = r.passengerSearchDestLabel?.trim();
    if (sol && sdl) {
      const driverRoute = `${(r.adhocOriginLabel ?? "Start").trim()} → ${(r.adhocDestinationLabel ?? "End").trim()}`;
      return `Driver trip: ${driverRoute} · ${formatDepart(r.departAt)}${ovBit}`;
    }
    return `${adhocRouteSubtitle({
      adhocOriginLabel: r.adhocOriginLabel,
      adhocDestinationLabel: r.adhocDestinationLabel,
      departAt: r.departAt,
    })}${ovBit}`;
  }
  const dir = r.direction === "from_work" ? "From work" : "To work";
  return `${dir} · ${formatDepart(r.departAt)}${ovBit}`;
}

function threadTitleDriver(r: DriverUpcomingRide, passengerFirstName: string | undefined): string {
  if (r.poolynContext === "adhoc") {
    const t = r.adhocTripTitle?.trim();
    if (t) return t;
    if (passengerFirstName) return `With ${passengerFirstName}`;
    return "Dated trip you posted";
  }
  return passengerFirstName ? `With ${passengerFirstName}` : "Your drive";
}

function threadSubtitleDriver(r: DriverUpcomingRide): string {
  if (r.poolynContext === "adhoc") {
    return adhocRouteSubtitle({
      adhocOriginLabel: r.adhocOriginLabel,
      adhocDestinationLabel: r.adhocDestinationLabel,
      departAt: r.departAt,
    });
  }
  const dir = r.direction === "from_work" ? "From work" : "To work";
  return `${dir} · ${formatDepart(r.departAt)}`;
}

export async function listRideMessageThreads(
  userId: string,
  options: { canDrive: boolean; isPassengerRole: boolean }
): Promise<RideMessageThread[]> {
  const [passengerRides, driverRides] = await Promise.all([
    options.isPassengerRole ? listMyUpcomingRidesAsPassenger(userId) : Promise.resolve([]),
    options.canDrive ? listMyUpcomingRidesAsDriver(userId) : Promise.resolve([]),
  ]);

  const driverRideIds = driverRides.map((r) => r.rideId);
  const passengerLabelByRide = new Map<string, string>();

  if (driverRideIds.length > 0) {
    const { data: links } = await supabase
      .from("ride_passengers")
      .select("ride_id, passenger_id")
      .in("ride_id", driverRideIds)
      .eq("status", "confirmed");
    const paxIds = [...new Set((links ?? []).map((l) => l.passenger_id))];
    const { data: users } =
      paxIds.length > 0
        ? await supabase.from("users").select("id, full_name").in("id", paxIds)
        : { data: [] as { id: string; full_name: string | null }[] };
    const nameBy = new Map((users ?? []).map((u) => [u.id, (u.full_name ?? "").trim()]));
    for (const l of links ?? []) {
      if (passengerLabelByRide.has(l.ride_id)) continue;
      const n = nameBy.get(l.passenger_id);
      if (n) {
        const first = n.split(/\s+/)[0];
        passengerLabelByRide.set(l.ride_id, first || n);
      }
    }
  }

  const byId = new Map<string, RideMessageThread>();

  for (const r of passengerRides) {
    byId.set(r.rideId, {
      rideId: r.rideId,
      departAt: r.departAt,
      direction: r.direction,
      title: threadTitlePassenger(r),
      subtitle: threadSubtitlePassenger(r),
    });
  }

  for (const r of driverRides) {
    if (byId.has(r.rideId)) continue;
    const paxFirst = passengerLabelByRide.get(r.rideId);
    byId.set(r.rideId, {
      rideId: r.rideId,
      departAt: r.departAt,
      direction: r.direction,
      title: threadTitleDriver(r, paxFirst),
      subtitle: threadSubtitleDriver(r),
    });
  }

  return [...byId.values()].sort((a, b) => a.departAt.localeCompare(b.departAt));
}

async function attachSenderNames(rows: RideMessageRow[]): Promise<RideMessageRow[]> {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map((m) => m.sender_id))];
  const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids);
  const nameBy = new Map((users ?? []).map((u) => [u.id, u.full_name as string | null]));
  return rows.map((m) => ({ ...m, sender_name: nameBy.get(m.sender_id) ?? null }));
}

/** Raw chat rows only (no ad-hoc context merge). */
export async function fetchRideMessages(rideId: string): Promise<RideMessageRow[]> {
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, sent_at")
    .eq("ride_id", rideId)
    .order("sent_at", { ascending: true });
  if (error) return [];
  const list = msgs ?? [];
  if (!list.length) return [];
  return attachSenderNames(
    list.map((m) => ({
      id: m.id,
      sender_id: m.sender_id,
      body: m.body,
      sent_at: m.sent_at,
      sender_name: null,
    }))
  );
}

function normalizeRpcChatMessages(data: unknown): RideMessageRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((raw) => {
      const m = raw as Record<string, unknown>;
      return {
        id: String(m.id ?? ""),
        sender_id: String(m.sender_id ?? ""),
        body: String(m.body ?? ""),
        sent_at: String(m.sent_at ?? ""),
        sender_name: null as string | null,
      };
    })
    .filter((m) => m.id.length > 0);
}

type RideChatMetaRow = {
  ride_id?: string;
  poolyn_context?: string | null;
  notes?: string | null;
  driver_id?: string;
  created_at?: string | null;
};

/**
 * Chat messages plus ad-hoc listing / seat-request / driver-reply lines when those are not already in `messages`
 * (e.g. accepted before server-side seed, or older data).
 * Uses SECURITY DEFINER RPCs when available so confirmed passengers still see the thread when direct `rides` RLS returns no row.
 */
export async function fetchRideMessagesWithContext(
  rideId: string,
  viewerUserId: string
): Promise<RideMessageRow[]> {
  let base: RideMessageRow[] = [];

  const { data: rpcMsgs, error: rpcMsgErr } = await supabase.rpc(
    "poolyn_fetch_ride_messages_for_participant",
    { p_ride_id: rideId }
  );
  if (!rpcMsgErr && Array.isArray(rpcMsgs)) {
    base = normalizeRpcChatMessages(rpcMsgs);
  } else {
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("id, sender_id, body, sent_at")
      .eq("ride_id", rideId)
      .order("sent_at", { ascending: true });
    base = (msgErr ? [] : (msgs ?? [])).map((m) => ({
      id: m.id,
      sender_id: m.sender_id,
      body: m.body,
      sent_at: m.sent_at,
      sender_name: null,
    }));
  }

  const bodySeen = new Set(base.map((m) => m.body.trim()));

  let ride: RideChatMetaRow | null = null;
  const { data: rpcMeta, error: rpcMetaErr } = await supabase.rpc("poolyn_get_ride_chat_meta", {
    p_ride_id: rideId,
  });
  if (!rpcMetaErr && rpcMeta && typeof rpcMeta === "object") {
    ride = rpcMeta as RideChatMetaRow;
  } else {
    const { data: rideDirect } = await supabase
      .from("rides")
      .select("id, poolyn_context, notes, driver_id, created_at")
      .eq("id", rideId)
      .maybeSingle();
    ride = rideDirect as RideChatMetaRow | null;
  }

  let bookingRows: Record<string, unknown>[] = [];
  const { data: rpcBookings, error: rpcBookErr } = await supabase.rpc(
    "poolyn_fetch_adhoc_bookings_for_chat",
    { p_ride_id: rideId }
  );
  if (!rpcBookErr && Array.isArray(rpcBookings)) {
    bookingRows = rpcBookings as Record<string, unknown>[];
  } else {
    const { data: bookings } = await supabase
      .from("adhoc_seat_bookings")
      .select("id, passenger_id, passenger_message, driver_response_message, created_at, responded_at, status")
      .eq("ride_id", rideId)
      .eq("status", "accepted");
    bookingRows = (bookings ?? []) as Record<string, unknown>[];
  }

  if (!ride) {
    return attachSenderNames(base);
  }

  const synthetic: RideMessageRow[] = [];
  const pushIf = (id: string, senderId: string, body: string, sentAt: string) => {
    const t = body.trim();
    if (!t) return;
    if (bodySeen.has(t)) return;
    bodySeen.add(t);
    synthetic.push({ id, sender_id: senderId, body: t, sent_at: sentAt, sender_name: null });
  };

  /** Same text may exist in `messages` from accept-seed; only add labeled copy if raw is missing. */
  const pushIfLabeled = (
    id: string,
    senderId: string,
    raw: string,
    sentAt: string,
    prefix: string
  ) => {
    const r = raw.trim();
    if (!r) return;
    if (bodySeen.has(r)) return;
    const labeled = `${prefix}${r}`;
    if (bodySeen.has(labeled)) return;
    bodySeen.add(labeled);
    synthetic.push({ id, sender_id: senderId, body: labeled, sent_at: sentAt, sender_name: null });
  };

  const rideIdStr = String(ride.ride_id ?? rideId);
  const driverId = String(ride.driver_id ?? "");

  if (ride.poolyn_context === "adhoc" && ride.notes?.trim()) {
    const t0 = (ride.created_at as string) ?? new Date(0).toISOString();
    pushIf(`ctx-listing-${rideIdStr}`, driverId, ride.notes.trim(), t0);
  }

  const isDriver = driverId === viewerUserId;
  for (const b of bookingRows) {
    if (!isDriver && (b.passenger_id as string) !== viewerUserId) continue;
    const reqAt = b.created_at as string;
    const accAt = (b.responded_at as string | null) ?? reqAt;
    const reqRaw = ((b.passenger_message as string) ?? "").trim();
    const accRaw = ((b.driver_response_message as string) ?? "").trim();
    pushIfLabeled(`ctx-req-${String(b.id)}`, b.passenger_id as string, reqRaw, reqAt, "Seat request: ");
    pushIfLabeled(`ctx-acc-${String(b.id)}`, driverId, accRaw, accAt, "Driver reply: ");
  }

  const merged = [...synthetic, ...base].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
  return attachSenderNames(merged);
}

export async function sendRideMessage(
  rideId: string,
  userId: string,
  body: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_BODY_LEN) return { ok: false, reason: "too_long" };

  const { error } = await supabase.from("messages").insert({
    ride_id: rideId,
    sender_id: userId,
    body: trimmed,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
