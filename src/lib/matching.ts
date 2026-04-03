import { supabase } from "@/lib/supabase";
import { User } from "@/types/database";
import {
  getRideOpportunities,
  reserveRideOpportunity,
  type RideOpportunityCard,
  type RideCardIntent,
} from "@/lib/commuteMatching";

// ── Geometry-first ride opportunities (see docs/POOLYN_MATCHING_SPEC.md) ──────

export type { RideOpportunityCard, RideCardIntent };
export { reserveRideOpportunity };

export async function getRideCardsForViewer(
  profile: User,
  intent: RideCardIntent = "passenger"
): Promise<RideOpportunityCard[]> {
  return getRideOpportunities(profile, { intent });
}

// ── Ride/request-based match suggestion (legacy — optional) ───────────────────
export interface DiscoverMatch {
  suggestion_id: string;
  section: "organization" | "nearby";
  match_score: number;
  route_similarity_score: number | null;
  time_overlap_mins: number | null;
  depart_at: string | null;
  desired_depart_at: string | null;
  driver_id: string;
  passenger_id: string;
  driver_name: string | null;
  passenger_name: string | null;
  driver_reliability: number;
  passenger_reliability: number;
  driver_verified: boolean;
  trust_label: string;
}

export interface MatchFilterOptions {
  scope: "network" | "nearby" | "all";
  verifiedDriversOnly: boolean;
  minReliability: number;
  genderFilter: "any" | "male" | "female" | "non_binary" | "prefer_not_to_say";
}

export async function refreshMatches(
  userId: string,
  scope: "network" | "extended"
): Promise<void> {
  await supabase.rpc("upsert_match_suggestions", {
    p_user_id: userId,
    p_scope: scope,
  });
}

export async function getDiscoverMatches(
  profile: User,
  filters: MatchFilterOptions
): Promise<DiscoverMatch[]> {
  const scope = filters.scope;
  await refreshMatches(profile.id, scope === "network" ? "network" : "extended");

  const { data, error } = await supabase.rpc("get_discover_matches", {
    p_user_id: profile.id,
    p_scope: scope,
    p_verified_drivers_only: filters.verifiedDriversOnly,
    p_min_reliability: filters.minReliability,
    p_gender_filter: filters.genderFilter,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data as DiscoverMatch[];
}

export async function autoAssignDriverForRequest(requestId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("auto_assign_driver_for_request", {
    p_request_id: requestId,
  });

  if (error || !data) return false;
  const payload = data as { ok?: boolean };
  return payload.ok === true;
}
