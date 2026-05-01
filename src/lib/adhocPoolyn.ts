import { supabase } from "@/lib/supabase";

function rpcReason(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const r = (data as { reason?: string }).reason;
  return typeof r === "string" ? r : undefined;
}

export type AdhocSearchListingRow = {
  ride_id: string;
  depart_at: string;
  adhoc_trip_title?: string | null;
  adhoc_origin_label: string | null;
  adhoc_destination_label: string | null;
  /** Driver notes on the listing (stops, breaks, route hints). */
  listing_notes?: string | null;
  seats_available: number;
  baggage_slots_available: number;
  driver_first_name: string;
  /** Full name from profile (same field riders see in search). */
  driver_full_name?: string | null;
  organisation_name?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_label: string;
  vehicle_colour: string | null;
  driver_start_km_from_search_origin: number;
  driver_end_km_from_search_dest: number;
  /** Straight-line km between your leaving and going pins (search corridor length). */
  rider_corridor_km?: number;
  /** Heuristic preview in cents (18c per km of corridor, min $3); final amount uses pickup to drop after booking. */
  estimated_contribution_cents_preview?: number;
};

/** Local calendar YYYY-MM-DD (device timezone). */
export function localCalendarDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function poolynSearchAdhocListings(params: {
  /** Inclusive first and last calendar day of the search (local dates). */
  riderDateFrom: string;
  riderDateTo: string;
  nearOriginLat: number;
  nearOriginLng: number;
  nearDestLat: number;
  nearDestLng: number;
  radiusKm?: number;
  needsBaggage: boolean;
  /** IANA zone for interpreting driver departure local calendar day (default RPC). */
  departTimezone?: string;
}): Promise<AdhocSearchListingRow[]> {
  const { data, error } = await supabase.rpc("poolyn_search_adhoc_listings", {
    p_rider_date_from: params.riderDateFrom,
    p_rider_date_to: params.riderDateTo,
    p_near_origin_lat: params.nearOriginLat,
    p_near_origin_lng: params.nearOriginLng,
    p_near_dest_lat: params.nearDestLat,
    p_near_dest_lng: params.nearDestLng,
    p_radius_km: params.radiusKm ?? 80,
    p_needs_baggage: params.needsBaggage,
    p_depart_tz: params.departTimezone ?? "Australia/Adelaide",
  });
  if (error || !Array.isArray(data)) return [];
  return data as AdhocSearchListingRow[];
}

export async function poolynCreateAdhocRecurringSeries(params: {
  recurrencePattern: "weekly" | "fortnightly" | "monthly";
  anchorDate: string;
  repeatUntilDate: string;
  isRoundTrip: boolean;
}): Promise<{ ok: true; seriesId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_create_adhoc_recurring_series", {
    p_recurrence_pattern: params.recurrencePattern,
    p_anchor_date: params.anchorDate,
    p_repeat_until_date: params.repeatUntilDate,
    p_is_round_trip: params.isRoundTrip,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true && typeof o.series_id === "string") {
    return { ok: true, seriesId: o.series_id };
  }
  return { ok: false, reason: rpcReason(data) ?? "series_failed" };
}

export async function poolynCreateAdhocListing(params: {
  departAt: Date;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  originLabel: string;
  destLabel: string;
  passengerSeatsAvailable: number;
  baggageSlots: number;
  tripTitle?: string | null;
  departFlexDays: number;
  listingNotes?: string | null;
  /** Whole-trip toll total in cents (optional). Shared across riders when seats fill. */
  tollCents?: number;
  /** Whole-trip parking total in cents (optional). Shared across riders. */
  parkingCents?: number;
  /** When batch-posting a recurring plan, links rows for batch editing and future messaging. */
  adhocRecurringSeriesId?: string | null;
}): Promise<{ ok: true; rideId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_create_adhoc_listing", {
    p_depart_at: params.departAt.toISOString(),
    p_origin_lat: params.originLat,
    p_origin_lng: params.originLng,
    p_dest_lat: params.destLat,
    p_dest_lng: params.destLng,
    p_origin_label: params.originLabel,
    p_dest_label: params.destLabel,
    p_passenger_seats_available: params.passengerSeatsAvailable,
    p_baggage_slots: params.baggageSlots,
    p_trip_title: params.tripTitle?.trim() || null,
    p_depart_flex_days: params.departFlexDays,
    p_notes: params.listingNotes?.trim() || null,
    p_toll_cents: params.tollCents ?? null,
    p_parking_cents: params.parkingCents ?? null,
    p_adhoc_recurring_series_id: params.adhocRecurringSeriesId ?? null,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true && typeof o.ride_id === "string") {
    return { ok: true, rideId: o.ride_id };
  }
  return { ok: false, reason: rpcReason(data) ?? "create_failed" };
}

export async function poolynRequestAdhocSeat(params: {
  rideId: string;
  pickupLat: number;
  pickupLng: number;
  message: string;
  needsBaggage: boolean;
  /** Rider search "going near" (steps + My rides use this as the leg end). */
  searchDestLat?: number;
  searchDestLng?: number;
  searchOriginLabel?: string | null;
  searchDestLabel?: string | null;
}): Promise<{ ok: true; bookingId: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_request_adhoc_seat", {
    p_ride_id: params.rideId,
    p_pickup_lat: params.pickupLat,
    p_pickup_lng: params.pickupLng,
    p_message: params.message,
    p_needs_baggage: params.needsBaggage,
    p_dest_lat: params.searchDestLat ?? null,
    p_dest_lng: params.searchDestLng ?? null,
    p_search_origin_label: params.searchOriginLabel?.trim() || null,
    p_search_dest_label: params.searchDestLabel?.trim() || null,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true && typeof o.booking_id === "string") {
    return { ok: true, bookingId: o.booking_id };
  }
  const raw = rpcReason(data) ?? "request_failed";
  const friendly: Record<string, string> = {
    no_seats: "No seats left on this trip.",
    no_baggage_slots: "Baggage space is full for this trip.",
    already_pending: "You already have a pending request for this trip.",
    org_mismatch: "This listing is not available for your workplace.",
    own_ride: "You cannot book your own trip.",
  };
  return { ok: false, reason: friendly[raw] ?? raw };
}

export async function poolynRespondAdhocSeatBooking(params: {
  bookingId: string;
  accept: boolean;
  message: string;
}): Promise<{ ok: true; status: string; rideId?: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_respond_adhoc_seat_booking", {
    p_booking_id: params.bookingId,
    p_accept: params.accept,
    p_message: params.message,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true && typeof o.status === "string") {
    return {
      ok: true,
      status: o.status,
      rideId: typeof o.ride_id === "string" ? o.ride_id : undefined,
    };
  }
  return { ok: false, reason: rpcReason(data) ?? "respond_failed" };
}

export type AdhocPendingBookingRow = {
  id: string;
  ride_id: string;
  passenger_id: string;
  passenger_message: string | null;
  needs_checked_bag: boolean;
  pickup_km_from_ride_origin: number | null;
  created_at: string;
  ride: {
    depart_at: string;
    adhoc_origin_label: string | null;
    adhoc_destination_label: string | null;
  };
  passenger: {
    full_name: string | null;
    avatar_url: string | null;
  };
};

export async function listPendingAdhocBookingsForDriver(
  driverId: string
): Promise<AdhocPendingBookingRow[]> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc("poolyn_list_pending_adhoc_bookings_for_driver");
  if (!rpcErr && Array.isArray(rpcData)) {
    return (rpcData as Record<string, unknown>[]).map((row) => {
      const ride = row.ride as Record<string, unknown> | undefined;
      const passenger = row.passenger as Record<string, unknown> | undefined;
      return {
        id: String(row.id ?? ""),
        ride_id: String(row.ride_id ?? ""),
        passenger_id: String(row.passenger_id ?? ""),
        passenger_message: (row.passenger_message as string | null) ?? null,
        needs_checked_bag: Boolean(row.needs_checked_bag),
        pickup_km_from_ride_origin:
          row.pickup_km_from_ride_origin != null ? Number(row.pickup_km_from_ride_origin) : null,
        created_at: String(row.created_at ?? ""),
        ride: {
          depart_at: String(ride?.depart_at ?? ""),
          adhoc_origin_label: (ride?.adhoc_origin_label as string | null) ?? null,
          adhoc_destination_label: (ride?.adhoc_destination_label as string | null) ?? null,
        },
        passenger: {
          full_name: (passenger?.full_name as string | null) ?? null,
          avatar_url: (passenger?.avatar_url as string | null) ?? null,
        },
      };
    });
  }

  const { data: rides, error: e1 } = await supabase
    .from("rides")
    .select("id, depart_at, adhoc_origin_label, adhoc_destination_label")
    .eq("driver_id", driverId)
    .eq("poolyn_context", "adhoc");
  if (e1 || !rides?.length) return [];

  const rideIds = rides.map((r) => r.id);
  const { data: bookings, error: e2 } = await supabase
    .from("adhoc_seat_bookings")
    .select("id, ride_id, passenger_id, passenger_message, needs_checked_bag, pickup_km_from_ride_origin, created_at")
    .in("ride_id", rideIds)
    .eq("status", "pending");
  if (e2 || !bookings?.length) return [];

  const rideById = new Map(rides.map((r) => [r.id, r]));
  const pids = [...new Set(bookings.map((b) => b.passenger_id))];
  const { data: users } = await supabase.from("users").select("id, full_name, avatar_url").in("id", pids);
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  return bookings.map((b) => {
    const r = rideById.get(b.ride_id);
    const p = userById.get(b.passenger_id);
    return {
      id: b.id,
      ride_id: b.ride_id,
      passenger_id: b.passenger_id,
      passenger_message: b.passenger_message,
      needs_checked_bag: b.needs_checked_bag,
      pickup_km_from_ride_origin: b.pickup_km_from_ride_origin,
      created_at: b.created_at,
      ride: {
        depart_at: r?.depart_at ?? "",
        adhoc_origin_label: r?.adhoc_origin_label ?? null,
        adhoc_destination_label: r?.adhoc_destination_label ?? null,
      },
      passenger: {
        full_name: p?.full_name ?? null,
        avatar_url: p?.avatar_url ?? null,
      },
    };
  });
}

export type AdhocPassengerPendingRow = {
  id: string;
  ride_id: string;
  passenger_message: string | null;
  needs_checked_bag: boolean;
  created_at: string;
  /** Rider search corridor labels (when saved at request time). */
  passengerSearchOriginLabel: string | null;
  passengerSearchDestLabel: string | null;
  ride: {
    depart_at: string;
    adhoc_origin_label: string | null;
    adhoc_destination_label: string | null;
    adhoc_trip_title: string | null;
    listing_notes: string | null;
  };
  driverFirstName: string | null;
};

function strFromRpcRow(r: Record<string, unknown>, snake: string, camel: string): string | null {
  const a = r[snake];
  const b = r[camel];
  if (typeof a === "string" && a.trim()) return a.trim();
  if (typeof b === "string" && b.trim()) return b.trim();
  return null;
}

/** "City, State" → "City" for one-line route copy. */
function shortPlaceLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  return t.split(",")[0]?.trim() ?? t;
}

/** Title + subtitle for pending passenger cards (rider corridor vs driver listing). */
export function formatAdhocPassengerPendingCard(row: AdhocPassengerPendingRow): {
  title: string;
  meta: string;
  sub: string;
} {
  const sol = row.passengerSearchOriginLabel?.trim();
  const sdl = row.passengerSearchDestLabel?.trim();
  const driverRoute = `${shortPlaceLabel(row.ride.adhoc_origin_label) || "Start"} → ${
    shortPlaceLabel(row.ride.adhoc_destination_label) || "End"
  }`;
  const who = row.driverFirstName?.trim() || "Driver";
  const tripTitle = row.ride.adhoc_trip_title?.trim();
  const notes = row.ride.listing_notes?.trim();
  const title =
    sol && sdl ? `${sol} → ${sdl}` : tripTitle ? `${tripTitle} · ${who}` : `Seat request · ${who}`;
  const meta = formatAdhocPendingDepart(row.ride.depart_at);
  const subParts = [`Driver trip: ${driverRoute}`, who];
  if (notes) subParts.push(notes);
  return {
    title,
    meta,
    sub: `${subParts.join(" · ")}. Waiting for the driver to respond.`,
  };
}

function formatAdhocPendingDepart(iso: string) {
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

function mapRpcPendingAdhocRow(o: Record<string, unknown>): AdhocPassengerPendingRow | null {
  const id = String(o.booking_id ?? o.id ?? "");
  const rideId = String(o.ride_id ?? "");
  if (!id || !rideId) return null;
  const df = strFromRpcRow(o, "driver_first_name", "driverFirstName");
  return {
    id,
    ride_id: rideId,
    passenger_message: (o.passenger_message as string | null) ?? null,
    needs_checked_bag: Boolean(o.needs_checked_bag),
    created_at: String(o.created_at ?? ""),
    passengerSearchOriginLabel: strFromRpcRow(
      o,
      "passenger_search_origin_label",
      "passengerSearchOriginLabel"
    ),
    passengerSearchDestLabel: strFromRpcRow(
      o,
      "passenger_search_dest_label",
      "passengerSearchDestLabel"
    ),
    ride: {
      depart_at: String(o.ride_depart_at ?? o.depart_at ?? ""),
      adhoc_origin_label: strFromRpcRow(o, "adhoc_origin_label", "adhocOriginLabel"),
      adhoc_destination_label: strFromRpcRow(o, "adhoc_destination_label", "adhocDestinationLabel"),
      adhoc_trip_title: strFromRpcRow(o, "adhoc_trip_title", "adhocTripTitle"),
      listing_notes: strFromRpcRow(o, "listing_notes", "listingNotes"),
    },
    driverFirstName: df,
  };
}

/** Seat requests you sent on dated trips that are still pending driver response. */
export async function listPendingAdhocSeatRequestsAsPassenger(
  passengerId: string
): Promise<AdhocPassengerPendingRow[]> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc("poolyn_list_my_pending_adhoc_seat_requests");
  if (!rpcErr && Array.isArray(rpcData)) {
    return (rpcData as Record<string, unknown>[])
      .map(mapRpcPendingAdhocRow)
      .filter((x): x is AdhocPassengerPendingRow => x != null);
  }

  const { data: bookings, error: eb } = await supabase
    .from("adhoc_seat_bookings")
    .select(
      "id, ride_id, passenger_message, needs_checked_bag, created_at, passenger_search_origin_label, passenger_search_dest_label"
    )
    .eq("passenger_id", passengerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (eb || !bookings?.length) return [];

  const rideIds = [...new Set(bookings.map((b) => b.ride_id as string))];
  const { data: rides, error: er } = await supabase
    .from("rides")
    .select("id, depart_at, adhoc_origin_label, adhoc_destination_label, adhoc_trip_title, notes, driver_id")
    .in("id", rideIds);
  if (er || !rides?.length) return [];

  const rideById = new Map(rides.map((r) => [r.id as string, r]));
  const driverIds = [...new Set(rides.map((r) => r.driver_id as string))];
  const { data: drivers } = await supabase.from("users").select("id, full_name").in("id", driverIds);
  const driverNameById = new Map((drivers ?? []).map((u) => [u.id, u.full_name as string | null]));

  return bookings.map((b) => {
    const r = rideById.get(b.ride_id as string);
    const dn = r?.driver_id ? driverNameById.get(r.driver_id as string) : null;
    const first = dn?.trim()?.split(/\s+/)[0] ?? null;
    return {
      id: b.id as string,
      ride_id: b.ride_id as string,
      passenger_message: (b.passenger_message as string | null) ?? null,
      needs_checked_bag: Boolean(b.needs_checked_bag),
      created_at: b.created_at as string,
      passengerSearchOriginLabel: (b.passenger_search_origin_label as string | null) ?? null,
      passengerSearchDestLabel: (b.passenger_search_dest_label as string | null) ?? null,
      ride: {
        depart_at: (r?.depart_at as string) ?? "",
        adhoc_origin_label: (r?.adhoc_origin_label as string | null) ?? null,
        adhoc_destination_label: (r?.adhoc_destination_label as string | null) ?? null,
        adhoc_trip_title: (r?.adhoc_trip_title as string | null) ?? null,
        listing_notes: (r?.notes as string | null) ?? null,
      },
      driverFirstName: first,
    };
  });
}

export async function cancelMyAdhocSeatRequest(bookingId: string): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const { data, error } = await supabase.rpc("poolyn_cancel_my_adhoc_seat_request", {
    p_booking_id: bookingId,
  });
  if (error) return { ok: false, reason: error.message };
  const o = data as Record<string, unknown> | null;
  if (o && o.ok === true) return { ok: true };
  const r = typeof o?.reason === "string" ? o.reason : "cancel_failed";
  const friendly: Record<string, string> = {
    not_pending: "This request is no longer pending.",
    not_yours: "You cannot cancel this request.",
    not_found: "Request not found.",
  };
  return { ok: false, reason: friendly[r] ?? r };
}

/** Aligned with SQL truncations on poolyn_* RPCs. */
export const ADHOC_LISTING_NOTES_MAX_CHARS = 500;
export const ADHOC_SEAT_REQUEST_MESSAGE_MAX_CHARS = 500;
export const ADHOC_DRIVER_REPLY_MAX_CHARS = 500;

export function firstNameOnly(fullName: string | null | undefined): string {
  const t = (fullName ?? "").trim();
  if (!t) return "Member";
  return t.split(/\s+/)[0] ?? "Member";
}
