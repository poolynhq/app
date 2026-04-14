/**
 * Pure fee math aligned with poolyn_passenger_network_fee_preview / marketplace migration.
 * Used for unit tests and client-side display parity (amounts still come from the backend).
 */

import {
  POOLYN_CREW_EXPLORER_ADMIN_FEE_FRACTION,
  POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION,
} from "@/lib/poolynPricingConfig";

export type FeeProductType = "organization_member" | "solo_driver" | "group_trip";

export type PoolynTripContext = "mingle" | "crew" | "adhoc";

export type TripPricingBreakdown = {
  gross_trip_amount_cents: number;
  platform_fee_amount_cents: number;
  total_payable_cents: number;
  net_payout_amount_cents: number;
  fee_product_type: FeeProductType;
  fee_percentage: number;
};

function roundCents(n: number): number {
  return Math.max(0, Math.round(n));
}

/**
 * Country hook for future AU/US Stripe fee schedule differences (defaults match DB migration 0095).
 */
export function computeTripPricing(input: {
  totalContributionCents: number;
  isOrgMember: boolean;
  poolynContext: PoolynTripContext;
  countryCode?: string;
}): TripPricingBreakdown {
  const contrib = roundCents(input.totalContributionCents);
  const isOrg = input.isOrgMember;
  const ctx = input.poolynContext === "crew" ? "crew" : "mingle";

  let feeProduct: FeeProductType;
  let rate: number;

  if (isOrg) {
    feeProduct = "organization_member";
    rate = 0;
  } else if (ctx === "crew") {
    feeProduct = "group_trip";
    rate = POOLYN_CREW_EXPLORER_ADMIN_FEE_FRACTION;
  } else {
    feeProduct = "solo_driver";
    rate = POOLYN_MINGLE_EXPLORER_CASH_FEE_FRACTION;
  }

  const fee = roundCents(contrib * rate);
  const total = contrib + fee;

  return {
    gross_trip_amount_cents: contrib,
    platform_fee_amount_cents: fee,
    total_payable_cents: total,
    net_payout_amount_cents: contrib,
    fee_product_type: feeProduct,
    fee_percentage: rate,
  };
}

/** Mirrors Stripe refund reconciliation: full when refunded amount covers the original charge. */
export function refundIsFull(originalAmountCents: number, refundedCents: number): boolean {
  return refundedCents >= originalAmountCents;
}
