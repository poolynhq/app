import { supabase } from "@/lib/supabase";
import { User } from "@/types/database";

export interface NetworkInsights {
  orgRouteCount: number;
  nearbyRouteCount: number;
  potentialMatches: number;
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function getNetworkInsights(
  profile: User
): Promise<NetworkInsights> {
  if (!profile.home_location || !profile.work_location) {
    const { count } = profile.org_id
      ? await supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .neq("id", profile.id)
          .eq("active", true)
          .eq("onboarding_completed", true)
          .eq("org_id", profile.org_id)
      : { count: 0 };

    const orgRouteCount = normalizeCount(count);
    return { orgRouteCount, nearbyRouteCount: 0, potentialMatches: orgRouteCount };
  }

  const { data, error } = await supabase.rpc("count_geometry_match_peers", {
    p_user_id: profile.id,
  });

  if (error) {
    return { orgRouteCount: 0, nearbyRouteCount: 0, potentialMatches: 0 };
  }

  const n = normalizeCount(data as number);
  return {
    orgRouteCount: n,
    nearbyRouteCount: 0,
    potentialMatches: n,
  };
}
