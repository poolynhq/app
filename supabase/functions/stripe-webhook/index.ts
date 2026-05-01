/**
 * Stripe webhook: ride payment lifecycle + financial ledger (idempotent by stripe_event_id).
 * Subscribe in Dashboard to at least: payment_intent.succeeded, payment_intent.payment_failed,
 * charge.refunded, charge.dispute.created, payout.paid, payout.failed, account.updated (Connect onboarding).
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

  async function ledgerRecord(
    eventType: string,
    ridePassengerId: string | null,
    piId: string | null,
    amountCents: number | null,
    currency: string,
    extra: Record<string, unknown>
  ) {
    const { error } = await serviceClient.rpc("poolyn_financial_ledger_record", {
      p_stripe_event_id: event.id,
      p_event_type: eventType,
      p_ride_passenger_id: ridePassengerId,
      p_stripe_payment_intent_id: piId,
      p_amount_cents: amountCents,
      p_currency: currency,
      p_payload: { ...extra, stripe_event_type: event.type },
    });
    if (error) {
      console.error("poolyn_financial_ledger_record", error.message);
      throw error;
    }
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const rid = pi.metadata?.booking_id ?? pi.metadata?.ride_passenger_id;
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
      await ledgerRecord(
        event.type,
        rid ?? null,
        pi.id,
        typeof pi.amount_received === "number" ? pi.amount_received : pi.amount,
        pi.currency,
        { payment_intent: pi.id }
      );
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const rid = pi.metadata?.booking_id ?? pi.metadata?.ride_passenger_id;
      if (rid) {
        const { error } = await serviceClient.rpc("poolyn_mark_ride_passenger_payment_failed", {
          p_ride_passenger_id: rid,
        });
        if (error) {
          console.error("poolyn_mark_ride_passenger_payment_failed", error.message);
          return new Response(error.message, { status: 500 });
        }
      }
      await ledgerRecord(event.type, rid ?? null, pi.id, pi.amount, pi.currency, {
        payment_intent: pi.id,
      });
    } else if (event.type === "charge.refunded") {
      const ch = event.data.object as Stripe.Charge;
      const piId =
        typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id ?? null;

      let ridePassengerId: string | null = null;
      if (piId) {
        const { data: row } = await serviceClient
          .from("ride_passengers")
          .select("id, cash_to_charge_cents")
          .eq("stripe_payment_intent_id", piId)
          .maybeSingle();
        ridePassengerId = (row?.id as string | undefined) ?? null;
      }

      const refundAmount = ch.amount_refunded ?? 0;
      const originalAmount = ch.amount ?? 0;
      const fullRefund = originalAmount > 0 && refundAmount >= originalAmount;

      const latestRefund = ch.refunds?.data?.[0];

      if (ridePassengerId && latestRefund?.id) {
        const { error } = await serviceClient.rpc("poolyn_mark_ride_passenger_payment_refunded", {
          p_ride_passenger_id: ridePassengerId,
          p_stripe_refund_id: latestRefund.id,
          p_amount_cents: refundAmount,
          p_currency: ch.currency,
          p_raw: ch as unknown as Record<string, unknown>,
          p_full_refund: fullRefund,
        });
        if (error) {
          console.error("poolyn_mark_ride_passenger_payment_refunded", error.message);
        }
      }

      await ledgerRecord(event.type, ridePassengerId, piId, refundAmount, ch.currency, {
        charge_id: ch.id,
      });
    } else if (event.type === "charge.dispute.created") {
      const dsp = event.data.object as Stripe.Dispute;
      const chId = typeof dsp.charge === "string" ? dsp.charge : dsp.charge?.id;
      let piId: string | null = null;
      let ridePassengerId: string | null = null;
      if (chId) {
        const ch = await stripe.charges.retrieve(chId);
        piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id ?? null;
        if (piId) {
          const { data: row } = await serviceClient
            .from("ride_passengers")
            .select("id")
            .eq("stripe_payment_intent_id", piId)
            .maybeSingle();
          ridePassengerId = (row?.id as string | undefined) ?? null;
        }
      }
      const dueBy = (dsp as { evidence_details?: { due_by?: number } }).evidence_details?.due_by;
      await serviceClient.rpc("poolyn_record_stripe_dispute", {
        p_stripe_dispute_id: dsp.id,
        p_stripe_charge_id: chId ?? "",
        p_ride_passenger_id: ridePassengerId,
        p_status: dsp.status,
        p_evidence_due_by: typeof dueBy === "number"
          ? new Date(dueBy * 1000).toISOString()
          : null,
        p_raw: dsp as unknown as Record<string, unknown>,
      });
      await ledgerRecord(event.type, ridePassengerId, piId, dsp.amount, dsp.currency, {
        dispute_id: dsp.id,
      });
    } else if (event.type === "account.updated") {
      const acct = event.data.object as Stripe.Account;
      const ready = acct.charges_enabled === true && acct.payouts_enabled === true;
      let userId = typeof acct.metadata?.poolyn_user_id === "string" ? acct.metadata.poolyn_user_id.trim() : "";
      if (!userId) {
        const { data: urow } = await serviceClient
          .from("users")
          .select("id")
          .eq("stripe_connect_account_id", acct.id)
          .maybeSingle();
        userId = (urow?.id as string | undefined) ?? "";
      }
      if (userId) {
        const { error: acctErr } = await serviceClient.rpc("poolyn_set_user_stripe_connect_account", {
          p_user_id: userId,
          p_stripe_connect_account_id: acct.id,
          p_onboarding_complete: ready,
        });
        if (acctErr) {
          console.error("poolyn_set_user_stripe_connect_account (account.updated)", acctErr.message);
        }
      }
      await ledgerRecord(event.type, null, null, 0, (acct.default_currency ?? "usd").toLowerCase(), {
        stripe_account_id: acct.id,
        charges_enabled: acct.charges_enabled,
        payouts_enabled: acct.payouts_enabled,
        details_submitted: acct.details_submitted,
        poolyn_user_id: userId || null,
      });
    } else if (event.type === "payout.paid" || event.type === "payout.failed") {
      const po = event.data.object as Stripe.Payout;
      const dest =
        typeof po.destination === "string"
          ? po.destination
          : (po.destination as { id?: string } | null)?.id ?? "unknown";
      await serviceClient.rpc("poolyn_record_stripe_payout_event", {
        p_stripe_payout_id: po.id,
        p_stripe_connect_account_id: dest,
        p_amount_cents: po.amount,
        p_currency: po.currency,
        p_status: po.status,
        p_raw: po as unknown as Record<string, unknown>,
      });
      await ledgerRecord(event.type, null, null, po.amount, po.currency, { payout_id: po.id });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("stripe webhook handler", msg);
    return new Response(msg, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
