import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
  Switch,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { getNetworkInsights } from "@/lib/networkInsights";
import {
  getRideCardsForViewer,
  type RideOpportunityCard,
  reserveRideOpportunity,
} from "@/lib/matching";
import { canViewerActAsDriver } from "@/lib/commuteMatching";
import { useDiscoverMapLayers } from "@/hooks/useDiscoverMapLayers";
import { DiscoverMapLayers } from "@/components/maps/DiscoverMapLayers";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

function filterPassengerCards(
  cards: RideOpportunityCard[],
  search: string,
  minReliability: number
): RideOpportunityCard[] {
  const q = search.trim().toLowerCase();
  return cards.filter((c) => {
    if (minReliability > 0 && c.trustReliability < minReliability) return false;
    if (!q) return true;
    return (
      c.vehicleClassLabel.toLowerCase().includes(q) ||
      String(c.overlapPercent).includes(q)
    );
  });
}

function filterDriverCards(
  cards: RideOpportunityCard[],
  search: string,
  minReliability: number
): RideOpportunityCard[] {
  const q = search.trim().toLowerCase();
  return cards.filter((c) => {
    if (minReliability > 0 && c.counterpartyReliability < minReliability) return false;
    if (!q) return true;
    return c.vehicleClassLabel.toLowerCase().includes(q);
  });
}

export default function Discover() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const rideOpportunitiesOffset = useRef(0);

  const [search, setSearch] = useState("");
  const [nearbyCount, setNearbyCount] = useState(0);
  const [orgCount, setOrgCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [rideOpportunities, setRideOpportunities] = useState<RideOpportunityCard[]>([]);
  const [ridesLoading, setRidesLoading] = useState(false);
  const [driverRideOpportunities, setDriverRideOpportunities] = useState<RideOpportunityCard[]>([]);
  const [driverRidesLoading, setDriverRidesLoading] = useState(false);
  const [orgAllowsCrossOrg, setOrgAllowsCrossOrg] = useState(false);
  const [outerRiderWarningOpen, setOuterRiderWarningOpen] = useState(false);
  const [minReliability, setMinReliability] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const {
    demandPoints,
    supplyPoints,
    routeLines,
    reload: reloadMapLayers,
    loading: mapLayersLoading,
    error: mapLayersError,
    hasMapData,
  } = useDiscoverMapLayers(profile ?? null);

  const mapFallbackCenter = useMemo((): [number, number] => {
    if (!profile) return [138.6, -34.85];
    const home = parseGeoPoint(profile.home_location as unknown);
    if (home) return [home.lng, home.lat];
    const work = parseGeoPoint(profile.work_location as unknown);
    if (work) return [work.lng, work.lat];
    return [138.6, -34.85];
  }, [profile]);

  const filteredPassenger = useMemo(
    () => filterPassengerCards(rideOpportunities, search, minReliability),
    [rideOpportunities, search, minReliability]
  );

  const filteredDriver = useMemo(
    () => filterDriverCards(driverRideOpportunities, search, minReliability),
    [driverRideOpportunities, search, minReliability]
  );

  const loadInsights = useCallback(async () => {
    if (!profile) return;
    const insights = await getNetworkInsights(profile);
    setOrgCount(insights.orgRouteCount);
    setNearbyCount(insights.nearbyRouteCount);
    setMatchCount(insights.potentialMatches);
  }, [profile]);

  const loadRideCards = useCallback(async () => {
    if (!profile) return;
    setRidesLoading(true);
    try {
      const cards = await getRideCardsForViewer(profile, "passenger");
      setRideOpportunities(cards);
    } finally {
      setRidesLoading(false);
    }
  }, [profile]);

  const loadDriverRideCards = useCallback(async () => {
    if (!profile || !canViewerActAsDriver(profile) || !profile.org_id) {
      setDriverRideOpportunities([]);
      return;
    }
    setDriverRidesLoading(true);
    try {
      const cards = await getRideCardsForViewer(profile, "driver");
      setDriverRideOpportunities(cards);
    } finally {
      setDriverRidesLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    void loadRideCards();
  }, [loadRideCards]);

  useEffect(() => {
    void loadDriverRideCards();
  }, [loadDriverRideCards]);

  useEffect(() => {
    async function loadOrgCross() {
      if (!profile?.org_id) {
        setOrgAllowsCrossOrg(false);
        return;
      }
      const { data } = await supabase
        .from("organisations")
        .select("allow_cross_org")
        .eq("id", profile.org_id)
        .maybeSingle();
      setOrgAllowsCrossOrg(data?.allow_cross_org === true);
    }
    void loadOrgCross();
  }, [profile?.org_id]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      reloadMapLayers();
      await loadInsights();
      await loadRideCards();
      await loadDriverRideCards();
    } finally {
      setRefreshing(false);
    }
  }

  async function setDriverOuterNetworkRiders(enabled: boolean) {
    if (!profile?.id) return;
    const { error } = await supabase
      .from("users")
      .update({ driver_show_outer_network_riders: enabled })
      .eq("id", profile.id);
    if (!error) await refreshProfile();
  }

  async function setVisibilityMode(mode: "network" | "nearby") {
    if (!profile?.id || profile.visibility_mode === mode) return;
    const { error } = await supabase
      .from("users")
      .update({ visibility_mode: mode })
      .eq("id", profile.id);
    if (!error) await refreshProfile();
  }

  function scrollToRideOpportunities() {
    const y = Math.max(0, rideOpportunitiesOffset.current - 24);
    scrollRef.current?.scrollTo({ y, animated: true });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        style={styles.safe}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={Colors.primary} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
          <Text style={styles.subtitle}>
            Map, route overlap, and seats you can reserve — without leaving this screen.
          </Text>
          <View style={styles.visibilityRow}>
            <TouchableOpacity
              style={[
                styles.visibilityChip,
                profile?.visibility_mode !== "nearby" && styles.visibilityChipActive,
              ]}
              onPress={() => setVisibilityMode("network")}
            >
              <Text
                style={[
                  styles.visibilityText,
                  profile?.visibility_mode !== "nearby" && styles.visibilityTextActive,
                ]}
              >
                Your network
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.visibilityChip,
                profile?.visibility_mode === "nearby" && styles.visibilityChipActive,
              ]}
              onPress={() => setVisibilityMode("nearby")}
            >
              <Text
                style={[
                  styles.visibilityText,
                  profile?.visibility_mode === "nearby" && styles.visibilityTextActive,
                ]}
              >
                Nearby commuters
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Map — high on screen; layers follow visibility + RPC */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Demand &amp; supply map</Text>
            <TouchableOpacity
              style={styles.refreshMapBtn}
              onPress={() => reloadMapLayers()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Refresh map layers"
            >
              <Ionicons name="refresh" size={18} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {mapLayersError ? (
            <View style={styles.mapErrorBanner}>
              <Ionicons name="warning-outline" size={18} color={Colors.error} />
              <Text style={styles.mapErrorText}>{mapLayersError}</Text>
            </View>
          ) : null}
          <DiscoverMapLayers
            demandGeoJson={demandPoints}
            supplyGeoJson={supplyPoints}
            routeGeoJson={routeLines}
            title="Network activity"
            mapHeight={Platform.OS === "web" ? 320 : 340}
            fallbackCenter={mapFallbackCenter}
            remoteLoading={mapLayersLoading}
          />
          {!hasMapData && !mapLayersLoading && !mapLayersError ? (
            <Text style={styles.mapFootnote}>
              No plotted commuters in this scope yet. Save home &amp; work routes under Profile →
              Commute, or switch to Nearby commuters.
            </Text>
          ) : null}
        </View>

        {/* Snapshot */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Route overlap snapshot</Text>
          <View style={styles.snapshotCard}>
            <Text style={styles.snapshotBig}>{matchCount}</Text>
            <Text style={styles.snapshotLabel}>
              peers with geometry overlap (org / network context)
            </Text>
            <View style={styles.snapshotRow}>
              <View style={styles.snapshotStat}>
                <Text style={styles.snapshotStatVal}>{orgCount}</Text>
                <Text style={styles.snapshotStatLab}>Org context</Text>
              </View>
              <View style={styles.snapshotStat}>
                <Text style={styles.snapshotStatVal}>{nearbyCount}</Text>
                <Text style={styles.snapshotStatLab}>Nearby hint</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Filters that affect lists below */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Filter opportunities</Text>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by vehicle type or overlap %…"
              placeholderTextColor={Colors.textTertiary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <Text style={styles.filterHint}>Minimum driver / rider reliability (cards below)</Text>
          <View style={styles.filterRow}>
            {[0, 60, 75].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.filterChip, minReliability === r && styles.filterChipActive]}
                onPress={() => setMinReliability(r)}
              >
                <Text style={[styles.filterText, minReliability === r && styles.filterTextActive]}>
                  {r === 0 ? "Any" : `${r}+`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {profile?.visibility_mode === "nearby" && (
          <View style={styles.trustNote}>
            <Ionicons name="shield-checkmark-outline" size={18} color={Colors.primary} />
            <Text style={styles.trustText}>
              Nearby mode widens the map. Trust scores on cards still apply — verify identity before
              you travel.
            </Text>
          </View>
        )}

        {profile && canViewerActAsDriver(profile) && profile.org_id ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Driving · riders on your route</Text>
            <Text style={styles.privacyNote}>
              Colleagues and (if enabled) matched riders outside your org who fit your corridor.
            </Text>
            <View style={styles.driverOuterRow}>
              <View style={styles.driverOuterLabels}>
                <Text style={styles.driverOuterTitle}>Show riders outside my organization</Text>
                <Text style={styles.driverOuterHint}>
                  {orgAllowsCrossOrg
                    ? "Optional. You can keep this off and only plan for colleagues."
                    : "Your organization has not enabled cross-network visibility."}
                </Text>
              </View>
              <Switch
                value={profile.driver_show_outer_network_riders === true}
                onValueChange={(on) => {
                  if (!orgAllowsCrossOrg) {
                    showAlert(
                      "Not available",
                      "Your organization has not enabled cross-network commute visibility."
                    );
                    return;
                  }
                  if (on) setOuterRiderWarningOpen(true);
                  else void setDriverOuterNetworkRiders(false);
                }}
                disabled={!orgAllowsCrossOrg}
                trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                thumbColor={Colors.surface}
              />
            </View>
            {driverRidesLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
            ) : filteredDriver.length === 0 ? (
              <Text style={styles.emptyMeta}>
                No rider matches on your route yet, or colleagues have not finished commute setup.
              </Text>
            ) : (
              filteredDriver.map((c) => (
                <View key={`d-${c.opportunityId}`} style={styles.matchCard}>
                  <View style={styles.matchRow}>
                    <Text style={styles.matchName}>
                      Route overlap · rel. {c.counterpartyReliability}
                      {c.matchScope === "outer_network" ? " · Outside your org" : ""}
                    </Text>
                    <Text style={styles.matchScore}>{c.overlapPercent}% share</Text>
                  </View>
                  <Text style={styles.matchMeta}>
                    Adds ~{c.detourMinutes} min detour · est. contribution for them{" "}
                    {(c.passengerCostCents / 100).toFixed(2)} (incl. $1 stop fee)
                  </Text>
                  <Text style={styles.driverRiderFootnote}>
                    Riders book from their app. You&apos;ll see confirmed pickups under My Rides.
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        <View
          style={styles.section}
          onLayout={(e) => {
            rideOpportunitiesOffset.current = e.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.sectionTitle}>Ride opportunities</Text>
          <Text style={styles.privacyNote}>
            Geometry-matched seats. Driver details stay private until you reserve.
          </Text>
          {ridesLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
          ) : filteredPassenger.length === 0 ? (
            <Text style={styles.emptyMeta}>
              No opportunities match your filters. Try lowering reliability, clear search, or
              finish commute setup in Profile.
            </Text>
          ) : (
            filteredPassenger.map((c) => (
              <View key={c.opportunityId} style={styles.matchCard}>
                <View style={styles.matchRow}>
                  <Text style={styles.matchName}>
                    {c.vehicleClassLabel} · {c.seatsAvailable} seats
                  </Text>
                  <Text style={styles.matchScore}>{c.overlapPercent}% route share</Text>
                </View>
                <Text style={styles.matchMeta}>
                  Pickup {c.pickupEtaLabel} · +{c.detourMinutes} min detour · reliability{" "}
                  {c.trustReliability}
                </Text>
                <Text style={styles.costLine}>
                  Est. contribution {(c.passengerCostCents / 100).toFixed(2)} (incl. $1 stop fee)
                </Text>
                <TouchableOpacity
                  style={styles.reserveBtn}
                  onPress={async () => {
                    const res = await reserveRideOpportunity(c);
                    if (res.ok) {
                      showAlert(
                        "Seat reserved",
                        "The driver has been notified. Check My Rides for next steps."
                      );
                      void loadRideCards();
                    } else {
                      showAlert("Could not reserve", res.reason ?? "Try another opportunity.");
                    }
                  }}
                >
                  <Text style={styles.reserveBtnText}>Reserve seat (~2 min hold)</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <View style={styles.footerActions}>
          <TouchableOpacity
            style={styles.primaryFooterBtn}
            activeOpacity={0.88}
            onPress={() => router.push("/(tabs)/rides")}
          >
            <Ionicons name="car-outline" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.primaryFooterBtnText}>
              {profile?.role === "driver" || profile?.role === "both"
                ? "Offer a ride"
                : "My rides"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryFooterBtn}
            activeOpacity={0.88}
            onPress={scrollToRideOpportunities}
          >
            <Ionicons name="arrow-down-circle-outline" size={22} color={Colors.primary} />
            <Text style={styles.secondaryFooterBtnText}>Jump to opportunities</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={outerRiderWarningOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOuterRiderWarningOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOuterRiderWarningOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Outside your organization</Text>
            <Text style={styles.crossNetWarningBody}>
              Riders shown here are not verified members of your workplace network. Trips are between
              you and them. Poolyn does not guarantee safety, identity, or insurance. Use your own
              judgment. You can turn this off anytime.
            </Text>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setOuterRiderWarningOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => {
                  setOuterRiderWarningOpen(false);
                  void setDriverOuterNetworkRiders(true);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCloseText}>Show outer-network riders</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: Spacing["5xl"],
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.xs,
  },
  visibilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  visibilityChip: {
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  visibilityChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  visibilityText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.semibold,
  },
  visibilityTextActive: {
    color: Colors.textOnPrimary,
  },
  section: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
    letterSpacing: -0.2,
  },
  refreshMapBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.primary,
    marginBottom: Spacing.sm,
  },
  mapErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: "#FEF2F2",
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  mapErrorText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.error,
    lineHeight: 20,
  },
  mapFootnote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    lineHeight: 18,
    paddingHorizontal: Spacing.xs,
  },
  snapshotCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  snapshotBig: {
    fontSize: 40,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
    letterSpacing: -1,
  },
  snapshotLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  snapshotRow: {
    flexDirection: "row",
    gap: Spacing.lg,
  },
  snapshotStat: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  snapshotStatVal: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  snapshotStatLab: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  filterHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  filterChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  filterText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.semibold,
  },
  filterTextActive: {
    color: Colors.primaryDark,
  },
  trustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  trustText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    lineHeight: 18,
  },
  privacyNote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  matchCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  matchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
  },
  matchName: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: FontWeight.semibold,
    flex: 1,
  },
  matchScore: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: FontWeight.bold,
  },
  matchMeta: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  costLine: {
    fontSize: FontSize.sm,
    color: Colors.text,
    marginTop: Spacing.sm,
    fontWeight: FontWeight.semibold,
  },
  reserveBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  reserveBtnText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  emptyMeta: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    fontStyle: "italic",
    paddingVertical: Spacing.sm,
    lineHeight: 20,
  },
  driverOuterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  driverOuterLabels: { flex: 1 },
  driverOuterTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  driverOuterHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 4,
    lineHeight: 17,
  },
  driverRiderFootnote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    lineHeight: 17,
  },
  footerActions: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  primaryFooterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  primaryFooterBtnText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
  secondaryFooterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  secondaryFooterBtnText: {
    color: Colors.primary,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  modalCloseBtn: {
    alignSelf: "flex-end",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  modalCloseText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  crossNetWarningBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  modalBtnRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  modalCancelBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
});
