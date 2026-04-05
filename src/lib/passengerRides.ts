import { supabase } from "@/lib/supabase";

export type PassengerUpcomingRide = {
  rideId: string;
  departAt: string;
  status: string;
  direction: string;
  driverName: string | null;
  origin: unknown;
  destination: unknown;
};

/** Confirmed seats on rides that are still scheduled or in progress. */
export async function listMyUpcomingRidesAsPassenger(
  passengerId: string
): Promise<PassengerUpcomingRide[]> {
  const { data: links, error: linkErr } = await supabase
    .from("ride_passengers")
    .select("ride_id")
    .eq("passenger_id", passengerId)
    .eq("status", "confirmed");

  if (linkErr || !links?.length) return [];

  const rideIds = [...new Set(links.map((l) => l.ride_id))];

  const { data: rides, error: rideErr } = await supabase
    .from("rides")
    .select("id, depart_at, status, direction, origin, destination, driver_id")
    .in("id", rideIds)
    .in("status", ["scheduled", "active"]);

  if (rideErr || !rides?.length) return [];

  const driverIds = [...new Set(rides.map((r) => r.driver_id))];
  const { data: drivers } = await supabase.from("users").select("id, full_name").in("id", driverIds);
  const nameById = new Map((drivers ?? []).map((d) => [d.id, d.full_name as string | null]));

  return rides.map((r) => ({
    rideId: r.id,
    departAt: r.depart_at,
    status: r.status,
    direction: r.direction,
    driverName: nameById.get(r.driver_id) ?? null,
    origin: r.origin,
    destination: r.destination,
  }));
}
