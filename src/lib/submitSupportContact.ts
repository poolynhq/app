import { supabase } from "@/lib/supabase";

export const SUPPORT_ISSUE_CATEGORIES = [
  "Account or sign-in",
  "Payments or billing",
  "Rides or matching",
  "Crew or routine commute",
  "Workplace or organisation",
  "App bug or crash",
  "Something else",
] as const;

export type SupportIssueCategory = (typeof SUPPORT_ISSUE_CATEGORIES)[number];

export async function submitSupportContact(payload: {
  category: SupportIssueCategory;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke("submit-support-contact", {
    body: {
      category: payload.category,
      message: payload.message.trim(),
    },
  });

  const body = data as { ok?: boolean; error?: string } | null;
  if (body && body.ok === false && typeof body.error === "string") {
    return { ok: false, error: body.error };
  }
  if (body?.ok === true) {
    return { ok: true };
  }

  if (error) {
    return { ok: false, error: error.message ?? "Could not send. Check your connection and try again." };
  }

  return { ok: false, error: "Unexpected response from server." };
}
