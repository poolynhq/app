import { useMemo, useState, useCallback, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { effectiveCommuteMode } from "@/lib/commuteRoleIntent";
import { useDiscoverMapLayers } from "@/hooks/useDiscoverMapLayers";
import { DiscoverMapLayers } from "@/components/maps/DiscoverMapLayers";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { useDiscoverViewerLayers } from "@/hooks/useDiscoverViewerLayers";
import { mapLayerEmphasisForProfile } from "@/lib/mapLayerEmphasis";
import {
  countPickupDemandByCorridorDisjoint,
  filterPointsToViewerCorridors,
  filterRouteLinesToViewerCorridors,
  formatDisjointCorridorPickupSummary,
} from "@/lib/discoverRouteDemand";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  RoleTheme,
} from "@/constants/theme";
import { viewerMyRoutesDisplayCollection } from "@/lib/viewerRoutePrimarySwap";

type Props = {
  /** Updates visibility in profile (from Home). Map refreshes when `profile.visibility_mode` changes. */
  setVisibilityMode: (mode: "network" | "nearby") => void | Promise<void>;
};

/**
 * Driving vs riding, corridor scope, and live demand map (Mingle Poolyn on Home only).
 */
export function MinglePoolynHomePanel({ setVisibilityMode }: Props) {
  const { profile, toggleMode } = useAuth();
  const [viewerMapRefetchTick, setViewerMapRefetchTick] = useState(0);
  const [promotedViewerRouteKey, setPromotedViewerRouteKey] = useState<string | null>(null);

  const {
    demandPoints,
    supplyPoints,
    routeLines,
    reload: reloadMapLayers,
    loading: mapLayersLoading,
  } = useDiscoverMapLayers(profile ?? null);

  const {
    viewerPinsGeoJson,
    viewerMyRoutesGeoJson,
    routeCorridors,
    routesLoading,
  } = useDiscoverViewerLayers(profile ?? null, viewerMapRefetchTick);

  useFocusEffect(
    useCallback(() => {
      void reloadMapLayers();
      setViewerMapRefetchTick((t) => t + 1);
    }, [reloadMapLayers])
  );

  useEffect(() => {
    void reloadMapLayers();
    setViewerMapRefetchTick((t) => t + 1);
  }, [profile?.visibility_mode, reloadMapLayers]);

  useEffect(() => {
    const t = setInterval(() => {
      void reloadMapLayers();
      setViewerMapRefetchTick((n) => n + 1);
    }, 90_000);
    return () => clearInterval(t);
  }, [reloadMapLayers]);

  const mapFallbackCenter = useMemo((): [number, number] => {
    if (!profile) return [138.6, -34.85];
    const home = parseGeoPoint(profile.home_location as unknown);
    if (home) return [home.lng, home.lat];
    const work = parseGeoPoint(profile.work_location as unknown);
    if (work) return [work.lng, work.lat];
    return [138.6, -34.85];
  }, [profile]);

  const layerEmphasis = useMemo(
    () => mapLayerEmphasisForProfile(profile ?? null),
    [profile, profile?.active_mode]
  );

  const mapDemandPoints = useMemo(
    () => filterPointsToViewerCorridors(demandPoints, routeCorridors),
    [demandPoints, routeCorridors]
  );
  const mapSupplyPoints = useMemo(
    () => filterPointsToViewerCorridors(supplyPoints, routeCorridors),
    [supplyPoints, routeCorridors]
  );
  const mapRouteLines = useMemo(
    () => filterRouteLinesToViewerCorridors(routeLines, routeCorridors),
    [routeLines, routeCorridors]
  );

  const routeCorridorDemandLine = useMemo(() => {
    if (layerEmphasis !== "demand" || routeCorridors.length === 0) return "";
    const r = countPickupDemandByCorridorDisjoint(mapDemandPoints, routeCorridors);
    return formatDisjointCorridorPickupSummary(r);
  }, [layerEmphasis, mapDemandPoints, routeCorridors]);

  const viewerRouteBaselineKey = useMemo(
    () =>
      viewerMyRoutesGeoJson.features
        .map((f) => String((f.properties as { route_key?: string } | null)?.route_key ?? ""))
        .join("|"),
    [viewerMyRoutesGeoJson]
  );

  useEffect(() => {
    setPromotedViewerRouteKey(null);
  }, [viewerRouteBaselineKey]);

  const viewerRoutesDisplayed = useMemo(
    () => viewerMyRoutesDisplayCollection(viewerMyRoutesGeoJson, promotedViewerRouteKey),
    [viewerMyRoutesGeoJson, promotedViewerRouteKey]
  );

  const hasViewerRouteAlternates = useMemo(
    () =>
      viewerMyRoutesGeoJson.features.some((f) =>
        String((f.properties as { route_key?: string } | null)?.route_key ?? "").startsWith("alt_")
      ),
    [viewerMyRoutesGeoJson]
  );

  if (!profile) return null;

  const intent = effectiveCommuteMode(profile);
  const drivingActive = intent === "driver";
  const ridingActive = intent === "passenger";
  const needsIntentPick = profile.role === "both" && profile.active_mode == null;

  const onPickDriving = () => {
    void toggleMode("driver");
  };

  const onPickRiding = () => {
    void toggleMode("passenger");
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.roleWrap}>
        <View style={styles.modeBlock}>
          <Text style={styles.modeQuestion}>How are you commuting today?</Text>
          <View style={styles.modeSegmentRow}>
            <TouchableOpacity
              style={[
                styles.modeSegment,
                drivingActive ? styles.modeSegmentDrivingOn : styles.modeSegmentOff,
              ]}
              onPress={onPickDriving}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: drivingActive }}
            >
              <Ionicons
                name="car-sport-outline"
                size={18}
                color={drivingActive ? "#FFFFFF" : Colors.textSecondary}
              />
              <Text style={[styles.modeSegmentLabel, drivingActive && styles.modeSegmentLabelOn]}>Driving</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeSegment,
                ridingActive ? styles.modeSegmentRidingOn : styles.modeSegmentOff,
              ]}
              onPress={onPickRiding}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: ridingActive }}
            >
              <Ionicons
                name="people-outline"
                size={18}
                color={ridingActive ? "#FFFFFF" : Colors.textSecondary}
              />
              <Text style={[styles.modeSegmentLabel, ridingActive && styles.modeSegmentLabelOn]}>Riding</Text>
            </TouchableOpacity>
          </View>
          {needsIntentPick ? (
            <Text style={styles.modeNeutralHint}>Pick Driving or Riding so the map matches your plan.</Text>
          ) : (
            <Text style={styles.modePersistHint}>Saved until you change it here (including after crew trips).</Text>
          )}
        </View>
        <View style={styles.visibilityRow}>
          <TouchableOpacity
            style={[
              styles.visibilityChip,
              profile.visibility_mode !== "nearby" && styles.visibilityChipActive,
            ]}
            onPress={() => void setVisibilityMode("network")}
          >
            <Text
              style={[
                styles.visibilityText,
                profile.visibility_mode !== "nearby" && styles.visibilityTextActive,
              ]}
            >
              Your network
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.visibilityChip,
              profile.visibility_mode === "nearby" && styles.visibilityChipActiveMingle,
            ]}
            onPress={() => void setVisibilityMode("nearby")}
          >
            <Text
              style={[
                styles.visibilityText,
                profile.visibility_mode === "nearby" && styles.visibilityTextActive,
              ]}
            >
              Any commuter
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.mapLabel}>Live demand map</Text>
      {routeCorridorDemandLine ? (
        <Text style={styles.mapCorridorHint}>{routeCorridorDemandLine}</Text>
      ) : null}
      <DiscoverMapLayers
        demandGeoJson={mapDemandPoints}
        supplyGeoJson={mapSupplyPoints}
        routeGeoJson={mapRouteLines}
        viewerPinsGeoJson={viewerPinsGeoJson}
        viewerMyRoutesGeoJson={viewerRoutesDisplayed}
        layerEmphasis={layerEmphasis}
        title="Corridor map"
        mapHeight={220}
        fallbackCenter={mapFallbackCenter}
        remoteLoading={mapLayersLoading || routesLoading}
        compactMapChrome
        onViewerRouteAlternateTap={
          hasViewerRouteAlternates ? (key) => setPromotedViewerRouteKey(key) : undefined
        }
      />
      {intent === "passenger" ? (
        <Text style={styles.mapFootnote}>
          Green dots: other drivers by saved commute area, not live GPS. Live positions only if someone shares
          location on an active trip.
        </Text>
      ) : intent === "driver" ? (
        <Text style={styles.mapFootnote}>
          Orange: rider interest near commute pins and open pickup requests when your scope includes them.
        </Text>
      ) : null}
    </View>
  );
}

const MINGLE_AMBER = "#D97706";

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  roleWrap: {
    gap: Spacing.sm,
  },
  modeBlock: {
    gap: Spacing.xs,
  },
  modeQuestion: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
  modeSegmentRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  modeSegment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
  },
  modeSegmentOff: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  modeSegmentDrivingOn: {
    backgroundColor: RoleTheme.driver.primary,
    borderColor: RoleTheme.driver.primary,
  },
  modeSegmentRidingOn: {
    backgroundColor: RoleTheme.passenger.primary,
    borderColor: RoleTheme.passenger.primary,
  },
  modeSegmentLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  modeSegmentLabelOn: {
    color: "#FFFFFF",
  },
  visibilityRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  visibilityChip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  visibilityChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  visibilityChipActiveMingle: {
    backgroundColor: MINGLE_AMBER,
    borderColor: "#B45309",
  },
  visibilityText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  visibilityTextActive: {
    color: Colors.textOnPrimary,
  },
  modeNeutralHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  modePersistHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 16,
  },
  mapLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  mapCorridorHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 18,
    marginBottom: Spacing.xs,
    fontWeight: FontWeight.semibold,
  },
  mapFootnote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 17,
    marginTop: Spacing.xs,
  },
});
