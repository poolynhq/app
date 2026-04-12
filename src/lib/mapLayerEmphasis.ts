import type { User } from "@/types/database";
import { effectiveCommuteMode } from "@/lib/commuteRoleIntent";

export type MapLayerEmphasis = "demand" | "supply" | "neutral";

/**
 * When driving, emphasize passenger-side demand (heatmap). When riding, emphasize drivers.
 */
export function mapLayerEmphasisForProfile(profile: User | null): MapLayerEmphasis {
  if (!profile) return "neutral";
  const mode = effectiveCommuteMode(profile);
  if (mode === "driver") return "demand";
  if (mode === "passenger") return "supply";
  return "neutral";
}
