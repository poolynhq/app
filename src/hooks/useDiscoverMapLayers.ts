import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { User } from "@/types/database";

interface MapLayerPayload {
  demand_points: GeoJSON.FeatureCollection;
  supply_points: GeoJSON.FeatureCollection;
  route_lines: GeoJSON.FeatureCollection;
}

const emptyFeatureCollection: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export function useDiscoverMapLayers(profile: User | null) {
  const [demandPoints, setDemandPoints] = useState<GeoJSON.FeatureCollection>(
    emptyFeatureCollection
  );
  const [supplyPoints, setSupplyPoints] = useState<GeoJSON.FeatureCollection>(
    emptyFeatureCollection
  );
  const [routeLines, setRouteLines] = useState<GeoJSON.FeatureCollection>(
    emptyFeatureCollection
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMapLayers() {
      if (!profile?.id) {
        setDemandPoints(emptyFeatureCollection);
        setSupplyPoints(emptyFeatureCollection);
        setRouteLines(emptyFeatureCollection);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc("get_map_layers_for_discover", {
        p_user_id: profile.id,
        p_scope: profile.visibility_mode === "nearby" ? "extended" : "network",
      });

      if (cancelled) return;

      if (rpcError || !data) {
        setDemandPoints(emptyFeatureCollection);
        setSupplyPoints(emptyFeatureCollection);
        setRouteLines(emptyFeatureCollection);
        setError(rpcError?.message ?? "Could not load map");
        setLoading(false);
        return;
      }

      const payload = data as unknown as MapLayerPayload;
      setDemandPoints(payload.demand_points ?? emptyFeatureCollection);
      setSupplyPoints(payload.supply_points ?? emptyFeatureCollection);
      setRouteLines(payload.route_lines ?? emptyFeatureCollection);
      setLoading(false);
    }

    void loadMapLayers();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.visibility_mode, reloadToken]);

  const hasMapData =
    demandPoints.features.length > 0 ||
    supplyPoints.features.length > 0 ||
    routeLines.features.length > 0;

  return {
    demandPoints,
    supplyPoints,
    routeLines,
    reload,
    loading,
    error,
    hasMapData,
  };
}
