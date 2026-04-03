import { useEffect, useRef, useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { getNetworkInsights } from "@/lib/networkInsights";
import {
  DiscoverMatch,
  getDiscoverMatches,
  getRideCardsForViewer,
  type RideOpportunityCard,
  reserveRideOpportunity,
} from "@/lib/matching";
import { canViewerActAsDriver } from "@/lib/commuteMatching";
import { useDiscoverMapLayers } from "@/hooks/useDiscoverMapLayers";
import { DiscoverMapLayers } from "@/components/maps/DiscoverMapLayers";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type VisibilityScope = "network" | "nearby" | "all";

export default function Discover() {
  const { profile, refreshProfile } = useAuth();
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
  const [matches, setMatches] = useState<DiscoverMatch[]>([]);
  const [scope, setScope] = useState<VisibilityScope>("all");
  const scopeInitKeySeen = useRef("");
  const [peerModal, setPeerModal] = useState<{
    peerId: string;
    displayName: string;
    badgeText: string | null;
  } | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [minReliability, setMinReliability] = useState(0);
  const [genderFilter, setGenderFilter] = useState<
    "any" | "male" | "female" | "non_binary" | "prefer_not_to_say"
  >("any");
  const { demandPoints, supplyPoints, routeLines } = useDiscoverMapLayers(profile ?? null);

  useEffect(() => {
    if (!profile?.id) {
      scopeInitKeySeen.current = "";
      return;
    }
    const key = `${profile.id}:${profile.org_id ?? ""}`;
    if (scopeInitKeySeen.current === key) return;
    scopeInitKeySeen.current = key;
    setScope(profile.org_id ? "network" : "all");
  }, [profile?.id, profile?.org_id]);

  async function openLegacyMatchPeer(m: DiscoverMatch) {
    if (!profile) return;
    const viewerIsDriver = profile.id === m.driver_id;
    const peerId = viewerIsDriver ? m.passenger_id : m.driver_id;
    const displayName = viewerIsDriver
      ? m.passenger_name ?? "Passenger"
      : m.driver_name ?? "Driver";
    setPeerModal({ peerId, displayName, badgeText: null });
    const { data, error } = await supabase.rpc("get_peer_commute_badge", {
      p_peer_id: peerId,
    });
    if (error) {
      setPeerModal((prev) =>
        prev?.peerId === peerId ? { ...prev, badgeText: "Could not load" } : prev
      );
      return;
    }
    const row = data as { explorer?: boolean; org_name?: string | null; org_type?: string | null } | null;
    let badgeText = "…";
    if (row) {
      if (row.explorer) {
        badgeText = "Explorer (independent)";
      } else if (row.org_name) {
        const t = row.org_type ? String(row.org_type) : "";
        badgeText = t ? `${row.org_name} · ${t}` : String(row.org_name);
      } else {
        badgeText = "Network member";
      }
    }
    setPeerModal((prev) =>
      prev?.peerId === peerId ? { ...prev, badgeText } : prev
    );
  }

  useEffect(() => {
    async function loadInsights() {
      if (!profile) return;

      const [insights, discoverMatches] = await Promise.all([
        getNetworkInsights(profile),
        getDiscoverMatches(profile, {
          scope,
          verifiedDriversOnly: verifiedOnly,
          minReliability,
          genderFilter,
        }),
      ]);

      setOrgCount(insights.orgRouteCount);
      setNearbyCount(insights.nearbyRouteCount);
      setMatchCount(insights.potentialMatches);
      setMatches(discoverMatches);
    }
    loadInsights();
  }, [profile, scope, verifiedOnly, minReliability, genderFilter]);

  useEffect(() => {
    async function loadRides() {
      if (!profile) return;
      setRidesLoading(true);
      try {
        const cards = await getRideCardsForViewer(profile, "passenger");
        setRideOpportunities(cards);
      } finally {
        setRidesLoading(false);
      }
    }
    loadRides();
  }, [profile]);

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
    loadOrgCross();
  }, [profile?.org_id]);

  useEffect(() => {
    async function loadDriverRides() {
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
    }
    loadDriverRides();
  }, [profile, profile?.driver_show_outer_network_riders]);

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
    if (!error) {
      await refreshProfile();
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView style={styles.safe} contentContainerStyle={{ paddingBottom: Spacing["5xl"] }}>
        <View style={styles.header}>
          <Text style={styles.title}>Discover</Text>
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
                Your Network
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
                Nearby Commuters
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <View style={styles.searchBar}>
            <Ionicons
              name="search"
              size={20}
              color={Colors.textTertiary}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by destination or suburb..."
              placeholderTextColor={Colors.textTertiary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        {/* Scope + filters */}
        <View style={styles.tabs}>
          {(["all", "network", "nearby"] as VisibilityScope[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.tab, scope === s && styles.tabActive]}
              onPress={() => setScope(s)}
            >
              <Text
                style={[
                  styles.tabText,
                  scope === s && styles.tabTextActive,
                ]}
              >
                {s === "all"
                  ? "All"
                  : s === "network"
                  ? "Org"
                  : "Nearby"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, verifiedOnly && styles.filterChipActive]}
            onPress={() => setVerifiedOnly((v) => !v)}
          >
            <Text style={[styles.filterText, verifiedOnly && styles.filterTextActive]}>
              Verified drivers
            </Text>
          </TouchableOpacity>
          {[0, 60, 75].map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.filterChip, minReliability === r && styles.filterChipActive]}
              onPress={() => setMinReliability(r)}
            >
              <Text style={[styles.filterText, minReliability === r && styles.filterTextActive]}>
                {r === 0 ? "Any reliability" : `${r}+ reliability`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterRow}>
          {(["any", "female", "male"] as const).map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.filterChip, genderFilter === g && styles.filterChipActive]}
              onPress={() => setGenderFilter(g)}
            >
              <Text style={[styles.filterText, genderFilter === g && styles.filterTextActive]}>
                {g === "any" ? "Any gender" : g}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Insight state */}
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="compass-outline" size={48} color={Colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>{matchCount} potential matches found</Text>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>From your organization</Text>
            <Text style={styles.sectionCardBody}>
              {orgCount > 0
                ? `${orgCount} commuters on similar routes`
                : `Be the first in your network. We found ${nearbyCount} nearby commuters instead.`}
            </Text>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>Nearby commuters</Text>
            <Text style={styles.sectionCardBody}>
              {nearbyCount} fallback matches outside your organization
            </Text>
          </View>

          {profile?.visibility_mode === "nearby" && (
            <View style={styles.trustNote}>
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={Colors.primary}
              />
              <Text style={styles.trustText}>
                Trust indicators shown: domain badge, verified driver status, and reliability.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.listSection}>
          <Text style={styles.listTitle}>Demand & supply map</Text>
          <DiscoverMapLayers
            demandGeoJson={demandPoints}
            supplyGeoJson={supplyPoints}
            routeGeoJson={routeLines}
            title="Demand, supply, and route overlap"
          />
        </View>

        {profile && canViewerActAsDriver(profile) && profile.org_id ? (
          <View style={styles.listSection}>
            <Text style={styles.listTitle}>Driving · riders on your route</Text>
            <Text style={styles.privacyNote}>
              By default you only see riders in your organization. Turn on the option below to also
              see riders outside your network when your org allows it.
            </Text>
            <View style={styles.driverOuterRow}>
              <View style={styles.driverOuterLabels}>
                <Text style={styles.driverOuterTitle}>Show riders outside my organization</Text>
                <Text style={styles.driverOuterHint}>
                  {orgAllowsCrossOrg
                    ? "Optional. You can keep this off and only pick up colleagues."
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
            ) : driverRideOpportunities.filter((c) =>
                !search || c.vehicleClassLabel.toLowerCase().includes(search.toLowerCase())
              ).length === 0 ? (
              <Text style={styles.emptyMeta}>
                No rider matches on your route yet, or colleagues have not completed commute setup.
              </Text>
            ) : (
              driverRideOpportunities
                .filter((c) =>
                  !search || c.vehicleClassLabel.toLowerCase().includes(search.toLowerCase())
                )
                .map((c) => (
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
                      Riders book seats from their own app. Cross-network booking may be limited until
                      they can see drivers on their network settings.
                    </Text>
                  </View>
                ))
            )}
          </View>
        ) : null}

        {/* ── Geometry-first ride opportunities (no driver identity pre-confirm) ── */}
        <View style={styles.listSection}>
          <Text style={styles.listTitle}>Ride opportunities (as a rider)</Text>
          <Text style={styles.privacyNote}>
            Cards show route overlap and fair cost share, not driver names until you confirm.
          </Text>
          {ridesLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
          ) : rideOpportunities.filter((c) =>
              !search || c.vehicleClassLabel.toLowerCase().includes(search.toLowerCase())
            ).length === 0 ? (
            <Text style={styles.emptyMeta}>
              No opportunities yet. Complete onboarding with a saved commute route, or check back
              after colleagues add theirs.
            </Text>
          ) : (
            rideOpportunities
              .filter((c) =>
                !search || c.vehicleClassLabel.toLowerCase().includes(search.toLowerCase())
              )
              .map((c) => (
                <View key={c.opportunityId} style={styles.matchCard}>
                  <View style={styles.matchRow}>
                    <Text style={styles.matchName}>{c.vehicleClassLabel} · {c.seatsAvailable} seats</Text>
                    <Text style={styles.matchScore}>{c.overlapPercent}% route share</Text>
                  </View>
                  <Text style={styles.matchMeta}>
                    Pickup ~{c.pickupEtaLabel} · adds {c.detourMinutes} min detour · reliability{" "}
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
                          "The driver has been notified. You will see next steps shortly."
                        );
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

        {/* ── Legacy suggestion list (ride posts) ── */}
        <View style={styles.listSection}>
          <Text style={styles.listTitle}>Posted rides (legacy)</Text>
          {matches.length === 0 ? (
            <Text style={styles.emptyMeta}>No posted rides in this filter.</Text>
          ) : (
            matches.slice(0, 6).map((m) => {
              const inner = (
                <>
                  <View style={styles.matchRow}>
                    <Text style={styles.matchName}>{m.driver_name ?? "Driver"}</Text>
                    <Text style={styles.matchScore}>{Math.round(m.match_score * 100)}%</Text>
                  </View>
                  <Text style={styles.matchMeta}>
                    {m.trust_label} · {m.time_overlap_mins ?? 0} min overlap
                  </Text>
                  {scope !== "network" ? (
                    <Text style={styles.tapHint}>Tap for network / Explorer badge</Text>
                  ) : null}
                </>
              );
              if (scope === "network") {
                return (
                  <View key={m.suggestion_id} style={styles.matchCard}>
                    {inner}
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  key={m.suggestion_id}
                  style={styles.matchCard}
                  activeOpacity={0.85}
                  onPress={() => openLegacyMatchPeer(m)}
                >
                  {inner}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <TouchableOpacity
          style={styles.postBtn}
          activeOpacity={0.8}
        >
          <Ionicons
            name="megaphone-outline"
            size={20}
            color={Colors.primary}
          />
          <Text
            style={styles.postBtnText}
          >
            {profile?.role === "driver" ? "Offer ride" : "Request ride"}
          </Text>
        </TouchableOpacity>
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

      <Modal
        visible={peerModal != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPeerModal(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPeerModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{peerModal?.displayName}</Text>
            <Text style={styles.modalLabel}>Commute visibility</Text>
            <Text style={styles.modalValue}>
              {peerModal?.badgeText === null ? "Loading…" : peerModal?.badgeText}
            </Text>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setPeerModal(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
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
  },
  visibilityRow: {
    flexDirection: "row",
    gap: Spacing.sm,
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
  visibilityText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  visibilityTextActive: {
    color: Colors.textOnPrimary,
  },
  searchWrap: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.base,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.xs,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textOnPrimary,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
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
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  filterTextActive: {
    color: Colors.primaryDark,
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingBottom: Spacing.xl,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.borderLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  sectionCard: {
    width: "100%",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
  },
  sectionCardTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 2,
  },
  sectionCardBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  trustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  trustText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    lineHeight: 18,
  },
  listSection: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  listTitle: {
    fontSize: FontSize.base,
    color: Colors.text,
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.sm,
  },
  matchCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
  },
  matchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  matchName: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: FontWeight.semibold,
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
  },
  tapHint: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    marginTop: Spacing.sm,
    fontWeight: FontWeight.medium,
  },
  privacyNote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  costLine: {
    fontSize: FontSize.sm,
    color: Colors.text,
    marginTop: Spacing.sm,
    fontWeight: FontWeight.medium,
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
  },
  postBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.primary,
    gap: Spacing.sm,
  },
  postBtnText: {
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
  modalLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modalValue: {
    fontSize: FontSize.base,
    color: Colors.text,
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
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
