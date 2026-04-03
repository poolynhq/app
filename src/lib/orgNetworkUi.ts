import type { OrganisationNetworkStatus } from "@/types/database";

/** Same-org fee waiver + internal matching (active or grace). */
export function orgStatusIsNetworkMember(
  status: OrganisationNetworkStatus | null | undefined
): boolean {
  return status === "active" || status === "grace";
}

/** Explorer-style billing / no private-network priority. */
export function orgStatusIsExplorerExperience(
  status: OrganisationNetworkStatus | null | undefined
): boolean {
  return !orgStatusIsNetworkMember(status);
}

export function orgStatusIsGrace(
  status: OrganisationNetworkStatus | null | undefined
): boolean {
  return status === "grace";
}

/** Full-screen paywall: inactive / dissolved (not grace — grace uses banner + disabled actions). */
export function orgRequiresFullActivationPaywall(
  status: OrganisationNetworkStatus | null | undefined
): boolean {
  return status === "inactive" || status === "dissolved";
}
