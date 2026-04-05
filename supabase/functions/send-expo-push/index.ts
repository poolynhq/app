/**
 * Send Expo push to every token stored for a user.
 * Deploy: `supabase functions deploy send-expo-push --no-verify-jwt` (or verify JWT + service role).
 *
 * Wire a Database Webhook on `public.notifications` INSERT (optional filter type = ride_request_pending)
 * to POST this function with the new row. Set env EXPO_ACCESS_TOKEN in Supabase Edge secrets.
 *
 * Body JSON: { "user_id": "uuid", "title": "string", "body": "string", "data": {} }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");

    if (!expoAccessToken) {
      return new Response(JSON.stringify({ ok: false, reason: "missing EXPO_ACCESS_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (await req.json()) as {
      user_id?: string;
      title?: string;
      body?: string;
      data?: Record<string, unknown>;
    };
    const userId = payload.user_id;
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, reason: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: tokens, error } = await admin
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", userId);

    if (error) {
      return new Response(JSON.stringify({ ok: false, reason: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const title = payload.title ?? "Poolyn";
    const body = payload.body ?? "";
    const data = payload.data ?? {};

    const messages = (tokens ?? []).map((row) => ({
      to: row.expo_push_token,
      sound: "default",
      priority: "high",
      title,
      body,
      data,
      channelId: "ride_requests_v1",
    }));

    if (messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
        Authorization: `Bearer ${expoAccessToken}`,
      },
      body: JSON.stringify(messages),
    });

    const json = await res.json();
    return new Response(JSON.stringify({ ok: res.ok, expo: json, sent: messages.length }), {
      status: res.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
