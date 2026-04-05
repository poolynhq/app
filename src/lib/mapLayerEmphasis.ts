import type { User } from "@/types/database";

export type MapLayerEmphasis = "demand" | "supply" | "neutral";

/**
 * When driving, emphasize passenger-side demand (heatmap). When riding, emphasize drivers.
 */
export function mapLayerEmphasisForProfile(
  profile: User | null,
  activeMode: "driver" | "passenger" | null | undefined
): MapLayerEmphasis {
  if (!profile) return "neutral";
  const mode = profile.role === "both" ? activeMode ?? null : null;
  const asDriver =
    profile.role === "driver" || (profile.role === "both" && mode === "driver");
  const asPassenger =
    profile.role === "passenger" || (profile.role === "both" && mode === "passenger");
  if (asDriver && !asPassenger) return "demand";
  if (asPassenger && !asDriver) return "supply";
  return "neutral";
}
