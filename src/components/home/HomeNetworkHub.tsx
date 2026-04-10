import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Modal,
  Pressable,
  Switch,
  type LayoutChangeEvent,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
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
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { PassengerPaymentCostLines } from "@/components/home/PassengerPaymentCostLines";

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

type Props = {
  scrollToParam?: string | null;
  /** Called when user taps “jump to seats” or deep link; parent scrolls using combined layout math. */
  onRequestScrollToSeats: () => void;
  /** Seats section Y relative to the hub root (for parent: scrollY = hubBlockY + this). */
  onSeatsSectionInnerLayout: (y: number) => void;
};

/**
 * Former Discover “below the map” content: overlap snapshot, filters, driver rider matches,
 * passenger seat opportunities. Map + visibility live on Home already.
 */
export function HomeNetworkHub({
  scrollToParam,
  onRequestScrollToSeats,
  onSeatsSectionInnerLayout,
}: Props) {
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
  const [minReliability, setMinReliability] = useState(0);

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

  async function setDriverOuterNetworkRiders(enabled: boolean) {
    if (!profile?.id) return;
    const { error } = await supabase
      .from("users")
      .update({ driver_show_outer_network_riders: enabled })
      .eq("id", profile.id);
    if (!error) await refreshProfile();
  }

  const scrollToParamStable = useRef(scrollToParam);
  scrollToParamStable.current = scrollToParam;

  useFocusEffect(
    useCallback(() => {
      const p = scrollToParamStable.current;
      if (p !== "opportunities") return;
      const t = setTimeout(() => onRequestScrollToSeats(), 500);
      return () => clearTimeout(t);
    }, [onRequestScrollToSeats])
  );

  const onSeatsLayout = useCallback(
    (e: LayoutChangeEvent) => {
      onSeatsSectionInnerLayout(e.nativeEvent.layout.y);
    },
    [onSeatsSectionInnerLayout]
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.hubEyebrow}>NETWORK &amp; SEATS</Text>
      <View style={styles.whyCard}>
        <Text style={styles.whyTitle}>How this fits together</Text>
        <Text style={styles.whyBody}>
          <Text style={styles.whyBold}>Offer a ride</Text> — Post your trip in{" "}
          <Text style={styles.whyBold}>My Rides</Text> with time and seats. You show up on the map and in{" "}
          <Text style={styles.whyBold}>Seats you can book</Text> for riders.
        </Text>
        <Text style={styles.whyBody}>
          <Text style={styles.whyBold}>Find a ride</Text> — Book a seat on a trip someone already posted (below).
        </Text>
        <Text style={styles.whyBody}>
          <Text style={styles.whyBold}>Post a pickup request</Text> — When nobody has posted a good match, this
          pings nearby drivers (same org / corridor) to offer you a lift, even without a pre-listed trip.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Route overlap snapshot</Text>
        <Text style={styles.sectionHint}>
          Geometry overlap across your network (not the same as heat blobs on the map).
        </Text>
        <View style={styles.snapshotCard}>
          <Text style={styles.snapshotBig}>{matchCount}</Text>
          <Text style={styles.snapshotLabel}>peers with geometry overlap (org / network)</Text>
          {matchCount === 0 && orgCount > 0 ? (
            <Text style={styles.snapshotHint}>
              {orgCount} colleague{orgCount === 1 ? "" : "s"} saved a commute route. Finish Profile → Commute so
              your route can overlap with theirs.
            </Text>
          ) : null}
          <View style={styles.snapshotRow}>
            <View style={styles.snapshotStat}>
              <Text style={styles.snapshotStatVal}>{matchCount}</Text>
              <Text style={styles.snapshotStatLab}>Overlap</Text>
            </View>
            <View style={styles.snapshotStat}>
              <Text style={styles.snapshotStatVal}>{orgCount}</Text>
              <Text style={styles.snapshotStatLab}>Org · saved routes</Text>
            </View>
            <View style={styles.snapshotStat}>
              <Text style={styles.snapshotStatVal}>{nearbyCount}</Text>
              <Text style={styles.snapshotStatLab}>Wider pool</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Filter lists below</Text>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Vehicle type or overlap %…"
            placeholderTextColor={Colors.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Text style={styles.filterHint}>Minimum driver / rider reliability</Text>
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
        <TouchableOpacity style={styles.jumpBtn} onPress={onRequestScrollToSeats} activeOpacity={0.85}>
          <Ionicons name="arrow-down-circle-outline" size={20} color={Colors.primary} />
          <Text style={styles.jumpBtnText}>Jump to seats you can book</Text>
        </TouchableOpacity>
      </View>

      {profile?.visibility_mode === "nearby" && (
        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={Colors.primary} />
          <Text style={styles.trustText}>
            Any commuter includes people along your corridor, not only your org. Trust scores on cards still
            apply.
          </Text>
        </View>
      )}

      {profile && canViewerActAsDriver(profile) && profile.org_id ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Driving · riders on your route</Text>
          <Text style={styles.privacyNote}>
            Colleagues (and optional outer-network riders) who match your corridor — not the same list as seats
            below.
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
                  Adds ~{c.detourMinutes} min detour · est. for the rider (their trip share)
                </Text>
                <PassengerPaymentCostLines
                  contributionCents={c.passengerCostCents}
                  passengerHasWorkplaceOrgOnProfile={c.passengerHasWorkplaceOrgOnProfile}
                  context="mingle"
                  textStyle="meta"
                  poolHint={
                    c.assumedPoolRiders > 1
                      ? `If ${c.assumedPoolRiders} riders share the car, detour and time are split that way.`
                      : null
                  }
                />
                <Text style={styles.driverRiderFootnote}>
                  Riders book from the list below. Confirmed pickups appear under My Rides.
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      <View style={styles.section} onLayout={onSeatsLayout}>
        <Text style={styles.sectionTitle}>Seats you can book</Text>
        <Text style={styles.privacyNote}>
          Posted trips with free seats (geometry-matched). Driver details stay private until you reserve.
        </Text>
        {ridesLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
        ) : filteredPassenger.length === 0 ? (
          <Text style={styles.emptyMeta}>
            No seats match your filters. Try lowering reliability, clear search, or post a pickup request if
            nobody has listed a trip yet.
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
                Pickup {c.pickupEtaLabel} · +{c.detourMinutes} min detour · reliability {c.trustReliability}
              </Text>
              <PassengerPaymentCostLines
                contributionCents={c.passengerCostCents}
                passengerHasWorkplaceOrgOnProfile={c.passengerHasWorkplaceOrgOnProfile}
                context="mingle"
                containerStyle={{ marginTop: Spacing.sm }}
                primaryLine={`Est. trip share $${(c.passengerCostCents / 100).toFixed(2)} (incl. $1 stop fee)`}
                poolHint={
                  c.assumedPoolRiders > 1
                    ? `Split further if ${c.assumedPoolRiders} riders are in the car.`
                    : null
                }
              />
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
              Riders shown here are not verified members of your workplace network. Trips are between you and
              them. Poolyn does not guarantee safety, identity, or insurance. Use your own judgment. You can turn
              this off anytime.
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  hubEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  whyCard: {
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  whyTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  whyBody: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  whyBold: { fontWeight: FontWeight.semibold, color: Colors.text },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    letterSpacing: -0.2,
  },
  sectionHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.sm,
    lineHeight: 17,
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
    fontSize: 32,
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
  snapshotHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  snapshotRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  snapshotStat: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 96,
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
  jumpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  jumpBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  trustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
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
