import { supabase } from "@/lib/supabase";

export type CreateRidePaymentIntentResult =
  | {
      ok: true;
      cash_to_charge_cents: number;
      client_secret: string | null;
      payment_intent_id: string | null;
      zero_amount_marked_paid?: boolean;
      connect_mode?: string;
      application_fee_cents?: number;
    }
  | { ok: false; error: string; cash_to_charge_cents?: number; hint?: string };

export type PricingQuoteResult =
  | {
      ok: true;
      gross_trip_amount_cents: number;
      platform_fee_cents: number;
      total_payable_cents: number;
      net_payout_estimate_cents: number;
      platform_fee_label: string;
    }
  | { ok: false; error: string };

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
    connect_mode: typeof row.connect_mode === "string" ? row.connect_mode : undefined,
    application_fee_cents:
      typeof row.application_fee_cents === "number" ? row.application_fee_cents : undefined,
  };
}

/** Server-only booking breakdown for UI before PaymentSheet (see Edge `pricing-quote`). */
export async function fetchRidePassengerPricingQuote(
  ridePassengerId: string
): Promise<PricingQuoteResult> {
  const { data, error } = await supabase.functions.invoke("pricing-quote", {
    body: { ride_passenger_id: ridePassengerId },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = data as Record<string, unknown> | null;
  if (!row || row.ok !== true) {
    return { ok: false, error: String(row?.error ?? "pricing_quote_failed") };
  }
  return {
    ok: true,
    gross_trip_amount_cents: row.gross_trip_amount_cents as number,
    platform_fee_cents: row.platform_fee_cents as number,
    total_payable_cents: row.total_payable_cents as number,
    net_payout_estimate_cents: row.net_payout_estimate_cents as number,
    platform_fee_label: String(row.platform_fee_label ?? "platform fee"),
  };
}

/** Driver/host Stripe Connect onboarding URL (opens in browser). */
export async function createStripeConnectOnboardingUrl(): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const { data, error } = await supabase.functions.invoke("stripe-connect-onboard", {
    body: {},
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = data as Record<string, unknown> | null;
  if (!row || row.ok !== true || typeof row.url !== "string") {
    return { ok: false, error: String(row?.error ?? "onboarding_failed") };
  }
  return { ok: true, url: row.url };
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
