import { supabase } from "@/lib/supabase";

function rpcOk(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { ok?: boolean }).ok === true;
}

function rpcReason(data: unknown): string {
  if (typeof data !== "object" || data === null) return "unknown";
  const r = (data as { reason?: string }).reason;
  return typeof r === "string" ? r : "unknown";
}

export async function passengerCancelConfirmedAdhocSeat(
  rideId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_passenger_cancel_confirmed_adhoc_seat", {
    p_ride_id: rideId,
  });
  if (error) return { ok: false, reason: error.message };
  if (rpcOk(data)) return { ok: true };
  const map: Record<string, string> = {
    not_confirmed_passenger: "You are not booked on this trip.",
    no_accepted_booking: "No active seat booking found.",
    ride_not_cancellable: "This trip cannot be cancelled from the app.",
    not_adhoc: "This action only applies to dated trips.",
  };
  const r = rpcReason(data);
  return { ok: false, reason: map[r] ?? r };
}

export async function driverRemovePassengerFromAdhocRide(params: {
  rideId: string;
  passengerId: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_driver_remove_passenger_from_adhoc_ride", {
    p_ride_id: params.rideId,
    p_passenger_id: params.passengerId,
    p_message: params.message.trim(),
  });
  if (error) return { ok: false, reason: error.message };
  if (rpcOk(data)) return { ok: true };
  const map: Record<string, string> = {
    not_driver: "Only the driver can remove a rider.",
    passenger_not_confirmed: "That person is not booked on this trip.",
    invalid_passenger: "Invalid rider.",
  };
  const r = rpcReason(data);
  return { ok: false, reason: map[r] ?? r };
}

/** Dropdown value for `poolyn_driver_cancel_adhoc_ride`. */
export type AdhocTripCancelReasonCode =
  | "plans_changed"
  | "vehicle_issue"
  | "low_interest"
  | "work_emergency"
  | "weather"
  | "other";

export const ADHOC_TRIP_CANCEL_REASONS: { code: AdhocTripCancelReasonCode; label: string }[] = [
  { code: "plans_changed", label: "My plans changed" },
  { code: "vehicle_issue", label: "Vehicle issue or maintenance" },
  { code: "low_interest", label: "Not enough riders or interest" },
  { code: "work_emergency", label: "Work or personal emergency" },
  { code: "weather", label: "Weather or road conditions" },
  { code: "other", label: "Other (short note required)" },
];

export async function driverCancelAdhocRide(params: {
  rideId: string;
  reasonCode: AdhocTripCancelReasonCode;
  reasonDetail: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("poolyn_driver_cancel_adhoc_ride", {
    p_ride_id: params.rideId,
    p_reason_code: params.reasonCode,
    p_reason_detail: params.reasonDetail.trim(),
  });
  if (error) return { ok: false, reason: error.message };
  if (rpcOk(data)) return { ok: true };
  const map: Record<string, string> = {
    not_driver: "Only the driver can cancel this trip.",
    invalid_reason_code: "Pick a reason from the list.",
    detail_required_for_other: "Add a short note when you choose Other.",
    already_finished: "This trip is already finished or cancelled.",
  };
  const r = rpcReason(data);
  return { ok: false, reason: map[r] ?? r };
}
