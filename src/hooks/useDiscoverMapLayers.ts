import { useEffect, useState } from "react";
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

  useEffect(() => {
    async function loadMapLayers() {
      if (!profile?.id) return;

      const { data, error } = await supabase.rpc("get_map_layers_for_discover", {
        p_user_id: profile.id,
        p_scope: profile.visibility_mode === "nearby" ? "extended" : "network",
      });

      if (error || !data) {
        setDemandPoints(emptyFeatureCollection);
        setSupplyPoints(emptyFeatureCollection);
        setRouteLines(emptyFeatureCollection);
        return;
      }

      const payload = data as unknown as MapLayerPayload;
      setDemandPoints(payload.demand_points ?? emptyFeatureCollection);
      setSupplyPoints(payload.supply_points ?? emptyFeatureCollection);
      setRouteLines(payload.route_lines ?? emptyFeatureCollection);
    }

    loadMapLayers();
  }, [profile?.id, profile?.visibility_mode]);

  return { demandPoints, supplyPoints, routeLines };
}
