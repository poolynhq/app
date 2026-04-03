import { supabase } from "@/lib/supabase";

export type CreateRidePaymentIntentResult =
  | {
      ok: true;
      cash_to_charge_cents: number;
      client_secret: string | null;
      payment_intent_id: string | null;
      zero_amount_marked_paid?: boolean;
    }
  | { ok: false; error: string; cash_to_charge_cents?: number; hint?: string };

/**
 * Phase 7: server-only amount via Edge Function (prepare + Stripe PI from DB cash_to_charge_cents).
 */
export async function createRidePaymentIntentForPassenger(
  ridePassengerId: string
): Promise<CreateRidePaymentIntentResult> {
  const { data, error } = await supabase.functions.invoke("create-ride-payment-intent", {
    body: { ride_passenger_id: ridePassengerId },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = data as Record<string, unknown> | null;
  if (!row || row.ok !== true) {
    return {
      ok: false,
      error: String(row?.error ?? "payment_intent_failed"),
      cash_to_charge_cents:
        typeof row?.cash_to_charge_cents === "number" ? row.cash_to_charge_cents : undefined,
      hint: typeof row?.hint === "string" ? row.hint : undefined,
    };
  }
  return {
    ok: true,
    cash_to_charge_cents: row.cash_to_charge_cents as number,
    client_secret: (row.client_secret as string | null) ?? null,
    payment_intent_id: (row.payment_intent_id as string | null) ?? null,
    zero_amount_marked_paid: row.zero_amount_marked_paid === true,
  };
}

/** Call after payment succeeded (or zero-amount path). */
export async function finalizeRidePassengerConfirmation(
  ridePassengerId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("poolyn_finalize_ride_passenger_confirmation", {
    p_ride_passenger_id: ridePassengerId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = data as Record<string, unknown> | null;
  return { ok: row?.ok === true };
}
