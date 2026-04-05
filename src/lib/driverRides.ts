import { supabase } from "@/lib/supabase";

export type DriverUpcomingRide = {
  rideId: string;
  departAt: string;
  status: string;
  direction: string;
};

export async function listMyUpcomingRidesAsDriver(driverId: string): Promise<DriverUpcomingRide[]> {
  const { data, error } = await supabase
    .from("rides")
    .select("id, depart_at, status, direction")
    .eq("driver_id", driverId)
    .in("status", ["scheduled", "active"])
    .order("depart_at", { ascending: true });

  if (error || !data?.length) return [];

  return data.map((r) => ({
    rideId: r.id,
    departAt: r.depart_at,
    status: r.status,
    direction: r.direction,
  }));
}
