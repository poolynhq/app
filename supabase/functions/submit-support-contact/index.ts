/**
 * Authenticated users send in-app support messages to the operations inbox (Resend).
 * Secrets: RESEND_API_KEY, RESEND_FROM_EMAIL (same as send-notification-email).
 * Optional: SUPPORT_INBOX_EMAIL (defaults to poolynhq@gmail.com).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_INBOX = "poolynhq@gmail.com";

const ALLOWED_CATEGORIES = new Set([
  "Account or sign-in",
  "Payments or billing",
  "Rides or matching",
  "Crew or routine commute",
  "Workplace or organisation",
  "App bug or crash",
  "Something else",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    const toInbox = (Deno.env.get("SUPPORT_INBOX_EMAIL") ?? DEFAULT_INBOX).trim();

    if (!resendKey || !fromEmail) {
      return new Response(
        JSON.stringify({ ok: false, error: "Email delivery is not configured. Try again later." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Sign in to send a message." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const user = userData?.user;
    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ ok: false, error: "Sign in to send a message." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as { category?: string; message?: string };
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!category || !ALLOWED_CATEGORIES.has(category)) {
      return new Response(JSON.stringify({ ok: false, error: "Choose a topic from the list." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (message.length < 8) {
      return new Response(JSON.stringify({ ok: false, error: "Add a few more details (at least 8 characters)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (message.length > 6000) {
      return new Response(JSON.stringify({ ok: false, error: "Message is too long." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = user.email ?? "(no email on account)";
    const subject = `[Poolyn Support] ${category}`;

    const html = `
<p><strong>Topic:</strong> ${escapeHtml(category)}</p>
<p><strong>User id:</strong> ${escapeHtml(user.id)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<hr />
<p style="white-space:pre-wrap">${escapeHtml(message)}</p>
`;

    const emailPayload: Record<string, unknown> = {
      from: fromEmail,
      to: [toInbox],
      subject,
      html,
    };
    if (user.email) {
      emailPayload.reply_to = user.email;
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Could not send. Try again in a moment." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: j.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
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
