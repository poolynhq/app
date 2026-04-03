/**
 * Authenticated passenger: runs poolyn_prepare (credits + DB cash_to_charge_cents), then
 * creates a Stripe PaymentIntent for that amount only (never trust client-sent amounts).
 * If cash_to_charge_cents is 0, marks payment paid via service role (no card) so finalize can run.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

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
    { p_ride_passenger_id: ridePassengerId }
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

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const currency = (Deno.env.get("STRIPE_CURRENCY") ?? "aud").toLowerCase();

  const pi = await stripe.paymentIntents.create({
    amount: cash,
    currency,
    automatic_payment_methods: { enabled: true },
    metadata: { ride_passenger_id: ridePassengerId },
  });

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
  });
});
