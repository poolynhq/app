/**
 * Phase 5: network fee on passenger contribution only (cash, never credits).
 * Phase 6A: commute credit redemption plan (credits cover contribution only).
 *
 * 100 Poolyn commute credits = $1 of contribution coverage (same integer unit as cents).
 *
 * Production: resolve network fee with `poolyn_passenger_network_fee_preview` or
 * `poolyn_commit_commute_passenger_pricing` (server uses `is_user_org_member`, driven by
 * `organisations.status` active|grace vs inactive|dissolved); do not trust client flags.
 */

export const NETWORK_FEE_PERCENTAGE = 0.18;

/** Display / docs: credits per dollar (balance uses the same integer scale as cents). */
export const POOLYN_COMMUTE_CREDITS_PER_DOLLAR = 100;

export type NetworkFeeBreakdown = {
  total_contribution: number;
  network_fee_cents: number;
  final_charge_cents: number;
};

/** Phase 6A output (strict). */
export type CommuteCreditRedemptionPlan = {
  credits_used: number;
  cash_to_charge: number;
  remaining_credit_balance: number;
};

function assertNonNegativeInt(name: string, n: number): void {
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/**
 * Use when {@link networkFeeCents} comes from the server (e.g. `poolyn_passenger_network_fee_preview`).
 */
export function computeNetworkFeeBreakdownWithKnownFee(input: {
  totalContributionCents: number;
  networkFeeCents: number;
}): NetworkFeeBreakdown {
  const total_contribution = Math.max(0, Math.round(input.totalContributionCents));
  const network_fee_cents = Math.max(0, Math.round(input.networkFeeCents));
  assertNonNegativeInt("totalContributionCents", total_contribution);
  assertNonNegativeInt("networkFeeCents", network_fee_cents);
  const final_charge_cents = total_contribution + network_fee_cents;
  return {
    total_contribution,
    network_fee_cents,
    final_charge_cents,
  };
}

/**
 * @deprecated For production use {@link computeNetworkFeeBreakdownWithKnownFee} with server-resolved fee,
 * or call `poolyn_passenger_network_fee_preview`. Client-supplied org membership must not be trusted.
 */
export function computeNetworkFeeBreakdown(input: {
  totalContributionCents: number;
  isOrgMember: boolean;
}): NetworkFeeBreakdown {
  const total_contribution = Math.max(0, Math.round(input.totalContributionCents));
  assertNonNegativeInt("totalContributionCents", total_contribution);

  const network_fee_cents = input.isOrgMember
    ? 0
    : Math.round(total_contribution * NETWORK_FEE_PERCENTAGE);

  const final_charge_cents = total_contribution + network_fee_cents;

  return {
    total_contribution,
    network_fee_cents,
    final_charge_cents,
  };
}

/**
 * How many commute credits to apply before charging cash. Credits cannot pay the network fee.
 */
export function planCommuteCreditRedemption(input: {
  userCreditBalance: number;
  totalContributionCents: number;
  networkFeeCents: number;
}): CommuteCreditRedemptionPlan {
  const credits_available = Math.max(0, Math.round(input.userCreditBalance));
  const total_contribution = Math.max(0, Math.round(input.totalContributionCents));
  const network_fee_cents = Math.max(0, Math.round(input.networkFeeCents));

  assertNonNegativeInt("userCreditBalance", credits_available);
  assertNonNegativeInt("totalContributionCents", total_contribution);
  assertNonNegativeInt("networkFeeCents", network_fee_cents);

  const credits_to_use = Math.min(credits_available, total_contribution);
  const cash_to_charge =
    total_contribution - credits_to_use + network_fee_cents;
  const remaining_credit_balance = credits_available - credits_to_use;

  return {
    credits_used: credits_to_use,
    cash_to_charge,
    remaining_credit_balance,
  };
}

/**
 * Phase 5 + 6A using server-provided {@link networkFeeCents} (e.g. preview RPC).
 * Card amount: prefer {@link CommuteCreditRedemptionPlan.cash_to_charge} only after credits are applied;
 * for DB source of truth use `ride_passengers.cash_to_charge_cents`.
 */
export function planPassengerCashSettlementFromServerFee(input: {
  totalContributionCents: number;
  networkFeeCents: number;
  userCreditBalance: number;
}): NetworkFeeBreakdown & CommuteCreditRedemptionPlan {
  const fee = computeNetworkFeeBreakdownWithKnownFee({
    totalContributionCents: input.totalContributionCents,
    networkFeeCents: input.networkFeeCents,
  });
  const redemption = planCommuteCreditRedemption({
    userCreditBalance: input.userCreditBalance,
    totalContributionCents: fee.total_contribution,
    networkFeeCents: fee.network_fee_cents,
  });
  return {
    ...fee,
    ...redemption,
  };
}

/**
 * @deprecated Use {@link planPassengerCashSettlementFromServerFee} with fee from
 * `poolyn_passenger_network_fee_preview`.
 */
export function planPassengerCashSettlement(input: {
  totalContributionCents: number;
  isOrgMember: boolean;
  userCreditBalance: number;
}): NetworkFeeBreakdown & CommuteCreditRedemptionPlan {
  const fee = computeNetworkFeeBreakdown({
    totalContributionCents: input.totalContributionCents,
    isOrgMember: input.isOrgMember,
  });
  const redemption = planCommuteCreditRedemption({
    userCreditBalance: input.userCreditBalance,
    totalContributionCents: fee.total_contribution,
    networkFeeCents: fee.network_fee_cents,
  });
  return {
    ...fee,
    ...redemption,
  };
}
