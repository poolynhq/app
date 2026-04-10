/** Display-only formatting for Poolyn Credit balances (integer points, no public $ mapping). */
export function formatPoolynCreditsBalance(balance: number): string {
  const n = Math.max(0, Math.floor(balance));
  return new Intl.NumberFormat("en-AU").format(n);
}
