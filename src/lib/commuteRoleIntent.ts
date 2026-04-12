import type { User } from "@/types/database";
import { RoleTheme } from "@/constants/theme";

/**
 * Today's commute intent for map, matching, and UI.
 * `active_mode` wins when set so users can switch driving vs riding without changing profile `role`.
 */
export function effectiveCommuteMode(profile: User | null): "driver" | "passenger" | null {
  if (!profile) return null;
  if (profile.active_mode === "driver" || profile.active_mode === "passenger") {
    return profile.active_mode;
  }
  if (profile.role === "driver") return "driver";
  if (profile.role === "passenger") return "passenger";
  return null;
}

export function rolePaletteForProfile(profile: User | null) {
  if (!profile) return RoleTheme.both;
  const m = effectiveCommuteMode(profile);
  if (m === "driver" || m === "passenger") return RoleTheme[m];
  if (profile.role === "both") return RoleTheme.both;
  return RoleTheme[profile.role];
}
