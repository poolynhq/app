/**
 * Authenticated user: create Stripe Connect Express account (if needed) and return Account Link URL.
 * Call when the user is about to receive trip funds (host / driver for a paid leg), not at app signup.
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
  const refreshUrl = Deno.env.get("STRIPE_CONNECT_REFRESH_URL") ?? "https://example.com/poolyn/stripe-refresh";
  const returnUrl = Deno.env.get("STRIPE_CONNECT_RETURN_URL") ?? "https://example.com/poolyn/stripe-return";

  if (!supabaseUrl || !anonKey || !serviceKey || !stripeSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return json({ error: "invalid_session" }, 401);
  }

  const userId = userData.user.id;

  const { data: profile, error: profErr } = await userClient
    .from("users")
    .select("id, stripe_connect_account_id, email, full_name, billing_currency_user_code")
    .eq("id", userId)
    .maybeSingle();

  if (profErr || !profile) {
    return json({ error: "profile_not_found" }, 400);
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let accountId = profile.stripe_connect_account_id as string | null;

  if (!accountId) {
    /** When set during onboarding, map ISO 4217 to a Stripe Connect country (single-currency markets only). */
    const CC_TO_COUNTRY: Record<string, string> = {
      AUD: "AU",
      NZD: "NZ",
      USD: "US",
      GBP: "GB",
      CAD: "CA",
      SGD: "SG",
      JPY: "JP",
      HKD: "HK",
    };
    const userCode = String(
      (profile as { billing_currency_user_code?: string | null }).billing_currency_user_code ?? ""
    )
      .trim()
      .toUpperCase();
    const fromProfile =
      userCode && CC_TO_COUNTRY[userCode] ? CC_TO_COUNTRY[userCode]! : null;
    const country =
      fromProfile ?? (Deno.env.get("STRIPE_CONNECT_ACCOUNT_COUNTRY") ?? "AU").toUpperCase();

    const account = await stripe.accounts.create({
      type: "express",
      country,
      email: profile.email ?? undefined,
      metadata: { poolyn_user_id: userId },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    accountId = account.id;

    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: rpcErr } = await serviceClient.rpc("poolyn_set_user_stripe_connect_account", {
      p_user_id: userId,
      p_stripe_connect_account_id: accountId,
      p_onboarding_complete: false,
    });
    if (rpcErr) {
      return json({ error: rpcErr.message }, 500);
    }
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return json({
    ok: true,
    url: link.url,
    stripe_connect_account_id: accountId,
  });
});
