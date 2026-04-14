/**
 * FUTURE USE: Profile hero for Poolyn Credits (earn driving, spend on rider share when riding).
 * UI hidden while Stripe direct payments are primary; keep module for a possible return.
 *
 * Previous implementation: gradient card with balance, link to poolyn-credits activity screen.
 */
type Props = {
  balance: number;
};

/** No-op: credits card is not shown in the app UI (see module comment). */
export function PoolynCreditsCard(_props: Props) {
  return null;
}
