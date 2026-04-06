import { Platform } from "react-native";
import type { PostgrestError } from "@supabase/supabase-js";

/** Single string for the waitlist form, including Supabase details/hint when present. */
export function formatWaitlistSignupError(
  err: Pick<PostgrestError, "message" | "details" | "hint" | "code">
): string {
  const parts: string[] = [];
  if (err.message?.trim()) parts.push(err.message.trim());
  const d = err.details?.trim();
  if (d && d !== err.message?.trim()) parts.push(d);
  const h = err.hint?.trim();
  if (h) parts.push(h);

  let out = parts.length > 0 ? parts.join(" — ") : "Something went wrong. Try again.";
  if (err.code && err.code !== "23505" && err.code !== "23514") {
    out += ` (${err.code})`;
  }
  return out;
}

/** Browser console on web (no email); helps debug failed signups on static hosting. */
export function logWaitlistSignupFailure(context: {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}) {
  if (Platform.OS !== "web") return;
  console.warn("[waitlist] insert failed", context);
}
