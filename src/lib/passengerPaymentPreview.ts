import {
  poolynExplorerCashFeeFraction,
  type PoolynTripFeeContext,
} from "@/lib/poolynPricingConfig";

/**
 * Client-side **preview** of explorer cash fee (Mingle service fee or Crew admin fee). Server recomputes
 * on commit (`is_user_org_member` + subscription + `rides.poolyn_context`). Uses `users.org_id` as proxy.
 */
export function computeClientNetworkFeePreview(input: {
  totalContributionCents: number;
  /** True when user has a workplace org on profile (may still differ if subscription inactive). */
  hasWorkplaceOrgOnProfile: boolean;
  /** Mingle vs Crew — different cash fee rates. */
  poolynContext?: PoolynTripFeeContext;
}): {
  networkFeeCents: number;
  finalChargeCents: number;
  appliesExplorerFee: boolean;
} {
  const ctx: PoolynTripFeeContext = input.poolynContext ?? "mingle";
  const contrib = Math.max(0, Math.round(input.totalContributionCents));
  const applies = !input.hasWorkplaceOrgOnProfile;
  const rate = poolynExplorerCashFeeFraction(ctx);
  const networkFeeCents = applies ? Math.round(contrib * rate) : 0;
  return {
    networkFeeCents,
    finalChargeCents: contrib + networkFeeCents,
    appliesExplorerFee: applies,
  };
}

export const PASSENGER_PAYMENT_EXPLAINER_TITLE = "What this payment covers";

export function buildPassengerPaymentExplainerMessage(opts: {
  hasWorkplaceNetworkOnProfile: boolean;
  context: "mingle" | "crew" | "profile_estimate";
}): string {
  const minglePct = Math.round(poolynExplorerCashFeeFraction("mingle") * 100);
  const crewPct = Math.round(poolynExplorerCashFeeFraction("crew") * 100);
  const feePct = opts.context === "crew" ? crewPct : minglePct;

  const tripBlock =
    opts.context === "crew"
      ? "Crew uses the same fair-share engine as Mingle: the locked corridor is the route your crew committed to when it was formed. Splitting cost across riders (members minus one driver seat) is a clear default so everyone sees a predictable share; it funds driver cost recovery for that shared trip, not a Poolyn markup on the distance itself."
      : "Your trip share is your part of the driver’s cost recovery for the matched driving distance (and fair split when several riders share the car).";

  /* FUTURE USE: internal Poolyn Credits explainer (when credits are shown in-app again)
  const creditsBlock =
    "…";
  */

  const feeBlock = opts.hasWorkplaceNetworkOnProfile
    ? "You’re on a workplace profile in Poolyn, so the extra cash service fee on trip share normally does not apply (confirmed when you book)."
    : opts.context === "crew"
      ? `Independent Crew riders pay a ${feePct}% Crew admin fee on the cash trip share (lower per person than Mingle; each rider pays on their own share). It covers coordination, chat, routing, and compliance. It is not charged on an active workplace Poolyn network. Invite your org so the team can drop this fee.`
      : `Independent Mingle riders pay a ${feePct}% service fee on the cash trip share (on top of trip share). It covers secure payments, routing, matching, maps, and compliance. It is not charged on an active workplace Poolyn network. Share Poolyn with your leadership so your org can turn this fee off for the team.`;

  const valueBlock =
    "What you get: geometry-based matching, detour-aware pricing, reservations, and (for crews) daily chat and driver coordination. Transparent numbers tied to real trip cost.";

  return `${tripBlock}\n\n${feeBlock}\n\n${valueBlock}`;
}
