import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTripPricing, refundIsFull } from "./computeTripPricing";

describe("computeTripPricing", () => {
  it("charges 15% platform fee for solo_driver (mingle)", () => {
    const b = computeTripPricing({
      totalContributionCents: 10_000,
      isOrgMember: false,
      poolynContext: "mingle",
    });
    assert.equal(b.fee_product_type, "solo_driver");
    assert.equal(b.platform_fee_amount_cents, 1500);
    assert.equal(b.total_payable_cents, 11_500);
    assert.equal(b.net_payout_amount_cents, 10_000);
  });

  it("charges 10% coordination fee for group (crew)", () => {
    const b = computeTripPricing({
      totalContributionCents: 8000,
      isOrgMember: false,
      poolynContext: "crew",
    });
    assert.equal(b.fee_product_type, "group_trip");
    assert.equal(b.platform_fee_amount_cents, 800);
    assert.equal(b.total_payable_cents, 8800);
  });

  it("charges 15% for ad-hoc solo-style trips", () => {
    const b = computeTripPricing({
      totalContributionCents: 4000,
      isOrgMember: false,
      poolynContext: "adhoc",
    });
    assert.equal(b.fee_product_type, "solo_driver");
    assert.equal(b.platform_fee_amount_cents, 600);
  });

  it("has zero platform fee for organization-covered riders", () => {
    const b = computeTripPricing({
      totalContributionCents: 20_000,
      isOrgMember: true,
      poolynContext: "mingle",
    });
    assert.equal(b.fee_product_type, "organization_member");
    assert.equal(b.platform_fee_amount_cents, 0);
    assert.equal(b.total_payable_cents, 20_000);
  });

  it("handles partial-cent rounding like the database ROUND()", () => {
    const b = computeTripPricing({
      totalContributionCents: 333,
      isOrgMember: false,
      poolynContext: "mingle",
    });
    assert.equal(b.platform_fee_amount_cents, 50);
  });

  it("detects full vs partial refund against the charged amount", () => {
    assert.equal(refundIsFull(11500, 11500), true);
    assert.equal(refundIsFull(11500, 5000), false);
  });
});
