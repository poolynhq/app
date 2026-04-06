import { supabase } from "@/lib/supabase";
import { listMyUpcomingRidesAsPassenger } from "@/lib/passengerRides";
import { listMyUpcomingRidesAsDriver } from "@/lib/driverRides";

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
      if (n) passengerLabelByRide.set(l.ride_id, n);
    }
  }

  const byId = new Map<string, RideMessageThread>();

  for (const r of passengerRides) {
    const dir = r.direction === "from_work" ? "From work" : "To work";
    byId.set(r.rideId, {
      rideId: r.rideId,
      departAt: r.departAt,
      direction: r.direction,
      title: `With ${(r.driverName ?? "").trim() || "your driver"}`,
      subtitle: `${dir} · ${formatDepart(r.departAt)}`,
    });
  }

  for (const r of driverRides) {
    if (byId.has(r.rideId)) continue;
    const dir = r.direction === "from_work" ? "From work" : "To work";
    const pax = passengerLabelByRide.get(r.rideId);
    byId.set(r.rideId, {
      rideId: r.rideId,
      departAt: r.departAt,
      direction: r.direction,
      title: pax ? `With ${pax}` : "Your drive",
      subtitle: `${dir} · ${formatDepart(r.departAt)}`,
    });
  }

  return [...byId.values()].sort((a, b) => a.departAt.localeCompare(b.departAt));
}

export async function fetchRideMessages(rideId: string): Promise<RideMessageRow[]> {
  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, sent_at")
    .eq("ride_id", rideId)
    .order("sent_at", { ascending: true });
  if (error || !msgs?.length) return [];

  const ids = [...new Set(msgs.map((m) => m.sender_id))];
  const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids);
  const nameBy = new Map((users ?? []).map((u) => [u.id, u.full_name as string | null]));

  return msgs.map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    body: m.body,
    sent_at: m.sent_at,
    sender_name: nameBy.get(m.sender_id) ?? null,
  }));
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
