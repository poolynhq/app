import * as Crypto from "expo-crypto";

/**
 * seed = SHA-256(user_id | date) — first 8 bytes as unsigned int for tie-breaks / bucket shuffle.
 * See docs/POOLYN_MATCHING_SPEC.md
 */
export async function fairnessSeedUint32(userId: string, dateUtc: string): Promise<number> {
  const payload = `${userId}|${dateUtc}`;
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
  const slice = hex.slice(0, 8);
  return parseInt(slice, 16) >>> 0;
}

/** Deterministic pseudo-random [0,1) from seed + index (no async). */
export function fairnessUnit(seed: number, i: number): number {
  const x = Math.sin(seed * 9999 + i * 7919) * 10000;
  return x - Math.floor(x);
}
