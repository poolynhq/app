import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  deleteCrewAsOwner,
  fetchCrewMemberHomePins,
  fetchCrewRoster,
  fetchPendingCrewInvitees,
  getOrCreateTripInstance,
  isCrewOwner,
  type CrewListRow,
  type CrewMemberMapPin,
  type CrewRosterMember,
  type PendingCrewInvitee,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { parseStoredLineStringGeometry } from "@/lib/discoverMapViewerRoutes";
import {
  buildCrewMemberPinsMapUrl,
  buildCrewRoutineOverviewMapUrl,
  buildViewerCommuteStaticMapUrl,
  fetchRouteInfo,
  mapboxTokenPresent,
} from "@/lib/mapboxCommutePreview";
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { showAlert } from "@/lib/platformAlert";
import { presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import {
  distanceMeters,
  orderPickupsAlongCommute,
  orderPickupsGreedy,
  resolveCommuteGeometry,
  type ResolvedCommuteLeg,
} from "@/lib/crewRouteOrdering";
import { CrewTripStartSummaryModal } from "@/components/home/CrewTripStartSummaryModal";
import { computeCrewEqualCorridorRiderBreakdown } from "@/lib/costModel";
import { PassengerPaymentCostLines } from "@/components/home/PassengerPaymentCostLines";
import type { User } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type ProfilePins = Pick<User, "home_location" | "work_location">;

type Props = {
  userId: string;
  crew: CrewListRow;
  memberCount: number;
  /** Pending in-app invites (not yet in roster until they accept). */
  pendingInviteCount: number;
  /** From profile `org_id`; server confirms active workplace subscription when you pay. */
  hasWorkplaceNetworkOnProfile?: boolean;
  profilePins: ProfilePins;
  onRefresh?: () => void;
  onCrewDeleted?: () => void;
};

function mergeMemberAndPendingPins(
  memberPins: CrewMemberMapPin[],
  pending: PendingCrewInvitee[]
): CrewMemberMapPin[] {
  const byUser = new Map<string, CrewMemberMapPin>();
  for (const p of memberPins) byUser.set(p.userId, p);
  for (const inv of pending) {
    if (inv.lat == null || inv.lng == null) continue;
    if (byUser.has(inv.userId)) continue;
    byUser.set(inv.userId, {
      userId: inv.userId,
      fullName: inv.fullName,
      lat: inv.lat,
      lng: inv.lng,
    });
  }
  return [...byUser.values()];
}

export function MyCrewRoutineCard({
  userId,
  crew,
  memberCount,
  pendingInviteCount,
  hasWorkplaceNetworkOnProfile = false,
  profilePins,
  onRefresh,
  onCrewDeleted,
}: Props) {
  const router = useRouter();
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [roster, setRoster] = useState<CrewRosterMember[]>([]);
  const [pendingInvitees, setPendingInvitees] = useState<PendingCrewInvitee[]>([]);
  const [crewPinsForNav, setCrewPinsForNav] = useState<CrewMemberMapPin[]>([]);
  const [owner, setOwner] = useState(false);
  const [tripStartOpen, setTripStartOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [commuteStats, setCommuteStats] = useState<{
    distance_m: number;
    duration_s: number;
  } | null>(null);

  useEffect(() => {
    void isCrewOwner(crew.id, userId).then(setOwner);
  }, [crew.id, userId]);

  const loadMapAndRoster = useCallback(async () => {
    setLoadingMap(true);
    const [pinsMember, rosterRows, pending, crRes, geomRes] = await Promise.all([
      fetchCrewMemberHomePins(crew.id),
      fetchCrewRoster(crew.id),
      fetchPendingCrewInvitees(crew.id),
      supabase
        .from("commute_routes")
        .select("distance_m, duration_s")
        .eq("user_id", userId)
        .eq("direction", "to_work")
        .maybeSingle(),
      supabase.rpc("get_crew_routine_map_route_geojson", { p_crew_id: crew.id }),
    ]);
    setRoster(rosterRows);
    setPendingInvitees(pending);
    const pins = mergeMemberAndPendingPins(pinsMember, pending);
    setCrewPinsForNav(pins);

    const cr = crRes.data as { distance_m?: number; duration_s?: number } | null;
    if (
      crew.locked_route_distance_m != null &&
      crew.locked_route_duration_s != null
    ) {
      setCommuteStats({
        distance_m: crew.locked_route_distance_m,
        duration_s: crew.locked_route_duration_s,
      });
    } else if (cr && typeof cr.distance_m === "number" && typeof cr.duration_s === "number") {
      setCommuteStats({ distance_m: cr.distance_m, duration_s: cr.duration_s });
    } else {
      setCommuteStats(null);
    }

    if (!mapboxTokenPresent()) {
      setMapUrl(null);
      setLoadingMap(false);
      return;
    }

    const home = parseGeoPoint(profilePins.home_location as unknown);
    const work = parseGeoPoint(profilePins.work_location as unknown);

    let url: string | null = null;
    if (home && work) {
      const others = pins.filter(
        (p) => p.userId !== userId && distanceMeters({ lat: p.lat, lng: p.lng }, home) > 120
      );
      const otherPts = others.map((o) => ({ lat: o.lat, lng: o.lng }));
      const storedGeom = geomRes.error ? null : geomRes.data;
      const line = parseStoredLineStringGeometry(storedGeom);
      if (line && line.length >= 2) {
        url = buildViewerCommuteStaticMapUrl(home, work, line, otherPts);
      } else {
        const routeInfo = await fetchRouteInfo(home, work);
        url = buildCrewRoutineOverviewMapUrl(home, work, routeInfo, otherPts);
      }
    } else if (pins.length > 0) {
      url = buildCrewMemberPinsMapUrl(pins.map((p) => ({ lat: p.lat, lng: p.lng })));
    }
    setMapUrl(url);
    setLoadingMap(false);
  }, [
    crew.id,
    crew.locked_route_distance_m,
    crew.locked_route_duration_s,
    profilePins.home_location,
    profilePins.work_location,
    userId,
  ]);

  useEffect(() => {
    void loadMapAndRoster();
  }, [loadMapAndRoster]);

  function onPressTripStart() {
    const others = crewPinsForNav.filter((p) => p.userId !== userId);
    if (others.length === 0) {
      const workOnly = parseGeoPoint(profilePins.work_location as unknown);
      const homeOnly = parseGeoPoint(profilePins.home_location as unknown);
      if (!workOnly && !homeOnly) {
        showAlert(
          "No crew pickup pins",
          "Add crewmates with a saved home pin (Profile → Commute), or set your commute pins to navigate solo."
        );
        return;
      }
    }
    setTripStartOpen(true);
  }

  async function openTodaysChat() {
    setOpening(true);
    try {
      const inst = await getOrCreateTripInstance(crew.id, localDateKey());
      if (!inst.ok) {
        showAlert("Could not open chat", inst.reason);
        return;
      }
      router.push({
        pathname: "/(tabs)/profile/crew-chat/[tripInstanceId]",
        params: { tripInstanceId: inst.row.id },
      });
    } finally {
      setOpening(false);
    }
  }

  function promptDeleteCrew() {
    showAlert(
      "Delete this crew?",
      "Everyone loses access. Members, day chat threads, and pending invites are removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "default",
          onPress: () => {
            showAlert(
              "Delete crew permanently?",
              "You are about to delete this crew for all members. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete crew",
                  style: "destructive",
                  onPress: () => void runDeleteCrew(),
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function runDeleteCrew() {
    setDeleting(true);
    const r = await deleteCrewAsOwner(crew.id);
    setDeleting(false);
    if (!r.ok) {
      showAlert("Could not delete crew", r.reason);
      return;
    }
    onCrewDeleted?.();
  }

  const othersPins = useMemo(
    () => crewPinsForNav.filter((p) => p.userId !== userId),
    [crewPinsForNav, userId]
  );

  const orderedLegsPreview = useMemo(() => {
    if (othersPins.length === 0) return [];
    const home = parseGeoPoint(profilePins.home_location as unknown);
    const work = parseGeoPoint(profilePins.work_location as unknown);
    const pattern = crew.commute_pattern ?? "to_work";
    const activeLeg: ResolvedCommuteLeg = pattern === "to_home" ? "to_home" : "to_work";
    const g =
      home && work ? resolveCommuteGeometry({ pattern, activeLeg, home, work }) : null;
    let origin: { lat: number; lng: number };
    if (home) origin = home;
    else {
      let lat = 0;
      let lng = 0;
      for (const p of othersPins) {
        lat += p.lat;
        lng += p.lng;
      }
      const n = othersPins.length;
      origin = { lat: lat / n, lng: lng / n };
    }
    if (g) return orderPickupsAlongCommute(origin, othersPins, g.segmentStart, g.segmentEnd);
    return orderPickupsGreedy(origin, othersPins);
  }, [othersPins, profilePins.home_location, profilePins.work_location, crew.commute_pattern]);

  const finalNavPoint = useMemo(() => {
    const pattern = crew.commute_pattern ?? "to_work";
    if (pattern === "to_home") return parseGeoPoint(profilePins.home_location as unknown);
    return parseGeoPoint(profilePins.work_location as unknown);
  }, [crew.commute_pattern, profilePins.home_location, profilePins.work_location]);

  const finalNavLabel =
    (crew.commute_pattern ?? "to_work") === "to_home"
      ? "Home (after pickups)"
      : crew.commute_pattern === "round_trip"
        ? "Workplace (pick leg in Start Poolyn)"
        : "Workplace (after pickups)";

  const invitedShown = Math.max(pendingInviteCount, pendingInvitees.length);
  const legSummary =
    crew.commute_pattern === "to_home"
      ? "Work → Home"
      : crew.commute_pattern === "round_trip"
        ? "Round trip"
        : "Home → Work";
  const commuteSummary =
    commuteStats != null
      ? `${(commuteStats.distance_m / 1000).toFixed(1)} km · ~${Math.round(commuteStats.duration_s / 60)} min`
      : null;

  const riderCostPreview = useMemo(() => {
    if (!commuteStats?.distance_m) return null;
    const poolRiders = memberCount - 1;
    if (poolRiders < 1) return null;
    const bd = computeCrewEqualCorridorRiderBreakdown({
      lockedRouteDistanceM: commuteStats.distance_m,
      lockedRouteDurationS: commuteStats.duration_s,
      poolRiderCount: poolRiders,
    });
    if (!bd) return null;
    return { poolRiders, cents: bd.total_contribution };
  }, [commuteStats, memberCount]);

  function openMapExternal() {
    if (!mapUrl) return;
    void Linking.openURL(mapUrl);
  }

  return (
    <View style={styles.card}>
      {crew.sticker_image_url ? (
        <Image source={{ uri: crew.sticker_image_url }} style={styles.banner} resizeMode="cover" />
      ) : crew.sticker_emoji ? (
        <View style={styles.bannerEmoji}>
          <Text style={styles.bannerEmojiText}>{crew.sticker_emoji}</Text>
        </View>
      ) : null}

      <View style={styles.cardPad}>
      <View style={styles.compactHeader}>
        <View style={styles.titleBlock}>
          <Text style={styles.crewLabel}>Your crew</Text>
          <Text style={styles.crewName} numberOfLines={2}>
            {crew.name}
          </Text>
          <View style={styles.chipRow}>
            <View style={styles.infoChip}>
              <Text style={styles.infoChipText}>{memberCount} in crew</Text>
            </View>
            {invitedShown > 0 ? (
              <View style={styles.infoChipMuted}>
                <Text style={styles.infoChipTextMuted}>{invitedShown} invited</Text>
              </View>
            ) : null}
            <View style={styles.infoChipMuted}>
              <Text style={styles.infoChipTextMuted} numberOfLines={1}>
                {crew.invite_code}
              </Text>
            </View>
          </View>
          <View style={styles.patternRow}>
            <View style={styles.patternBadge}>
              <Ionicons
                name={
                  crew.commute_pattern === "round_trip" ? "git-compare-outline" : "arrow-forward"
                }
                size={14}
                color={Colors.primaryDark}
              />
              <Text style={styles.patternBadgeText}>{legSummary}</Text>
            </View>
          </View>
          {commuteSummary ? <Text style={styles.commuteSummary}>{commuteSummary}</Text> : null}
          {riderCostPreview ? (
            <View style={styles.riderCostBlock}>
              <PassengerPaymentCostLines
                contributionCents={riderCostPreview.cents}
                passengerHasWorkplaceOrgOnProfile={hasWorkplaceNetworkOnProfile}
                context="crew"
                textStyle="meta"
                primaryLine={`Est. rider share (${riderCostPreview.poolRiders} rider${
                  riderCostPreview.poolRiders === 1 ? "" : "s"
                }): ~$${(riderCostPreview.cents / 100).toFixed(2)} (incl. $1 stop fee)`}
              />
            </View>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push(`/(tabs)/profile/crew-settings/${crew.id}`)}
            hitSlop={8}
            accessibilityLabel="Crew settings"
          >
            <Ionicons name="settings-outline" size={22} color={Colors.primary} />
          </Pressable>
          <Pressable
            style={styles.manageBtn}
            onPress={() => router.push("/(tabs)/profile/crews")}
            hitSlop={8}
          >
            <Text style={styles.manageBtnText}>Manage</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
          </Pressable>
        </View>
      </View>

      <Pressable
        style={styles.mapWrap}
        onPress={() => openMapExternal()}
        disabled={!mapUrl || loadingMap}
        accessibilityRole="button"
        accessibilityLabel="Open route map"
      >
        {loadingMap ? (
          <ActivityIndicator color={Colors.primary} style={styles.mapLoader} />
        ) : mapUrl ? (
          <Image source={{ uri: mapUrl }} style={styles.mapImg} resizeMode="cover" />
        ) : (
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={32} color={Colors.textTertiary} />
            <Text style={styles.mapPhText}>
              {mapboxTokenPresent()
                ? "Set home and work in Profile → Commute to see your route here, or wait for members to save home pins."
                : "Add a Mapbox token to preview the map."}
            </Text>
          </View>
        )}
      </Pressable>
      {mapUrl && !loadingMap ? (
        <Text style={styles.mapHint}>Tap map to open a zoomable preview in the browser.</Text>
      ) : null}

      <Pressable style={styles.startPoolynBtn} onPress={() => onPressTripStart()}>
        <Ionicons name="car-sport" size={22} color="#fff" />
        <Text style={styles.startPoolynBtnText}>Start Poolyn</Text>
      </Pressable>

      <Pressable
        style={styles.detailsToggle}
        onPress={() => setDetailsOpen((v) => !v)}
        hitSlop={8}
      >
        <Text style={styles.detailsToggleText}>{detailsOpen ? "Hide details" : "Details"}</Text>
        <Ionicons
          name={detailsOpen ? "chevron-up" : "chevron-down"}
          size={18}
          color={Colors.primary}
        />
      </Pressable>

      {detailsOpen ? (
        <View style={styles.detailsBody}>
          <View style={styles.detailBubble}>
            <Text style={styles.detailBubbleText}>
              Pins: your home and work with your saved commute line (when Mapbox can route). Smaller pins are
              crewmates&apos; home areas. Use Start Poolyn for today&apos;s Google route and optional rider drops.
            </Text>
          </View>

          <Pressable
            style={[styles.chatBtn, opening && styles.btnDisabled]}
            onPress={() => void openTodaysChat()}
            disabled={opening}
          >
            {opening ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="chatbubbles" size={20} color="#fff" />
                <Text style={styles.chatBtnText}>Group chat &amp; driver</Text>
              </>
            )}
          </Pressable>

          {roster.length > 0 || pendingInvitees.length > 0 ? (
            <View style={styles.membersBlock}>
              {roster.length > 0 ? (
                <>
                  <Text style={styles.membersLabel}>In this crew</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.memberChips}
                  >
                    {roster.map((m) => (
                      <View key={m.userId} style={styles.memberChip}>
                        <Ionicons name="person" size={14} color={Colors.primaryDark} />
                        <Text style={styles.memberChipText} numberOfLines={1}>
                          {(m.fullName || "Member").trim()}
                          {m.userId === userId ? " (you)" : ""}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              ) : null}
              {pendingInvitees.length > 0 ? (
                <>
                  <Text style={[styles.membersLabel, styles.invitedLabel]}>Invited (pending)</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.memberChips}
                  >
                    {pendingInvitees.map((p) => (
                      <View key={p.userId} style={[styles.memberChip, styles.memberChipPending]}>
                        <Ionicons name="mail-outline" size={14} color={Colors.textSecondary} />
                        <Text style={[styles.memberChipText, styles.memberChipTextMuted]} numberOfLines={1}>
                          {(p.fullName || "Invited").trim()}
                          {p.userId === userId ? " (you)" : ""}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              ) : null}
            </View>
          ) : null}

          {orderedLegsPreview.length > 0 ? (
            <View style={styles.legsBlock}>
              <Text style={styles.legsTitle}>Pickup order &amp; legs</Text>
              <Text style={styles.legsExplainer}>
                Poolyn does not track arrivals — confirm stops in Google Maps. If Maps does not advance, open the next
                row here.
              </Text>
              {orderedLegsPreview.map((p, i) => (
                <View key={p.userId} style={styles.legRow}>
                  <Text style={styles.legIdx}>{i + 1}</Text>
                  <Text style={styles.legName} numberOfLines={2}>
                    {(p.fullName || "Crewmate").trim()}
                  </Text>
                  <Pressable
                    style={styles.legNavBtn}
                    onPress={() => presentDrivingNavigationPicker(p.lat, p.lng)}
                    hitSlop={6}
                  >
                    <Ionicons name="navigate" size={16} color={Colors.primary} />
                    <Text style={styles.legNavBtnText}>Maps</Text>
                  </Pressable>
                </View>
              ))}
              {finalNavPoint ? (
                <View style={[styles.legRow, styles.legRowFinal]}>
                  <Text style={styles.legIdx}>★</Text>
                  <Text style={styles.legName} numberOfLines={2}>
                    {finalNavLabel}
                  </Text>
                  <Pressable
                    style={styles.legNavBtn}
                    onPress={() =>
                      presentDrivingNavigationPicker(finalNavPoint.lat, finalNavPoint.lng)
                    }
                    hitSlop={6}
                  >
                    <Ionicons name="navigate" size={16} color={Colors.primary} />
                    <Text style={styles.legNavBtnText}>Maps</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          <Pressable
            style={styles.secondaryBtn}
            onPress={() => void loadMapAndRoster().then(() => onRefresh?.())}
          >
            <Ionicons name="refresh" size={18} color={Colors.primary} />
            <Text style={styles.secondaryBtnText}>Refresh map</Text>
          </Pressable>
          {owner ? (
            <Pressable
              style={[styles.deleteCrewBtn, deleting && styles.btnDisabled]}
              onPress={() => promptDeleteCrew()}
              disabled={deleting}
              hitSlop={8}
            >
              {deleting ? (
                <ActivityIndicator color={Colors.error} size="small" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color={Colors.error} />
                  <Text style={styles.deleteCrewBtnText}>Delete crew</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      </View>

      <CrewTripStartSummaryModal
        visible={tripStartOpen}
        onClose={() => setTripStartOpen(false)}
        crew={crew}
        userId={userId}
        profilePins={profilePins}
        crewPins={crewPinsForNav}
        onTripOpened={() => void loadMapAndRoster().then(() => onRefresh?.())}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F0FDF4",
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.2)",
    ...Shadow.sm,
  },
  banner: {
    width: "100%",
    height: 88,
    backgroundColor: Colors.border,
  },
  bannerEmoji: {
    width: "100%",
    height: 56,
    backgroundColor: "rgba(11, 132, 87, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerEmojiText: { fontSize: 28 },
  cardPad: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.md,
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  titleBlock: { flex: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  infoChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(11, 132, 87, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.22)",
  },
  infoChipText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.primaryDark },
  infoChipMuted: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 140,
  },
  infoChipTextMuted: { fontSize: 10, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  commuteSummary: {
    marginTop: 6,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  riderCostHint: {
    marginTop: 4,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  riderCostBlock: { marginTop: 4, alignSelf: "stretch" },
  patternRow: { marginTop: 6 },
  patternBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(11, 132, 87, 0.12)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
  },
  patternBadgeText: { fontSize: 11, fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  headerActions: { alignItems: "flex-end", gap: Spacing.xs },
  iconBtn: { padding: 4 },
  crewLabel: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  crewName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    flex: 1,
    minWidth: 0,
  },
  manageBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  manageBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  membersBlock: { marginBottom: Spacing.sm },
  membersLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  memberChips: { flexDirection: "row", gap: Spacing.sm, paddingVertical: 2 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 200,
  },
  memberChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.text, flexShrink: 1 },
  invitedLabel: { marginTop: Spacing.sm },
  memberChipPending: {
    backgroundColor: Colors.background,
    borderStyle: "dashed",
  },
  memberChipTextMuted: { color: Colors.textSecondary },
  mapWrap: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    backgroundColor: Colors.borderLight,
    minHeight: 140,
  },
  mapImg: { width: "100%", height: 140 },
  mapLoader: { paddingVertical: 48 },
  mapPlaceholder: {
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  mapPhText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: "center",
  },
  mapHint: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    marginBottom: Spacing.sm,
  },
  startPoolynBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    ...Shadow.sm,
  },
  startPoolynBtnText: {
    color: "#fff",
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  detailsToggleText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  detailsBody: { marginTop: Spacing.sm, gap: Spacing.sm },
  detailBubble: {
    backgroundColor: "rgba(255,255,255,0.75)",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.2)",
    padding: Spacing.sm,
  },
  detailBubbleText: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  chatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryDark,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
  },
  chatBtnText: {
    color: "#fff",
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  btnDisabled: { opacity: 0.75 },
  legsBlock: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.25)",
    backgroundColor: "rgba(255,255,255,0.7)",
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  legsTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  legsExplainer: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginBottom: Spacing.xs,
  },
  legRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  legRowFinal: { borderBottomWidth: 0, paddingTop: Spacing.xs },
  legIdx: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
    width: 22,
    textAlign: "center",
  },
  legName: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  legNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  legNavBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  deleteCrewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: Spacing.xs,
  },
  deleteCrewBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.error,
  },
});
