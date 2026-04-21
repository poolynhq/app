import { supabase } from "@/lib/supabase";
import { computeCrewPerRiderDetourAttributedContributions } from "@/lib/costModel";
import { fetchCrewMemberHomePins, fetchCrewOwnerHomeWork } from "@/lib/crewMessaging";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { resolveCommuteGeometry, type ResolvedCommuteLeg } from "@/lib/crewRouteOrdering";
import {
  POOLYN_CREW_CREDITS_SETTLEMENT_EXPLORER_FEE_RATE,
  POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION,
  POOLYN_STOP_FEE_CENTS,
} from "@/lib/poolynPricingConfig";

export type TransactionSortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export type TransactionStatusFilter = "all" | "paid" | "pending" | "failed" | "refunded";

export type CrewTxSource = "ride_passenger" | "crew_pool";

/** Split trip share subtotal into pickup/stop vs distance pool (same model as pricing; tunable via {@link POOLYN_STOP_FEE_CENTS}). */
export function splitContributionForDisplayPoolAndPickup(shareSubtotalCents: number): {
  pickup_stop_fee_cents: number;
  pool_variable_cents: number;
} {
  const n = Math.max(0, Math.round(shareSubtotalCents));
  const pickup = Math.min(POOLYN_STOP_FEE_CENTS, n);
  const poolVar = Math.max(0, n - pickup);
  return { pickup_stop_fee_cents: pickup, pool_variable_cents: poolVar };
}

/** Labels for explorer/network fee rows (rates from `poolynPricingConfig`). */
export function explorerFeePercentLabel(
  context: "crew_settlement" | "mingle"
): string {
  const r =
    context === "crew_settlement"
      ? POOLYN_CREW_CREDITS_SETTLEMENT_EXPLORER_FEE_RATE
      : POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION;
  return `${Math.round(r * 100)}%`;
}

export type RiderTransaction = {
  kind: "rider";
  /** ride_passenger row vs crew Poolyn ledger settlement */
  tx_source?: CrewTxSource;
  /** Crew trip: rider had no pooling-day confirmation (settlement flag; disputes). */
  crew_no_day_confirmation?: boolean;
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
  /** Filter / grouping: driver user id (ride) or crew driver id (crew_pool). */
  counterparty_user_id?: string | null;
  /** Portion of trip share attributed to fixed pickup/stop (see `POOLYN_STOP_FEE_CENTS`). */
  pickup_stop_fee_cents?: number | null;
  /** Distance / pool variable portion of trip share (remainder after stop). */
  pool_variable_cents?: number | null;
  /** Crew Poolyn: crew display name for context. */
  crew_name?: string | null;
};

export type DriverTransaction = {
  kind: "driver";
  tx_source?: CrewTxSource;
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
  counterparty_user_id?: string | null;
  pickup_stop_fee_cents?: number | null;
  pool_variable_cents?: number | null;
  /** Per-rider off-corridor pickup (scaled to match settlement trip share when needed). */
  detour_only_cents?: number | null;
  crew_name?: string | null;
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
    const share = r.expected_contribution_cents ?? 0;
    const split =
      share > 0 ? splitContributionForDisplayPoolAndPickup(share) : null;
    return {
      kind: "rider" as const,
      tx_source: "ride_passenger" as const,
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
      counterparty_user_id: did ?? null,
      pickup_stop_fee_cents: split?.pickup_stop_fee_cents ?? null,
      pool_variable_cents: split?.pool_variable_cents ?? null,
    };
  });
}

type SettlementRiderLine = {
  user_id?: string;
  full_name?: string;
  credits_total_debited?: number;
  credits_contribution?: number;
  credits_crew_admin_fee?: number;
  no_pool_day_confirmation?: boolean;
};

function parseContributionCreditsByRider(
  summary: Record<string, unknown> | null | undefined
): Record<string, number> | null {
  if (!summary || typeof summary !== "object") return null;
  const raw = summary.contribution_credits_by_rider;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) {
    const n =
      typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type CrewCorridorDisplayModel = {
  equalCorridorCentsPerRider: number;
  detourCentsByUserId: Record<string, number>;
};

/**
 * Same corridor + detour math as settlement preview (owner home→work segment, member home pins).
 * Used only to label shared corridor vs off-corridor pickup; dollar amounts still follow settlement.
 */
async function tryComputeCrewCorridorDisplayModel(params: {
  crewId: string;
  payingRiderUserIds: string[];
}): Promise<CrewCorridorDisplayModel | null> {
  const { crewId, payingRiderUserIds } = params;
  if (payingRiderUserIds.length < 1) return null;

  const { data: crew, error } = await supabase
    .from("crews")
    .select("locked_route_distance_m, locked_route_duration_s, commute_pattern")
    .eq("id", crewId)
    .maybeSingle();
  if (error || !crew) return null;

  const distanceM =
    typeof crew.locked_route_distance_m === "number" ? crew.locked_route_distance_m : null;
  const durationS =
    typeof crew.locked_route_duration_s === "number" ? crew.locked_route_duration_s : null;
  if (distanceM == null || durationS == null) return null;

  const [ownerHw, pins] = await Promise.all([
    fetchCrewOwnerHomeWork(crewId),
    fetchCrewMemberHomePins(crewId),
  ]);

  const latLngByUserId: Record<string, { lat: number; lng: number } | undefined> = {};
  for (const p of pins) {
    latLngByUserId[p.userId] = { lat: p.lat, lng: p.lng };
  }

  const pattern = (crew.commute_pattern as "to_work" | "to_home" | "round_trip") ?? "to_work";
  const activeLeg: ResolvedCommuteLeg = pattern === "to_home" ? "to_home" : "to_work";
  const home = parseGeoPoint(ownerHw?.home_location ?? null);
  const work = parseGeoPoint(ownerHw?.work_location ?? null);
  const geom =
    home && work ? resolveCommuteGeometry({ pattern, activeLeg, home, work }) : null;
  if (!geom) return null;

  const det = computeCrewPerRiderDetourAttributedContributions({
    lockedRouteDistanceM: distanceM,
    lockedRouteDurationS: durationS,
    payingRiderUserIds,
    segmentStart: geom.segmentStart,
    segmentEnd: geom.segmentEnd,
    latLngByUserId,
  });
  if (!det) return null;
  return {
    equalCorridorCentsPerRider: det.equalCorridorCentsPerRider,
    detourCentsByUserId: det.detourCentsByUserId,
  };
}

/**
 * Split settlement trip share into pickup, shared pool, and optional detour line. Scales corridor vs
 * detour so the parts sum to `storedContrib` (matches what was settled).
 */
function splitCrewDriverShareForDisplay(params: {
  storedContrib: number;
  riderId: string;
  corridorModel: CrewCorridorDisplayModel | null;
}): {
  pickup_stop_fee_cents: number;
  pool_variable_cents: number;
  detour_only_cents: number | null;
} {
  const { storedContrib, riderId, corridorModel } = params;
  const n = Math.max(0, Math.round(storedContrib));
  if (n <= 0) {
    return { pickup_stop_fee_cents: 0, pool_variable_cents: 0, detour_only_cents: null };
  }
  if (!corridorModel) {
    const s = splitContributionForDisplayPoolAndPickup(n);
    return { ...s, detour_only_cents: null };
  }
  const equalBase = Math.max(0, corridorModel.equalCorridorCentsPerRider);
  const rawDet = Math.max(0, corridorModel.detourCentsByUserId[riderId] ?? 0);
  const modelTotal = equalBase + rawDet;
  if (modelTotal <= 0) {
    const s = splitContributionForDisplayPoolAndPickup(n);
    return { ...s, detour_only_cents: null };
  }
  const equalScaled = Math.round((equalBase * n) / modelTotal);
  let detScaled = n - equalScaled;
  if (detScaled < 0) detScaled = 0;
  const splitEq = splitContributionForDisplayPoolAndPickup(equalScaled);
  return {
    pickup_stop_fee_cents: splitEq.pickup_stop_fee_cents,
    pool_variable_cents: splitEq.pool_variable_cents,
    detour_only_cents: detScaled > 0 ? detScaled : null,
  };
}

export type DriverHistoryEntry =
  | { entryKind: "single"; tx: DriverTransaction }
  | {
      entryKind: "crew_trip";
      groupKey: string;
      trip_depart_at: string | null;
      created_at: string;
      crew_name: string | null;
      riders: DriverTransaction[];
    };

/** One card per listed trip; one card per crew trip with all riders grouped. */
export function groupDriverTransactionsForDisplay(
  rows: DriverTransaction[]
): DriverHistoryEntry[] {
  const singles: DriverHistoryEntry[] = [];
  const byTrip = new Map<string, DriverTransaction[]>();
  for (const r of rows) {
    if (r.tx_source !== "crew_pool" || !r.ride_id.startsWith("crew-")) {
      singles.push({ entryKind: "single", tx: r });
      continue;
    }
    const list = byTrip.get(r.ride_id) ?? [];
    list.push(r);
    byTrip.set(r.ride_id, list);
  }
  const groups: DriverHistoryEntry[] = [...byTrip.entries()].map(([groupKey, riders]) => {
    const sorted = [...riders].sort((a, b) =>
      a.counterparty_name.localeCompare(b.counterparty_name)
    );
    const head = sorted[0]!;
    return {
      entryKind: "crew_trip" as const,
      groupKey,
      trip_depart_at: head.trip_depart_at,
      created_at: head.created_at,
      crew_name: head.crew_name ?? null,
      riders: sorted,
    };
  });
  return [...singles, ...groups];
}

export function sortDriverHistoryEntries(
  items: DriverHistoryEntry[],
  sort: TransactionSortKey
): DriverHistoryEntry[] {
  const copy = [...items];
  const dateKey = (e: DriverHistoryEntry) =>
    new Date(
      e.entryKind === "single"
        ? e.tx.trip_depart_at ?? e.tx.created_at
        : e.trip_depart_at ?? e.created_at
    ).getTime();
  const amountKey = (e: DriverHistoryEntry) =>
    e.entryKind === "single"
      ? e.tx.cash_to_charge_cents ?? 0
      : e.riders.reduce((s, r) => s + (r.cash_to_charge_cents ?? 0), 0);
  copy.sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return dateKey(b) - dateKey(a);
      case "date_asc":
        return dateKey(a) - dateKey(b);
      case "amount_desc":
        return amountKey(b) - amountKey(a);
      case "amount_asc":
        return amountKey(a) - amountKey(b);
      default:
        return 0;
    }
  });
  return copy;
}

/**
 * Crew Poolyn settlements post to commute_credits_ledger (not ride_passengers). Surface them here with
 * locale-based currency formatting.
 */
export async function fetchCrewPoolynRiderLedgerRows(): Promise<RiderTransaction[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];

  const { data: ledger, error } = await supabase
    .from("commute_credits_ledger")
    .select("id, created_at, delta, reference_id")
    .eq("user_id", uid)
    .eq("reference_type", "crew_trip_instance")
    .eq("txn_type", "credit_used")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("fetchCrewPoolynRiderLedgerRows", error.message);
    return [];
  }
  if (!ledger?.length) return [];

  const tripIds = [...new Set(ledger.map((l) => l.reference_id as string).filter(Boolean))];
  const { data: trips } = await supabase
    .from("crew_trip_instances")
    .select("id, trip_finished_at, poolyn_credits_settled_at, settlement_summary, crew_id")
    .in("id", tripIds);

  const crewIdsR = [...new Set((trips ?? []).map((t) => (t as { crew_id: string }).crew_id))];
  let crewNameByR = new Map<string, string>();
  if (crewIdsR.length > 0) {
    const { data: crews } = await supabase.from("crews").select("id, name").in("id", crewIdsR);
    crewNameByR = new Map((crews ?? []).map((c) => [c.id as string, ((c.name as string) ?? "").trim() || "Crew"]));
  }

  const tripMap = new Map(
    (trips ?? []).map((t) => {
      const row = t as Record<string, unknown>;
      const cid = row.crew_id as string;
      return [
        row.id as string,
        {
          finished: (row.trip_finished_at ?? row.poolyn_credits_settled_at) as string | null,
          summary: row.settlement_summary as Record<string, unknown> | null,
          crewName: crewNameByR.get(cid) ?? "Crew",
        },
      ];
    })
  );

  return ledger.map((row) => {
    const ref = row.reference_id as string;
    const trip = tripMap.get(ref);
    const summary = trip?.summary;
    const driverName =
      typeof summary?.driver_full_name === "string" ? (summary.driver_full_name as string) : "Driver";
    let noDay = false;
    let fee = 0;
    let share = 0;
    const riders = summary?.riders as SettlementRiderLine[] | undefined;
    if (Array.isArray(riders)) {
      const mine = riders.find((r) => r.user_id === uid);
      if (mine?.no_pool_day_confirmation === true) noDay = true;
      if (typeof mine?.credits_crew_admin_fee === "number") fee = mine.credits_crew_admin_fee;
      if (typeof mine?.credits_contribution === "number") share = mine.credits_contribution;
    }
    const total = Math.abs(row.delta as number);
    if (share === 0 && fee === 0 && total > 0) {
      share = total;
    }

    const shareForSplit = share > 0 ? share : total;
    const split =
      shareForSplit > 0 ? splitContributionForDisplayPoolAndPickup(shareForSplit) : null;
    const driverUid =
      typeof summary?.driver_user_id === "string"
        ? (summary.driver_user_id as string)
        : null;

    return {
      kind: "rider" as const,
      tx_source: "crew_pool" as const,
      crew_no_day_confirmation: noDay,
      id: row.id as string,
      created_at: row.created_at as string,
      payment_status: "paid",
      cash_to_charge_cents: total,
      expected_contribution_cents: share > 0 ? share : total,
      network_fee_cents: fee,
      fee_product_type: "crew_pool",
      ride_id: `crew-${ref}`,
      trip_depart_at: trip?.finished ?? (row.created_at as string),
      poolyn_context: "crew",
      counterparty_name: driverName,
      counterparty_user_id: driverUid,
      pickup_stop_fee_cents: split?.pickup_stop_fee_cents ?? null,
      pool_variable_cents: split?.pool_variable_cents ?? null,
      crew_name: trip?.crewName ?? null,
    };
  });
}

export async function fetchCrewPoolynDriverLedgerRows(): Promise<DriverTransaction[]> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return [];

  const { data: ledger, error } = await supabase
    .from("commute_credits_ledger")
    .select("id, created_at, delta, reference_id")
    .eq("user_id", uid)
    .eq("reference_type", "crew_trip_instance")
    .eq("txn_type", "credit_earned")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("fetchCrewPoolynDriverLedgerRows", error.message);
    return [];
  }
  if (!ledger?.length) return [];

  const tripIds = [...new Set(ledger.map((l) => l.reference_id as string).filter(Boolean))];
  const { data: trips } = await supabase
    .from("crew_trip_instances")
    .select("id, trip_finished_at, poolyn_credits_settled_at, settlement_summary, crew_id")
    .in("id", tripIds);

  const crewIdsD = [...new Set((trips ?? []).map((t) => (t as { crew_id: string }).crew_id))];
  let crewNameByD = new Map<string, string>();
  if (crewIdsD.length > 0) {
    const { data: crews } = await supabase.from("crews").select("id, name").in("id", crewIdsD);
    crewNameByD = new Map((crews ?? []).map((c) => [c.id as string, ((c.name as string) ?? "").trim() || "Crew"]));
  }

  const tripMap = new Map(
    (trips ?? []).map((t) => {
      const row = t as Record<string, unknown>;
      const cid = row.crew_id as string;
      return [
        row.id as string,
        {
          finished: (row.trip_finished_at ?? row.poolyn_credits_settled_at) as string | null,
          summary: row.settlement_summary as Record<string, unknown> | null,
          crewName: crewNameByD.get(cid) ?? "Crew",
          crewId: cid,
        },
      ];
    })
  );

  const uniqueRefs = [...new Set(ledger.map((l) => l.reference_id as string).filter(Boolean))];
  const corridorModelByRef = new Map<string, CrewCorridorDisplayModel | null>();
  for (const ref of uniqueRefs) {
    const meta = tripMap.get(ref);
    if (!meta) {
      corridorModelByRef.set(ref, null);
      continue;
    }
    const summary = meta.summary;
    const ridersList = summary?.riders as SettlementRiderLine[] | undefined;
    if (!ridersList?.length) {
      corridorModelByRef.set(ref, null);
      continue;
    }
    const ids = ridersList
      .map((r) => (typeof r.user_id === "string" ? r.user_id : null))
      .filter((x): x is string => !!x);
    const model = await tryComputeCrewCorridorDisplayModel({
      crewId: meta.crewId,
      payingRiderUserIds: ids,
    });
    corridorModelByRef.set(ref, model);
  }

  return ledger.flatMap((row) => {
    const ref = row.reference_id as string;
    const trip = tripMap.get(ref);
    const summary = trip?.summary;
    const earned = Math.max(0, row.delta as number);
    const crewName = trip?.crewName ?? "Crew";
    const finishedAt = trip?.finished ?? (row.created_at as string);
    const riders = summary?.riders as SettlementRiderLine[] | undefined;
    const corridorModel = corridorModelByRef.get(ref) ?? null;

    if (!Array.isArray(riders) || riders.length === 0) {
      const split =
        earned > 0 ? splitContributionForDisplayPoolAndPickup(earned) : null;
      return [
        {
          kind: "driver" as const,
          tx_source: "crew_pool" as const,
          id: `crew-${ref}-aggregate`,
          created_at: row.created_at as string,
          payment_status: "paid",
          cash_to_charge_cents: earned,
          expected_contribution_cents: earned,
          network_fee_cents:
            typeof summary?.total_crew_admin_credits_from_explorers === "number"
              ? (summary.total_crew_admin_credits_from_explorers as number)
              : 0,
          fee_product_type: "crew_pool",
          ride_id: `crew-${ref}`,
          trip_depart_at: finishedAt,
          poolyn_context: "crew",
          counterparty_name: `${crewName} (riders)`,
          counterparty_user_id: null,
          pickup_stop_fee_cents: split?.pickup_stop_fee_cents ?? null,
          pool_variable_cents: split?.pool_variable_cents ?? null,
          detour_only_cents: null,
          crew_name: crewName,
        },
      ];
    }

    const storedMap = parseContributionCreditsByRider(summary);

    return riders.map((rider, idx) => {
      const rid =
        typeof rider.user_id === "string" && rider.user_id.length > 0
          ? rider.user_id
          : `unknown-${idx}`;
      const storedContrib = Math.max(
        0,
        storedMap?.[rid] ?? rider.credits_contribution ?? 0
      );
      const admin = Math.max(0, rider.credits_crew_admin_fee ?? 0);
      const totalDebited =
        typeof rider.credits_total_debited === "number"
          ? rider.credits_total_debited
          : storedContrib + admin;
      const split =
        storedContrib > 0
          ? splitCrewDriverShareForDisplay({
              storedContrib,
              riderId: rid,
              corridorModel,
            })
          : null;
      const paxName = displayName(
        typeof rider.full_name === "string" ? rider.full_name : null
      );

      return {
        kind: "driver" as const,
        tx_source: "crew_pool" as const,
        id: `crew-${ref}-${rid}`,
        created_at: row.created_at as string,
        payment_status: "paid",
        cash_to_charge_cents: totalDebited,
        expected_contribution_cents: storedContrib,
        network_fee_cents: admin,
        fee_product_type: "crew_pool",
        ride_id: `crew-${ref}`,
        trip_depart_at: finishedAt,
        poolyn_context: "crew",
        counterparty_name: paxName,
        counterparty_user_id: rid.startsWith("unknown-") ? null : rid,
        pickup_stop_fee_cents: split?.pickup_stop_fee_cents ?? null,
        pool_variable_cents: split?.pool_variable_cents ?? null,
        detour_only_cents: split?.detour_only_cents ?? null,
        crew_name: crewName,
      };
    });
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

  return rows.map((r) => {
    const share = r.expected_contribution_cents ?? 0;
    const split =
      share > 0 ? splitContributionForDisplayPoolAndPickup(share) : null;
    return {
      kind: "driver" as const,
      tx_source: "ride_passenger" as const,
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
      counterparty_user_id: r.passenger_id,
      pickup_stop_fee_cents: split?.pickup_stop_fee_cents ?? null,
      pool_variable_cents: split?.pool_variable_cents ?? null,
    };
  });
}

export { formatAudFromCents, formatMoneyFromCents } from "@/lib/moneyFormat";

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
