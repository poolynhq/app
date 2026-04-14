/** Set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in your env for native card payments. */
export const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

/**
 * Apple Pay merchant ID (must match Apple Developer + app.json Stripe plugin).
 * Set EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER to override the default.
 */
export const STRIPE_MERCHANT_IDENTIFIER =
  process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ?? "merchant.com.poolyn.app";
