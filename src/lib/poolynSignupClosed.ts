/**
 * Routes under (auth) that start account creation — replaced with signup-closed when gated.
 * Keep aligned with MARKETING_BLOCKED_AUTH_SEGMENTS where relevant.
 */
export const SIGNUP_CLOSED_AUTH_SEGMENTS = new Set([
  "sign-up",
  "business-sign-up",
  "start",
  "join-org",
]);

/**
 * When true, unauthenticated users cannot open real sign-up flows; they see signup-closed instead.
 *
 * - Default **on in `__DEV__`** so local / Expo Go matches “waitlist + sign-in only” without env churn.
 * - Opt out for full local registration: `EXPO_PUBLIC_POOLYN_SIGNUP_OPEN=1`
 * - Force closed in production (e.g. staged native build): `EXPO_PUBLIC_POOLYN_SIGNUP_CLOSED=1`
 */
export function isPoolynSignupClosed(): boolean {
  const open = process.env.EXPO_PUBLIC_POOLYN_SIGNUP_OPEN;
  if (open === "1" || open === "true") return false;

  const closed = process.env.EXPO_PUBLIC_POOLYN_SIGNUP_CLOSED;
  if (closed === "1" || closed === "true") return true;

  if (__DEV__) return true;

  return false;
}
