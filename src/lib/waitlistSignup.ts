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

  // ── Commuter survey ──────────────────────────────────────────────────────
  commutePainKeys?: string[];
  commutePainOther?: string;
  commuteCost?: string;
  commuteDays?: string;
  commuteTrustKeys?: string[];
  commuteTrustOther?: string;
  commuteRole?: string;
  commuteRoleOther?: string;
  workLocation?: string;

  // ── Organisation survey ──────────────────────────────────────────────────
  orgChallenge?: string;
  orgSize?: string;
  orgSubsidy?: string;
  companyName?: string;
  jobTitle?: string;
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
    intent: payload.intent && payload.intent !== "unsure" ? payload.intent : null,
    source: payload.source ?? "landing",

    // Commuter survey
    commute_pain_keys:  payload.commutePainKeys?.length ? payload.commutePainKeys : null,
    commute_pain_other: payload.commutePainOther?.trim() || null,
    commute_cost:       payload.commuteCost ?? null,
    commute_days:       payload.commuteDays ?? null,
    commute_trust_keys: payload.commuteTrustKeys?.length ? payload.commuteTrustKeys : null,
    commute_trust_other: payload.commuteTrustOther?.trim() || null,
    commute_role:       payload.commuteRole ?? null,
    commute_role_other: payload.commuteRoleOther?.trim() || null,
    work_location:      payload.workLocation?.trim() || null,

    // Organisation survey
    org_challenge: payload.orgChallenge ?? null,
    org_size:      payload.orgSize ?? null,
    org_subsidy:   payload.orgSubsidy ?? null,
    company_name:  payload.companyName?.trim() || null,
    job_title:     payload.jobTitle?.trim() || null,
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
