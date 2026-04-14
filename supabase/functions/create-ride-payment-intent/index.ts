/**
 * Authenticated passenger: prepare (credits optional), then Stripe PaymentIntent with Connect
 * destination charge when the driver has a connected account.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import {
  allowPlatformOnlyPaymentIntent,
  getStripeCurrency,
  skipCommuteCreditsDeduction,
} from "../_shared/stripeEnv.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function feePctString(feeType: string | null, poolynContext: string): string {
  if (feeType === "organization_member") return "0";
  if (feeType === "group_trip" || poolynContext === "crew") return "0.10";
  return "0.15";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "missing_authorization" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "missing_supabase_env" }, 500);
  }

  let body: { ride_passenger_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const ridePassengerId = body.ride_passenger_id?.trim();
  if (!ridePassengerId) {
    return json({ error: "ride_passenger_id_required" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: prep, error: prepErr } = await userClient.rpc(
    "poolyn_prepare_ride_passenger_for_payment",
    {
      p_ride_passenger_id: ridePassengerId,
      p_skip_commute_credits: skipCommuteCreditsDeduction(),
    }
  );
  if (prepErr) {
    return json({ error: prepErr.message }, 400);
  }

  const p = prep as Record<string, unknown>;
  const cash =
    typeof p.cash_to_charge_cents === "number" ? Math.max(0, p.cash_to_charge_cents) : 0;

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (cash <= 0) {
    const { error: paidErr } = await serviceClient.rpc("poolyn_mark_ride_passenger_payment_paid", {
      p_ride_passenger_id: ridePassengerId,
      p_stripe_payment_intent_id: null,
    });
    if (paidErr) {
      return json({ error: paidErr.message }, 500);
    }
    return json({
      ok: true,
      cash_to_charge_cents: 0,
      client_secret: null,
      payment_intent_id: null,
      zero_amount_marked_paid: true,
      connect_mode: "none",
    });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecret) {
    return json(
      {
        error: "stripe_not_configured",
        cash_to_charge_cents: cash,
        hint: "Set STRIPE_SECRET_KEY for this Edge Function.",
      },
      503
    );
  }

  const { data: rpRow, error: rpErr } = await serviceClient
    .from("ride_passengers")
    .select(
      "id, passenger_id, expected_contribution_cents, network_fee_cents, fee_product_type, rides!inner ( id, driver_id, poolyn_context )"
    )
    .eq("id", ridePassengerId)
    .maybeSingle();

  if (rpErr || !rpRow) {
    return json({ error: "ride_passenger_load_failed" }, 500);
  }

  const ride = rpRow.rides as { id: string; driver_id: string; poolyn_context: string };
  const driverId = ride.driver_id;
  const feeType =
    (rpRow.fee_product_type as string | null) ??
    (ride.poolyn_context === "crew" ? "group_trip" : "solo_driver");
  const appFee = Math.max(0, Math.round((rpRow.network_fee_cents as number) ?? 0));

  const { data: driverRow } = await serviceClient
    .from("users")
    .select("stripe_connect_account_id")
    .eq("id", driverId)
    .maybeSingle();

  const { data: riderRow } = await serviceClient
    .from("users")
    .select("org_id")
    .eq("id", rpRow.passenger_id as string)
    .maybeSingle();

  const connectId = driverRow?.stripe_connect_account_id as string | null | undefined;
  const allowPlatform = allowPlatformOnlyPaymentIntent();

  if (!connectId && !allowPlatform) {
    return json(
      {
        error: "driver_stripe_onboarding_required",
        cash_to_charge_cents: cash,
        hint: "The driver must complete Stripe Connect onboarding before card payments.",
      },
      409
    );
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const currency = getStripeCurrency();
  const orgId = (riderRow?.org_id as string | null | undefined) ?? "";

  const metadata: Record<string, string> = {
    booking_id: ridePassengerId,
    trip_id: ride.id,
    rider_user_id: String(rpRow.passenger_id),
    driver_user_id: driverId,
    organization_id: orgId || "",
    fee_type: feeType,
    fee_percentage: feePctString(rpRow.fee_product_type as string | null, ride.poolyn_context),
    distance_km: "",
    detour_km: "",
    route_match_id: "",
    poolyn_context: ride.poolyn_context ?? "mingle",
  };

  const piParams: Stripe.PaymentIntentCreateParams = {
    amount: cash,
    currency,
    automatic_payment_methods: { enabled: true },
    metadata,
  };

  if (connectId) {
    piParams.application_fee_amount = appFee;
    piParams.transfer_data = { destination: connectId };
  }

  const pi = await stripe.paymentIntents.create(piParams);

  const { error: updErr } = await serviceClient
    .from("ride_passengers")
    .update({ stripe_payment_intent_id: pi.id })
    .eq("id", ridePassengerId);

  if (updErr) {
    return json({ error: updErr.message }, 500);
  }

  return json({
    ok: true,
    cash_to_charge_cents: cash,
    client_secret: pi.client_secret,
    payment_intent_id: pi.id,
    connect_mode: connectId ? "destination_charge" : "platform_only_dev",
    application_fee_cents: connectId ? appFee : 0,
  });
});
