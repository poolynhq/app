import { parseGeoPoint } from "@/lib/parseGeoPoint";
import type { User } from "@/types/database";

/**
 * Verified enterprise member (not org admin): company invite / claim flow.
 * Skip the public workplace banner when the org is expected to supply a workplace pin.
 */
export function isCompanyNetworkMember(profile: User | null | undefined): boolean {
  return Boolean(
    profile?.org_id &&
      profile.registration_type === "enterprise" &&
      profile.org_member_verified === true &&
      profile.org_role === "member"
  );
}

export function hasWorkplacePin(profile: User | null | undefined): boolean {
  if (!profile?.work_location) return false;
  return Boolean(parseGeoPoint(profile.work_location as unknown));
}

/** Non–company-network users need a workplace pin for main + alternate route previews. */
export function shouldPromptForWorkplacePin(profile: User | null | undefined): boolean {
  if (!profile?.id) return false;
  if (isCompanyNetworkMember(profile)) return false;
  return !hasWorkplacePin(profile);
}
