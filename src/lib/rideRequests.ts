import { supabase } from "@/lib/supabase";

export type RideRequestOpenRow = {
  id: string;
  passenger_id: string;
  direction: string;
  desired_depart_at: string;
  flexibility_mins: number;
  status: string;
  passenger_name: string | null;
  /** Pickup point (PostGIS geography); use parseGeoPoint in UI. */
  origin: unknown;
};

function rpcReason(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const r = (data as { reason?: string }).reason;
  return typeof r === "string" ? r : undefined;
}

export async function createCommuteRideRequest(params: {
  direction?: "to_work" | "from_work" | "custom";
  /** Omit or `null` = leave now (server sets `desired_depart_at` to now). */
  leaveInMins?: number | null;
  /** Optional fixed time (overrides leave-in). */
  desiredDepartAt?: Date | null;
  flexibilityMins?: number;
  notes?: string | null;
}): Promise<{ ok: true; rideRequestId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("create_commute_ride_request", {
    p_direction: params.direction ?? "to_work",
    p_leave_in_mins:
      params.desiredDepartAt != null ? null : (params.leaveInMins ?? null),
    p_desired_depart_at: params.desiredDepartAt?.toISOString() ?? null,
    p_flexibility_mins: params.flexibilityMins ?? 15,
    p_notes: params.notes?.trim() || null,
  });

  if (error) {
    return { ok: false, reason: error.message };
  }
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true && typeof o.ride_request_id === "string") {
    return { ok: true, rideRequestId: o.ride_request_id };
  }
  const raw = rpcReason(data) ?? "request_failed";
  if (raw === "already_has_pending_request") {
    return {
      ok: false,
      reason: "You already have an open pickup request. Cancel it first, then post again.",
    };
  }
  return { ok: false, reason: raw };
}

export async function cancelMyPendingRideRequest(
  passengerId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from("ride_requests")
    .update({ status: "cancelled" })
    .eq("passenger_id", passengerId)
    .eq("status", "pending")
    .select("id");

  if (error) return { ok: false, reason: error.message };
  if (!data?.length) return { ok: false, reason: "no_pending_request" };
  return { ok: true };
}

export async function listOpenRideRequestsForDriver(): Promise<RideRequestOpenRow[]> {
  const { data, error } = await supabase
    .from("ride_requests")
    .select("id, passenger_id, direction, desired_depart_at, flexibility_mins, status, origin")
    .eq("status", "pending")
    .order("desired_depart_at", { ascending: true });

  if (error || !data?.length) return [];

  const pids = [...new Set(data.map((r) => r.passenger_id))];
  const { data: names } = await supabase.from("users").select("id, full_name").in("id", pids);
  const nameById = new Map((names ?? []).map((u) => [u.id, u.full_name]));

  return data.map((row) => ({
    id: row.id,
    passenger_id: row.passenger_id,
    direction: row.direction,
    desired_depart_at: row.desired_depart_at,
    flexibility_mins: row.flexibility_mins,
    status: row.status,
    passenger_name: nameById.get(row.passenger_id) ?? null,
    origin: row.origin,
  }));
}

export async function acceptRideRequestAsDriver(
  requestId: string
): Promise<{ ok: true; rideId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("accept_ride_request_as_driver", {
    p_request_id: requestId,
  });

  if (error) {
    return { ok: false, reason: error.message };
  }
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true && typeof o.ride_id === "string") {
    return { ok: true, rideId: o.ride_id };
  }
  return { ok: false, reason: rpcReason(data) ?? "accept_failed" };
}

export type MyPendingRideRequestRow = Pick<
  RideRequestOpenRow,
  "id" | "direction" | "desired_depart_at" | "flexibility_mins" | "status"
> & { expires_at: string };

export async function listMyPendingRideRequests(passengerId: string): Promise<MyPendingRideRequestRow[]> {
  const { data, error } = await supabase
    .from("ride_requests")
    .select("id, direction, desired_depart_at, flexibility_mins, status, expires_at")
    .eq("passenger_id", passengerId)
    .eq("status", "pending")
    .order("desired_depart_at", { ascending: true });

  if (error || !data) return [];
  return data as MyPendingRideRequestRow[];
}

/** Marks pending pickup requests past expires_at as expired (server + optional notification). */
export async function runExpireStalePickupRequests(): Promise<void> {
  const { error } = await supabase.rpc("expire_pending_ride_requests");
  if (error && __DEV__) {
    console.warn("[rideRequests] expire_pending_ride_requests:", error.message);
  }
}
