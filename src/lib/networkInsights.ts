import { supabase } from "@/lib/supabase";
import { User } from "@/types/database";

export interface NetworkInsights {
  /** Peers passing geometry prefilter (strict pool). */
  orgRouteCount: number;
  /** Extra peers when extended / cross-org pool is included (not double-counted). */
  nearbyRouteCount: number;
  /** Same as geometryPeers: overlap-based count for hero stat. */
  potentialMatches: number;
  /** Colleagues in your org with a saved to_work route (excludes self). */
  orgCommutersWithRoute: number;
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
    return {
      orgRouteCount,
      nearbyRouteCount: 0,
      potentialMatches: orgRouteCount,
      orgCommutersWithRoute: orgRouteCount,
    };
  }

  const { data, error } = await supabase.rpc("get_discover_route_snapshot", {
    p_user_id: profile.id,
  });

  if (error || !data || typeof data !== "object") {
    return {
      orgRouteCount: 0,
      nearbyRouteCount: 0,
      potentialMatches: 0,
      orgCommutersWithRoute: 0,
    };
  }

  const row = data as Record<string, unknown>;
  if (row.error === "forbidden") {
    return {
      orgRouteCount: 0,
      nearbyRouteCount: 0,
      potentialMatches: 0,
      orgCommutersWithRoute: 0,
    };
  }

  const geometryPeers = normalizeCount(row.geometry_peers as number);
  const geometryExtended = normalizeCount(row.geometry_peers_extended as number);
  const orgCommuters = normalizeCount(row.org_commuters_with_route as number);

  return {
    potentialMatches: geometryPeers,
    orgRouteCount: orgCommuters,
    nearbyRouteCount: Math.max(0, geometryExtended - geometryPeers),
    orgCommutersWithRoute: orgCommuters,
  };
}
