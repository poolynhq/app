/**
 * Currency the Poolyn deployment uses for Stripe charges (must match Supabase STRIPE_CURRENCY / PaymentIntents).
 * Set EXPO_PUBLIC_PLATFORM_CHARGE_CURRENCY to the same ISO code (e.g. AUD) so onboarding can flag mismatches.
 */
export const PLATFORM_CHARGE_CURRENCY = (
  process.env.EXPO_PUBLIC_PLATFORM_CHARGE_CURRENCY ?? "AUD"
).toUpperCase();
