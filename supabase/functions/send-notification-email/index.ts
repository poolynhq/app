/**
 * Optional: send a transactional email when a row is inserted into public.notifications.
 * Deploy with secrets: RESEND_API_KEY, RESEND_FROM_EMAIL (e.g. "Poolyn <notifications@yourdomain.com>").
 * Wire a Database Webhook (INSERT on notifications) to POST this function with the new row,
 * or call from application code. If RESEND_API_KEY is unset, returns { ok: true, skipped: true }.
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
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!resendKey || !fromEmail) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "email not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const payload = (await req.json()) as {
      notification_id?: string;
      record?: { user_id?: string; title?: string; body?: string | null; type?: string; data?: unknown };
    };

    const record = payload.record;
    let userId = record?.user_id;
    let title = record?.title ?? "Poolyn";
    let body = record?.body ?? "";
    let data = record?.data;

    if (payload.notification_id) {
      const { data: row, error } = await admin
        .from("notifications")
        .select("user_id, title, body, type, data")
        .eq("id", payload.notification_id)
        .maybeSingle();
      if (error || !row) {
        return new Response(JSON.stringify({ ok: false, reason: "notification not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = row.user_id as string;
      title = row.title as string;
      body = (row.body as string) ?? "";
      data = row.data;
    }

    if (!userId) {
      return new Response(JSON.stringify({ ok: false, reason: "user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: user, error: uerr } = await admin.from("users").select("email").eq("id", userId).maybeSingle();
    if (uerr || !user?.email) {
      return new Response(JSON.stringify({ ok: false, reason: "no email on profile" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deep =
      data && typeof data === "object" && data !== null && "deep_link" in data
        ? String((data as { deep_link?: string }).deep_link ?? "")
        : "";
    const appLink = deep ? `Open Poolyn and go to ${deep}.` : "Open the Poolyn app for details.";

    const html = `<p>${escapeHtml(body || title)}</p><p>${escapeHtml(appLink)}</p>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [user.email],
        subject: title,
        html,
      }),
    });

    const j = await r.json();
    return new Response(JSON.stringify({ ok: r.ok, resend: j }), {
      status: r.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
