import { supabase } from "@/lib/supabase";

export type DriverUpcomingRide = {
  rideId: string;
  departAt: string;
  status: string;
  direction: string;
  origin: unknown;
  destination: unknown;
  poolynContext: string | null;
  adhocOriginLabel: string | null;
  adhocDestinationLabel: string | null;
  adhocTripTitle: string | null;
  listingNotes: string | null;
  /** Seats still available for new passengers (driver listing). */
  seatsAvailable: number;
  /** From RPC: confirmed passengers on this ride. */
  confirmedPassengerCount: number;
  /** Per confirmed rider: trip share (cents) from pricing engine. */
  passengerContributions: {
    passengerId: string;
    fullName: string | null;
    expectedContributionCents: number;
  }[];
};

export function formatDriverUpcomingCard(ride: DriverUpcomingRide): { title: string; sub: string } {
  if (ride.poolynContext === "adhoc") {
    const route = `${(ride.adhocOriginLabel ?? "Start").trim()} → ${(ride.adhocDestinationLabel ?? "End").trim()}`;
    const titled = ride.adhocTripTitle?.trim();
    const title = titled ? `${titled} · Dated trip` : "Dated trip you posted";
    const note = ride.listingNotes?.trim();
    return {
      title,
      sub: note ? `${route}. ${note}` : `${route}. Colleagues can search for a seat on this trip.`,
    };
  }
  return {
    title: `You are driving · ${ride.direction === "from_work" ? "From work" : "To work"}`,
    sub: "Navigate to pickup, message your passengers, or preview the full route as steps.",
  };
}

function mapPassengerContributions(raw: unknown): DriverUpcomingRide["passengerContributions"] {
  if (!Array.isArray(raw)) return [];
  const out: DriverUpcomingRide["passengerContributions"] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const pid = String(o.passenger_id ?? o.passengerId ?? "");
    if (!pid) continue;
    const centsRaw = o.expected_contribution_cents ?? o.expectedContributionCents;
    const cents =
      typeof centsRaw === "number" && Number.isFinite(centsRaw)
        ? Math.max(0, Math.round(centsRaw))
        : 0;
    out.push({
      passengerId: pid,
      fullName: typeof o.full_name === "string" ? o.full_name : (o.fullName as string | null) ?? null,
      expectedContributionCents: cents,
    });
  }
  return out;
}

function mapRpcDriverRide(r: Record<string, unknown>): DriverUpcomingRide {
  return {
    rideId: String(r.ride_id ?? ""),
    departAt: String(r.depart_at ?? ""),
    status: String(r.status ?? ""),
    direction: String(r.direction ?? ""),
    origin: r.origin,
    destination: r.destination,
    poolynContext: (r.poolyn_context as string | null) ?? null,
    adhocOriginLabel: (r.adhoc_origin_label as string | null) ?? null,
    adhocDestinationLabel: (r.adhoc_destination_label as string | null) ?? null,
    adhocTripTitle: (r.adhoc_trip_title as string | null) ?? null,
    listingNotes: (r.notes as string | null) ?? null,
    seatsAvailable: typeof r.seats_available === "number" ? r.seats_available : 0,
    confirmedPassengerCount:
      typeof r.confirmed_passenger_count === "number" ? r.confirmed_passenger_count : 0,
    passengerContributions: mapPassengerContributions(r.passenger_contributions ?? r.passengerContributions),
  };
}

/**
 * Lists scheduled/active rides you are driving. Prefer SECURITY DEFINER RPC so rows always match auth.uid().
 */
export async function listMyUpcomingRidesAsDriver(driverId: string): Promise<DriverUpcomingRide[]> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc("poolyn_list_my_upcoming_driver_rides");
  if (!rpcErr && Array.isArray(rpcData)) {
    return (rpcData as Record<string, unknown>[]).map(mapRpcDriverRide).filter((x) => x.rideId);
  }

  const { data, error } = await supabase
    .from("rides")
    .select(
      "id, depart_at, status, direction, origin, destination, poolyn_context, adhoc_origin_label, adhoc_destination_label, adhoc_trip_title, notes, seats_available"
    )
    .eq("driver_id", driverId)
    .in("status", ["scheduled", "active"])
    .order("depart_at", { ascending: true });

  if (error || !data?.length) return [];

  const base = data.map((r) => mapTableRide(r as Record<string, unknown>));
  const ids = base.map((x) => x.rideId);
  const counts = await countConfirmedPassengersForRides(ids);
  return base.map((row) => ({
    ...row,
    confirmedPassengerCount: counts[row.rideId] ?? 0,
    passengerContributions: [],
  }));
}

function mapTableRide(r: Record<string, unknown>): DriverUpcomingRide {
  return {
    rideId: r.id as string,
    departAt: r.depart_at as string,
    status: r.status as string,
    direction: r.direction as string,
    origin: r.origin,
    destination: r.destination,
    poolynContext: (r.poolyn_context as string | null) ?? null,
    adhocOriginLabel: (r.adhoc_origin_label as string | null) ?? null,
    adhocDestinationLabel: (r.adhoc_destination_label as string | null) ?? null,
    adhocTripTitle: (r.adhoc_trip_title as string | null) ?? null,
    listingNotes: (r.notes as string | null) ?? null,
    seatsAvailable: typeof r.seats_available === "number" ? r.seats_available : 0,
    confirmedPassengerCount: 0,
    passengerContributions: [],
  };
}

/** Confirmed passengers per ride id (for dashboard “booked” counts). */
export type MyRideAsDriverDetail = {
  rideId: string;
  departAt: string;
  status: string;
  direction: string;
  origin: unknown;
  destination: unknown;
  poolynContext: string | null;
  adhocOriginLabel: string | null;
  adhocDestinationLabel: string | null;
  adhocTripTitle: string | null;
  adhocDepartFlexDays: number;
  notes: string | null;
  seatsAvailable: number;
  baggageSlotsAvailable: number;
  confirmedPassengers: { passengerId: string; fullName: string | null }[];
  pendingSeatRequests: number;
};

export async function getMyRideAsDriver(rideId: string): Promise<MyRideAsDriverDetail | null> {
  const { data, error } = await supabase.rpc("poolyn_get_my_ride_as_driver", { p_ride_id: rideId });
  if (error || data == null || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const cp = o.confirmed_passengers;
  const passengers: { passengerId: string; fullName: string | null }[] = Array.isArray(cp)
    ? (cp as Record<string, unknown>[]).map((r) => ({
        passengerId: String(r.passenger_id ?? ""),
        fullName: (r.full_name as string | null) ?? null,
      }))
    : [];
  return {
    rideId: String(o.ride_id ?? ""),
    departAt: String(o.depart_at ?? ""),
    status: String(o.status ?? ""),
    direction: String(o.direction ?? ""),
    origin: o.origin,
    destination: o.destination,
    poolynContext: (o.poolyn_context as string | null) ?? null,
    adhocOriginLabel: (o.adhoc_origin_label as string | null) ?? null,
    adhocDestinationLabel: (o.adhoc_destination_label as string | null) ?? null,
    adhocTripTitle: (o.adhoc_trip_title as string | null) ?? null,
    adhocDepartFlexDays: typeof o.adhoc_depart_flex_days === "number" ? o.adhoc_depart_flex_days : 0,
    notes: (o.notes as string | null) ?? null,
    seatsAvailable: typeof o.seats_available === "number" ? o.seats_available : 0,
    baggageSlotsAvailable: typeof o.baggage_slots_available === "number" ? o.baggage_slots_available : 0,
    confirmedPassengers: passengers,
    pendingSeatRequests: typeof o.pending_seat_requests === "number" ? o.pending_seat_requests : 0,
  };
}

export async function countConfirmedPassengersForRides(rideIds: string[]): Promise<Record<string, number>> {
  if (rideIds.length === 0) return {};
  const { data, error } = await supabase
    .from("ride_passengers")
    .select("ride_id")
    .in("ride_id", rideIds)
    .eq("status", "confirmed");
  if (error || !data?.length) return {};
  const counts: Record<string, number> = {};
  for (const row of data) {
    const id = row.ride_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
