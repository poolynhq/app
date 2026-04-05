import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@/types/database";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { buildViewerPinsOnly } from "@/lib/viewerCommuteMapMarkers";
import {
  buildDiscoverViewerRouteFeatures,
  type DiscoverRouteCorridor,
} from "@/lib/discoverMapViewerRoutes";

/**
 * Home/work pins plus driving routes (stored commute_routes geometry + Mapbox alternates when configured).
 * Matches Profile → Commute preview logic; excludes straight “crow” lines on discover/home maps.
 */
export function useDiscoverViewerLayers(profile: User | null, refetchSignal = 0) {
  const [raw, setRaw] = useState<{ home: unknown; work: unknown } | null>(null);
  const [routeFeatures, setRouteFeatures] = useState<GeoJSON.Feature[]>([]);
  const [routeCorridors, setRouteCorridors] = useState<DiscoverRouteCorridor[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) {
      setRaw(null);
      setRouteFeatures([]);
      setRouteCorridors([]);
      return;
    }

    setRoutesLoading(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("home_location, work_location")
        .eq("id", profile.id)
        .maybeSingle();

      if (error || !data) {
        setRaw(null);
        setRouteFeatures([]);
        setRouteCorridors([]);
        return;
      }

      setRaw({ home: data.home_location, work: data.work_location });

      const home = parseGeoPoint(data.home_location);
      const work = parseGeoPoint(data.work_location);

      if (!home || !work) {
        setRouteFeatures([]);
        setRouteCorridors([]);
        return;
      }

      const { data: storedGeom, error: rpcErr } = await supabase.rpc("get_my_commute_route_geojson", {
        p_direction: "to_work",
      });
      const geom = rpcErr ? null : storedGeom;

      const built = await buildDiscoverViewerRouteFeatures(home, work, geom);
      setRouteFeatures(built.features);
      setRouteCorridors(built.routeCorridors);
    } finally {
      setRoutesLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    void load();
  }, [load, profile?.updated_at, refetchSignal]);

  const viewerPinsGeoJson = useMemo(
    () =>
      buildViewerPinsOnly(
        raw?.home ?? profile?.home_location,
        raw?.work ?? profile?.work_location
      ),
    [raw, profile?.home_location, profile?.work_location]
  );

  const viewerMyRoutesGeoJson = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: routeFeatures,
    }),
    [routeFeatures]
  );

  return {
    viewerPinsGeoJson,
    viewerMyRoutesGeoJson,
    routeCorridors,
    routesLoading,
  };
}
