/**
 * Stripe webhook: mark ride_passenger payment paid / failed (service role RPCs).
 * Set STRIPE_WEBHOOK_SECRET from the Stripe CLI or Dashboard.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = req.headers.get("stripe-signature");
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature!, webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Webhook signature verification failed: ${msg}`, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const rid = pi.metadata?.ride_passenger_id;
    if (rid) {
      const { error } = await serviceClient.rpc("poolyn_mark_ride_passenger_payment_paid", {
        p_ride_passenger_id: rid,
        p_stripe_payment_intent_id: pi.id,
      });
      if (error) {
        console.error("poolyn_mark_ride_passenger_payment_paid", error.message);
        return new Response(error.message, { status: 500 });
      }
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const rid = pi.metadata?.ride_passenger_id;
    if (rid) {
      const { error } = await serviceClient.rpc("poolyn_mark_ride_passenger_payment_failed", {
        p_ride_passenger_id: rid,
      });
      if (error) {
        console.error("poolyn_mark_ride_passenger_payment_failed", error.message);
        return new Response(error.message, { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
