import type { User } from "@/types/database";

/**
 * Local/dev only: when true, Poolyn treats payouts as ready so you can test posting routes.
 * Production builds must leave this unset. Also enable bypass on the Supabase project when testing RPC
 * blockers (see migration poolyn_dev_settings.allow_adhoc_without_stripe_payout).
 */
export function payoutsBypassEnabled(): boolean {
  const v = process.env.EXPO_PUBLIC_POOLYN_BYPASS_PAYOUT_REQUIREMENT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** User can receive Connect transfers for paid trips (Stripe Express onboarding complete). */
export function userTripPayoutsReady(
  u: Pick<User, "stripe_connect_account_id" | "stripe_connect_onboarding_complete"> | null | undefined
): boolean {
  if (payoutsBypassEnabled()) return true;
  const id = u?.stripe_connect_account_id?.trim();
  return Boolean(id) && Boolean(u?.stripe_connect_onboarding_complete);
}
