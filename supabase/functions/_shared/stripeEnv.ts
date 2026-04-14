/** Shared Stripe env for Edge Functions (Deno). */
export function getStripeCurrency(): string {
  return (Deno.env.get("STRIPE_CURRENCY") ?? "aud").toLowerCase();
}

export function skipCommuteCreditsDeduction(): boolean {
  return Deno.env.get("POOLYN_SKIP_COMMUTE_CREDITS_DEDUCTION") === "true";
}

/** Allow PaymentIntents on the platform account when the driver has no Connect account (dev only). */
export function allowPlatformOnlyPaymentIntent(): boolean {
  return Deno.env.get("POOLYN_ALLOW_PLATFORM_ONLY_PI") === "true";
}
