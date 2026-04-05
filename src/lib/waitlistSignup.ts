import { supabase } from "@/lib/supabase";

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
  const row = {
    email,
    full_name: payload.fullName?.trim() || null,
    metro_area: payload.metroArea?.trim() || null,
    intent:
      payload.intent && payload.intent !== "unsure" ? payload.intent : null,
    source: payload.source ?? "landing",
  };
  return supabase.from("waitlist_signups").insert(row);
}
