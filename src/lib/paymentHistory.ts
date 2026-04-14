import { supabase } from "@/lib/supabase";

export type TransactionSortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export type TransactionStatusFilter = "all" | "paid" | "pending" | "failed" | "refunded";

export type RiderTransaction = {
  kind: "rider";
  id: string;
  created_at: string;
  payment_status: string | null;
  cash_to_charge_cents: number | null;
  expected_contribution_cents: number | null;
  network_fee_cents: number | null;
  fee_product_type: string | null;
  ride_id: string;
  trip_depart_at: string | null;
  poolyn_context: string | null;
  /** Driver you rode with */
  counterparty_name: string;
};

export type DriverTransaction = {
  kind: "driver";
  id: string;
  created_at: string;
  payment_status: string | null;
  cash_to_charge_cents: number | null;
  expected_contribution_cents: number | null;
  network_fee_cents: number | null;
  fee_product_type: string | null;
  ride_id: string;
  trip_depart_at: string | null;
  poolyn_context: string | null;
  /** Passenger who paid */
  counterparty_name: string;
};

function displayName(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return t.length > 0 ? t : "Member";
}

/**
 * You paid as a passenger: dollars charged, status, driver name, trip time.
 */
export async function fetchRiderTransactions(): Promise<RiderTransaction[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from("ride_passengers")
    .select(
      `
      id,
      created_at,
      payment_status,
      cash_to_charge_cents,
      expected_contribution_cents,
      network_fee_cents,
      fee_product_type,
      ride_id,
      rides ( id, depart_at, poolyn_context, driver_id )
    `
    )
    .eq("passenger_id", uid)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("fetchRiderTransactions", error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    created_at: string;
    payment_status: string | null;
    cash_to_charge_cents: number | null;
    expected_contribution_cents: number | null;
    network_fee_cents: number | null;
    fee_product_type: string | null;
    ride_id: string;
    rides: {
      id: string;
      depart_at: string;
      poolyn_context: string | null;
      driver_id: string;
    } | null;
  }>;

  const driverIds = [
    ...new Set(rows.map((r) => r.rides?.driver_id).filter(Boolean) as string[]),
  ];
  let nameByUserId: Record<string, string> = {};
  if (driverIds.length > 0) {
    const { data: drivers } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", driverIds);
    nameByUserId = Object.fromEntries(
      (drivers ?? []).map((u) => [u.id as string, displayName(u.full_name as string | null)])
    );
  }

  return rows.map((r) => {
    const did = r.rides?.driver_id;
    return {
      kind: "rider" as const,
      id: r.id,
      created_at: r.created_at,
      payment_status: r.payment_status,
      cash_to_charge_cents: r.cash_to_charge_cents,
      expected_contribution_cents: r.expected_contribution_cents,
      network_fee_cents: r.network_fee_cents,
      fee_product_type: r.fee_product_type,
      ride_id: r.ride_id,
      trip_depart_at: r.rides?.depart_at ?? null,
      poolyn_context: r.rides?.poolyn_context ?? null,
      counterparty_name: did ? nameByUserId[did] ?? "Driver" : "Driver",
    };
  });
}

/**
 * You received as a driver: per-passenger payment (trip share and fees in dollars).
 */
export async function fetchDriverTransactions(): Promise<DriverTransaction[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];

  const { data: myRides, error: rideErr } = await supabase
    .from("rides")
    .select("id")
    .eq("driver_id", uid);
  if (rideErr || !myRides?.length) {
    if (rideErr) console.warn("fetchDriverTransactions rides", rideErr.message);
    return [];
  }

  const rideIds = myRides.map((x) => x.id as string);

  const { data, error } = await supabase
    .from("ride_passengers")
    .select(
      `
      id,
      created_at,
      payment_status,
      cash_to_charge_cents,
      expected_contribution_cents,
      network_fee_cents,
      fee_product_type,
      ride_id,
      passenger_id,
      rides ( id, depart_at, poolyn_context )
    `
    )
    .in("ride_id", rideIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("fetchDriverTransactions", error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    created_at: string;
    payment_status: string | null;
    cash_to_charge_cents: number | null;
    expected_contribution_cents: number | null;
    network_fee_cents: number | null;
    fee_product_type: string | null;
    ride_id: string;
    passenger_id: string;
    rides: { id: string; depart_at: string; poolyn_context: string | null } | null;
  }>;

  const passengerIds = [...new Set(rows.map((r) => r.passenger_id))];
  let nameByUserId: Record<string, string> = {};
  if (passengerIds.length > 0) {
    const { data: pax } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", passengerIds);
    nameByUserId = Object.fromEntries(
      (pax ?? []).map((u) => [u.id as string, displayName(u.full_name as string | null)])
    );
  }

  return rows.map((r) => ({
    kind: "driver" as const,
    id: r.id,
    created_at: r.created_at,
    payment_status: r.payment_status,
    cash_to_charge_cents: r.cash_to_charge_cents,
    expected_contribution_cents: r.expected_contribution_cents,
    network_fee_cents: r.network_fee_cents,
    fee_product_type: r.fee_product_type,
    ride_id: r.ride_id,
    trip_depart_at: r.rides?.depart_at ?? null,
    poolyn_context: r.rides?.poolyn_context ?? null,
    counterparty_name: nameByUserId[r.passenger_id] ?? "Passenger",
  }));
}

export function formatAudFromCents(cents: number | null | undefined): string {
  const n = (cents ?? 0) / 100;
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

export function paymentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    case "refunded":
      return "Refunded";
    default:
      return status ?? "—";
  }
}

export function filterByPaymentStatus<
  T extends { payment_status: string | null },
>(rows: T[], filter: TransactionStatusFilter): T[] {
  if (filter === "all") return rows;
  return rows.filter((r) => (r.payment_status ?? "") === filter);
}

function sortKeyAmount(r: RiderTransaction | DriverTransaction): number {
  return r.cash_to_charge_cents ?? 0;
}

function sortKeyDate(r: RiderTransaction | DriverTransaction): number {
  const t = r.trip_depart_at ?? r.created_at;
  return new Date(t).getTime();
}

export function sortTransactions<
  T extends RiderTransaction | DriverTransaction,
>(rows: T[], sort: TransactionSortKey): T[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return sortKeyDate(b) - sortKeyDate(a);
      case "date_asc":
        return sortKeyDate(a) - sortKeyDate(b);
      case "amount_desc":
        return sortKeyAmount(b) - sortKeyAmount(a);
      case "amount_asc":
        return sortKeyAmount(a) - sortKeyAmount(b);
      default:
        return 0;
    }
  });
  return copy;
}

/** @deprecated use fetchRiderTransactions */
export async function fetchMyPassengerPaymentHistory() {
  return fetchRiderTransactions();
}
