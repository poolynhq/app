import { waitlistWorkEmailRejectReason } from "@/constants/consumerEmailDomains";
import { supabase } from "@/lib/supabase";
import type { PostgrestError } from "@supabase/supabase-js";

export type WaitlistIntent = "individual" | "organization" | "unsure";

export type WaitlistPayload = {
  email: string;
  fullName?: string;
  /** Metropolitan area, e.g. "Melbourne, Australia" — from typeahead or free text */
  metroArea?: string;
  intent?: WaitlistIntent;
  source?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function submitWaitlistSignup(payload: WaitlistPayload) {
  const email = normalizeEmail(payload.email);
  const workEmailErr = waitlistWorkEmailRejectReason(email);
  if (workEmailErr) {
    return {
      data: null,
      error: {
        message: workEmailErr,
        details: "",
        hint: "",
        code: "work_email_required",
      } satisfies Pick<PostgrestError, "message" | "details" | "hint" | "code">,
    };
  }
  const row = {
    email,
    full_name: payload.fullName?.trim() || null,
    metro_area: payload.metroArea?.trim() || null,
    intent:
      payload.intent && payload.intent !== "unsure" ? payload.intent : null,
    source: payload.source ?? "landing",
  };
  try {
    return await supabase.from("waitlist_signups").insert(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      data: null,
      error: {
        message: `Could not reach the server: ${message}`,
        details: "",
        hint: "",
        code: "client_network",
      } satisfies Pick<PostgrestError, "message" | "details" | "hint" | "code">,
    };
  }
}
