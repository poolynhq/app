import { supabase } from "@/lib/supabase";
import { normalizeRpcGeoJson } from "@/lib/parseGeoPoint";

export type PassengerUpcomingRide = {
  rideId: string;
  departAt: string;
  status: string;
  direction: string;
  driverName: string | null;
  origin: unknown;
  destination: unknown;
  poolynContext: string | null;
  adhocOriginLabel: string | null;
  adhocDestinationLabel: string | null;
  adhocTripTitle: string | null;
  /** Driver listing notes (adhoc: stops, route hints). */
  listingNotes: string | null;
  /** Confirmed passenger pickup (GeoJSON), same shape as origin/destination from RPC. */
  passengerPickup: unknown | null;
  /** Labels from the rider search flow (Adelaide → Mildura). */
  passengerSearchOriginLabel: string | null;
  passengerSearchDestLabel: string | null;
  /** Rider "going near" pin for steps end (GeoJSON). */
  passengerSearchDest: unknown | null;
  /** Driver workplace (same network). */
  driverOrganisationName: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColour: string | null;
  vehiclePlate: string | null;
  /** From ride_passengers.expected_contribution_cents (trip share before cash fees). */
  expectedContributionCents: number;
};

/** Supabase RPC JSON may expose snake_case or camelCase depending on client/version. */
function strFromRpc(r: Record<string, unknown>, snake: string, camel: string): string | null {
  const a = r[snake];
  const b = r[camel];
  if (typeof a === "string" && a.trim()) return a.trim();
  if (typeof b === "string" && b.trim()) return b.trim();
  return null;
}

/** "City, State, Country" → "City" for compact driver trip line. */
function shortPlaceLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  return t.split(",")[0]?.trim() ?? t;
}

function driverTripRouteShort(ride: PassengerUpcomingRide): string {
  const a = shortPlaceLabel(ride.adhocOriginLabel);
  const b = shortPlaceLabel(ride.adhocDestinationLabel);
  if (!a && !b) return "Driver trip";
  return `${a || "Start"} → ${b || "End"}`;
}

/** Workplace and car (organisation, make/model, colour/plate). Empty if unknown. */
export function driverOrgVehiclePlain(ride: PassengerUpcomingRide): string {
  const bits: string[] = [];
  const org = ride.driverOrganisationName?.trim();
  if (org) bits.push(org);
  const mk = ride.vehicleMake?.trim();
  const md = ride.vehicleModel?.trim();
  const vm = [mk, md].filter(Boolean).join(" ").trim();
  if (vm) bits.push(vm);
  const plate = ride.vehiclePlate?.trim();
  const colour = ride.vehicleColour?.trim();
  if (plate && colour) bits.push(`${colour} · ${plate}`);
  else if (plate) bits.push(plate);
  else if (colour) bits.push(colour);
  return bits.join(" · ");
}

function formatDepartLabel(iso: string) {
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

/** Titles for My rides and Messages inbox for rides you are on as a passenger. */
export function formatPassengerUpcomingCard(ride: PassengerUpcomingRide): {
  title: string;
  meta: string;
  sub: string;
} {
  const meta = formatDepartLabel(ride.departAt);
  const who = (ride.driverName ?? "").trim() || "Driver";

  if (ride.poolynContext === "adhoc") {
    const driverRouteShort = driverTripRouteShort(ride);
    const orgVeh = driverOrgVehiclePlain(ride);
    const orgVehBit = orgVeh ? ` · ${orgVeh}` : "";
    const sol = ride.passengerSearchOriginLabel?.trim();
    const sdl = ride.passengerSearchDestLabel?.trim();
    if (sol && sdl) {
      const note = ride.listingNotes?.trim();
      return {
        title: `${sol} → ${sdl}`,
        meta,
        sub: `Driver trip: ${driverRouteShort} · ${who}${orgVehBit}${note ? ` · ${note}` : ""}. Pickup is on your Home map.`,
      };
    }
    const titled = ride.adhocTripTitle?.trim();
    const title = titled ? `${titled} · ${who}` : `${who} · Dated trip`;
    const note = ride.listingNotes?.trim();
    return {
      title,
      meta,
      sub: note
        ? `Driver trip: ${driverRouteShort} · ${who}${orgVehBit} · ${note}. Pickup is on your Home map.`
        : `Driver trip: ${driverRouteShort} · ${who}${orgVehBit}. Pickup is on your Home map.`,
    };
  }

  const dir = ride.direction === "from_work" ? "From work" : "To work";
  const orgVeh = driverOrgVehiclePlain(ride);
  return {
    title: `${who} · ${dir}`,
    meta,
    sub: orgVeh.length
      ? `${orgVeh}. Pickup is highlighted on your Home map.`
      : "Pickup is highlighted on your Home map.",
  };
}

function mapRpcPassengerRide(r: Record<string, unknown>): PassengerUpcomingRide {
  return {
    rideId: String(r.ride_id ?? r.rideId ?? ""),
    departAt: String(r.depart_at ?? r.departAt ?? ""),
    status: String(r.status ?? ""),
    direction: String(r.direction ?? ""),
    driverName: strFromRpc(r, "driver_full_name", "driverFullName"),
    origin: normalizeRpcGeoJson(r.origin),
    destination: normalizeRpcGeoJson(r.destination),
    poolynContext: (r.poolyn_context ?? r.poolynContext) as string | null,
    adhocOriginLabel: strFromRpc(r, "adhoc_origin_label", "adhocOriginLabel"),
    adhocDestinationLabel: strFromRpc(r, "adhoc_destination_label", "adhocDestinationLabel"),
    adhocTripTitle: strFromRpc(r, "adhoc_trip_title", "adhocTripTitle"),
    listingNotes:
      typeof r.notes === "string"
        ? r.notes
        : typeof (r as { listingNotes?: unknown }).listingNotes === "string"
          ? ((r as { listingNotes: string }).listingNotes as string)
          : null,
    passengerPickup: normalizeRpcGeoJson(r.passenger_pickup ?? r.passengerPickup),
    passengerSearchOriginLabel: strFromRpc(
      r,
      "passenger_search_origin_label",
      "passengerSearchOriginLabel"
    ),
    passengerSearchDestLabel: strFromRpc(r, "passenger_search_dest_label", "passengerSearchDestLabel"),
    passengerSearchDest: normalizeRpcGeoJson(r.passenger_search_dest ?? r.passengerSearchDest),
    driverOrganisationName: strFromRpc(r, "driver_organisation_name", "driverOrganisationName"),
    vehicleMake: strFromRpc(r, "vehicle_make", "vehicleMake"),
    vehicleModel: strFromRpc(r, "vehicle_model", "vehicleModel"),
    vehicleColour: strFromRpc(r, "vehicle_colour", "vehicleColour"),
    vehiclePlate: strFromRpc(r, "vehicle_plate", "vehiclePlate"),
    expectedContributionCents: numFromRpc(r, "expected_contribution_cents", "expectedContributionCents"),
  };
}

function numFromRpc(r: Record<string, unknown>, snake: string, camel: string): number {
  const a = r[snake];
  const b = r[camel];
  if (typeof a === "number" && Number.isFinite(a)) return Math.max(0, Math.round(a));
  if (typeof b === "number" && Number.isFinite(b)) return Math.max(0, Math.round(b));
  if (typeof a === "string" && a.trim()) {
    const n = Number(a);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return 0;
}

function mapTablePassengerRide(
  r: Record<string, unknown>,
  driverName: string | null
): PassengerUpcomingRide {
  return {
    rideId: r.id as string,
    departAt: r.depart_at as string,
    status: r.status as string,
    direction: r.direction as string,
    driverName,
    origin: r.origin,
    destination: r.destination,
    poolynContext: (r.poolyn_context as string | null) ?? null,
    adhocOriginLabel: (r.adhoc_origin_label as string | null) ?? null,
    adhocDestinationLabel: (r.adhoc_destination_label as string | null) ?? null,
    adhocTripTitle: (r.adhoc_trip_title as string | null) ?? null,
    listingNotes: (r.notes as string | null) ?? null,
    passengerPickup: null,
    passengerSearchOriginLabel: null,
    passengerSearchDestLabel: null,
    passengerSearchDest: null,
    driverOrganisationName: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleColour: null,
    vehiclePlate: null,
    expectedContributionCents: 0,
  };
}

async function enrichPassengerRidesFromBookings(
  rows: PassengerUpcomingRide[],
  passengerId: string
): Promise<PassengerUpcomingRide[]> {
  const adhocRideIds = [...new Set(rows.filter((r) => r.poolynContext === "adhoc").map((r) => r.rideId))];
  if (!adhocRideIds.length) return rows;

  const { data: bookings, error: bookingErr } = await supabase
    .from("adhoc_seat_bookings")
    .select(
      "ride_id, passenger_search_origin_label, passenger_search_dest_label, passenger_search_dest, responded_at, created_at"
    )
    .in("ride_id", adhocRideIds)
    .eq("passenger_id", passengerId)
    .eq("status", "accepted");

  if (bookingErr) return rows;

  const sorted = [...(bookings ?? [])].sort((a, b) => {
    const ta = new Date((a.responded_at as string) ?? (a.created_at as string)).getTime();
    const tb = new Date((b.responded_at as string) ?? (b.created_at as string)).getTime();
    return tb - ta;
  });
  const byRide = new Map<string, (typeof sorted)[0]>();
  for (const b of sorted) {
    const id = b.ride_id as string;
    if (!byRide.has(id)) byRide.set(id, b);
  }

  return rows.map((r) => {
    if (r.poolynContext !== "adhoc") return r;
    const b = byRide.get(r.rideId);
    if (!b) return r;
    const oLabel = (b.passenger_search_origin_label as string | null)?.trim() || null;
    const dLabel = (b.passenger_search_dest_label as string | null)?.trim() || null;
    const pDest = normalizeRpcGeoJson(b.passenger_search_dest);
    return {
      ...r,
      passengerSearchOriginLabel: r.passengerSearchOriginLabel?.trim() || oLabel,
      passengerSearchDestLabel: r.passengerSearchDestLabel?.trim() || dLabel,
      passengerSearchDest: r.passengerSearchDest ?? pDest,
    };
  });
}

/** Confirmed seats on rides that are still scheduled or in progress. */
export async function listMyUpcomingRidesAsPassenger(
  passengerId: string
): Promise<PassengerUpcomingRide[]> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc("poolyn_list_my_upcoming_passenger_rides");
  if (!rpcErr && Array.isArray(rpcData)) {
    const mapped = (rpcData as Record<string, unknown>[])
      .map(mapRpcPassengerRide)
      .filter((x) => x.rideId);
    return enrichPassengerRidesFromBookings(mapped, passengerId);
  }

  const { data: links, error: linkErr } = await supabase
    .from("ride_passengers")
    .select("ride_id")
    .eq("passenger_id", passengerId)
    .eq("status", "confirmed");

  if (linkErr || !links?.length) return [];

  const rideIds = [...new Set(links.map((l) => l.ride_id))];

  const { data: rides, error: rideErr } = await supabase
    .from("rides")
    .select(
      "id, depart_at, status, direction, origin, destination, driver_id, vehicle_id, poolyn_context, adhoc_origin_label, adhoc_destination_label, adhoc_trip_title, notes"
    )
    .in("id", rideIds)
    .in("status", ["scheduled", "active"]);

  if (rideErr || !rides?.length) return [];

  const { data: pickups } = await supabase
    .from("ride_passengers")
    .select("ride_id, pickup_point, expected_contribution_cents")
    .eq("passenger_id", passengerId)
    .eq("status", "confirmed")
    .in("ride_id", rides.map((r) => r.id));
  const pickupByRide = new Map(
    (pickups ?? []).map((p) => [p.ride_id as string, p])
  );

  const driverIds = [...new Set(rides.map((r) => r.driver_id))];
  const { data: drivers } = await supabase.from("users").select("id, full_name, org_id").in("id", driverIds);
  const nameById = new Map((drivers ?? []).map((d) => [d.id, d.full_name as string | null]));
  const orgByDriver = new Map((drivers ?? []).map((d) => [d.id, d.org_id as string | null]));

  const vehicleIds = [...new Set(rides.map((r) => r.vehicle_id).filter(Boolean))] as string[];
  const { data: vehRows } =
    vehicleIds.length > 0
      ? await supabase.from("vehicles").select("id, make, model, colour, plate").in("id", vehicleIds)
      : { data: [] as Record<string, unknown>[] };
  const vehById = new Map((vehRows ?? []).map((v) => [v.id as string, v]));

  const orgIds = [...new Set((drivers ?? []).map((d) => d.org_id).filter(Boolean))] as string[];
  const { data: orgRows } =
    orgIds.length > 0
      ? await supabase.from("organisations").select("id, name").in("id", orgIds)
      : { data: [] as { id: string; name: string | null }[] };
  const orgNameById = new Map((orgRows ?? []).map((o) => [o.id, o.name as string | null]));

  const mapped = rides.map((r) => {
    const row = mapTablePassengerRide(r as Record<string, unknown>, nameById.get(r.driver_id) ?? null);
    const pr = pickupByRide.get(r.id);
    const pu = pr?.pickup_point ?? null;
    const ec =
      typeof pr?.expected_contribution_cents === "number"
        ? Math.max(0, pr.expected_contribution_cents)
        : 0;
    const oid = orgByDriver.get(r.driver_id);
    const orgName = oid ? orgNameById.get(oid) ?? null : null;
    const v = r.vehicle_id ? vehById.get(r.vehicle_id as string) : undefined;
    return {
      ...row,
      passengerPickup: pu ?? null,
      expectedContributionCents: ec,
      driverOrganisationName: orgName?.trim() || null,
      vehicleMake: (v?.make as string | undefined)?.trim() || null,
      vehicleModel: (v?.model as string | undefined)?.trim() || null,
      vehicleColour: (v?.colour as string | null | undefined)?.trim() || null,
      vehiclePlate: (v?.plate as string | null | undefined)?.trim() || null,
    };
  });
  return enrichPassengerRidesFromBookings(mapped, passengerId);
}
