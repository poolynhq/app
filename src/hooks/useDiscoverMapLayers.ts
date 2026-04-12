import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Avoid flashing the map to empty on background refresh once we have shown data. */
  const hadLayerDataRef = useRef(false);

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
    hadLayerDataRef.current = false;
  }, [profile?.id, profile?.visibility_mode]);

  useEffect(() => {
    let cancelled = false;

    async function loadMapLayers() {
      if (!profile?.id) {
        setDemandPoints(emptyFeatureCollection);
        setSupplyPoints(emptyFeatureCollection);
        setRouteLines(emptyFeatureCollection);
        setLoading(false);
        setError(null);
        hadLayerDataRef.current = false;
        return;
      }

      if (!hadLayerDataRef.current) {
        setLoading(true);
      }
      setError(null);

      const { data, error: rpcError } = await supabase.rpc("get_map_layers_for_discover", {
        p_user_id: profile.id,
        p_scope: profile.visibility_mode === "nearby" ? "extended" : "network",
      });

      if (cancelled) return;

      if (rpcError || !data) {
        if (!hadLayerDataRef.current) {
          setDemandPoints(emptyFeatureCollection);
          setSupplyPoints(emptyFeatureCollection);
          setRouteLines(emptyFeatureCollection);
        }
        setError(rpcError?.message ?? "Could not load map");
        setLoading(false);
        return;
      }

      const payload = data as unknown as MapLayerPayload;
      const d = payload.demand_points ?? emptyFeatureCollection;
      const s = payload.supply_points ?? emptyFeatureCollection;
      const r = payload.route_lines ?? emptyFeatureCollection;
      setDemandPoints(d);
      setSupplyPoints(s);
      setRouteLines(r);
      const any =
        d.features.length > 0 || s.features.length > 0 || r.features.length > 0;
      if (any) hadLayerDataRef.current = true;
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
