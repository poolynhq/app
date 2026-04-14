/**
 * Authenticated passenger (or service role): refund a completed ride_passenger PaymentIntent.
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
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey || !stripeSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  let body: { ride_passenger_id?: string; amount_cents?: number };
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

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return json({ error: "invalid_session" }, 401);
  }

  const { data: rp, error: rpErr } = await userClient
    .from("ride_passengers")
    .select("id, passenger_id, stripe_payment_intent_id, payment_status, cash_to_charge_cents")
    .eq("id", ridePassengerId)
    .maybeSingle();

  if (rpErr || !rp) {
    return json({ error: "ride_passenger_not_found" }, 404);
  }

  if (rp.passenger_id !== userData.user.id) {
    return json({ error: "not_allowed" }, 403);
  }

  if (rp.payment_status !== "paid" || !rp.stripe_payment_intent_id) {
    return json({ error: "not_refundable" }, 400);
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const pi = await stripe.paymentIntents.retrieve(rp.stripe_payment_intent_id as string);
  const maxCents = typeof pi.amount_received === "number" ? pi.amount_received : pi.amount;

  const requested = body.amount_cents;
  const refundAmount =
    typeof requested === "number" && requested > 0 ? Math.min(requested, maxCents) : undefined;

  const refund = await stripe.refunds.create({
    payment_intent: rp.stripe_payment_intent_id as string,
    ...(refundAmount !== undefined ? { amount: refundAmount } : {}),
  });

  const full = refundAmount === undefined || refundAmount >= maxCents;

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: rpcErr } = await serviceClient.rpc("poolyn_mark_ride_passenger_payment_refunded", {
    p_ride_passenger_id: ridePassengerId,
    p_stripe_refund_id: refund.id,
    p_amount_cents: refund.amount ?? 0,
    p_currency: refund.currency ?? "aud",
    p_raw: refund as unknown as Record<string, unknown>,
    p_full_refund: full,
  });

  if (rpcErr) {
    return json({ error: rpcErr.message, refund_id: refund.id }, 500);
  }

  return json({
    ok: true,
    refund_id: refund.id,
    amount_cents: refund.amount,
    full_refund: full,
  });
});
