import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
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
  ackCrewTripPickupReady,
  crewTripPickupAckDriverishId,
  deleteCrewAsOwner,
  fetchCrewMemberHomePins,
  fetchCrewRoster,
  fetchCrewTripInstance,
  fetchPendingCrewInvitees,
  getOrCreateTripInstance,
  isCrewOwner,
  parseRiderPickupReadyMap,
  rollCrewDriverDice,
  tryDepartureReadinessReminder,
  viewerShouldAckPickupReady,
  type CrewListRow,
  type CrewMemberMapPin,
  type CrewRosterMember,
  type CrewTripInstanceRow,
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
import { computeCrewDriverDiceEligibility } from "@/lib/crewDriverDicePool";
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
  const [todayTrip, setTodayTrip] = useState<CrewTripInstanceRow | null>(null);
  const [rollingDice, setRollingDice] = useState(false);
  const [pickupAckBusy, setPickupAckBusy] = useState(false);
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

    const inst = await getOrCreateTripInstance(crew.id, localDateKey());
    setTodayTrip(inst.ok ? inst.row : null);

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

  useFocusEffect(
    useCallback(() => {
      void loadMapAndRoster();
    }, [loadMapAndRoster])
  );

  useEffect(() => {
    const id = todayTrip?.id;
    if (!id || todayTrip?.trip_finished_at) return;
    const channel = supabase
      .channel(`crew-trip-inst:${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "crew_trip_instances",
          filter: `id=eq.${id}`,
        },
        () => {
          void fetchCrewTripInstance(id).then((row) => {
            if (row) setTodayTrip(row);
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [todayTrip?.id, todayTrip?.trip_finished_at]);

  useFocusEffect(
    useCallback(() => {
      if (!todayTrip?.id) return;
      if (todayTrip.trip_started_at || todayTrip.trip_finished_at) return;
      if (todayTrip.departure_readiness_reminder_sent_at) return;
      if (todayTrip.trip_date !== localDateKey()) return;
      const now = new Date();
      const d = localDateKey(now);
      const mins = now.getHours() * 60 + now.getMinutes();
      void (async () => {
        await tryDepartureReadinessReminder({
          tripInstanceId: todayTrip.id,
          localMinutesFromMidnight: mins,
          tripLocalDate: d,
        });
        const row = await fetchCrewTripInstance(todayTrip.id);
        if (row) setTodayTrip(row);
      })();
    }, [
      todayTrip?.id,
      todayTrip?.trip_date,
      todayTrip?.trip_started_at,
      todayTrip?.trip_finished_at,
      todayTrip?.departure_readiness_reminder_sent_at,
    ])
  );

  async function onAckPickupReady() {
    if (!todayTrip?.id || pickupAckBusy) return;
    setPickupAckBusy(true);
    try {
      const r = await ackCrewTripPickupReady(todayTrip.id);
      if (!r.ok) {
        showAlert("Could not confirm", r.reason);
        return;
      }
      const row = await fetchCrewTripInstance(todayTrip.id);
      if (row) setTodayTrip(row);
      void loadMapAndRoster().then(() => onRefresh?.());
    } finally {
      setPickupAckBusy(false);
    }
  }

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
    // Opens CrewTripStartSummaryModal. When tripInProgress is true (trip_started_at already set),
    // the modal title and primary button read "Resume trip" / "Resume in Google Maps" so the driver
    // knows they are reopening Maps after a navigation app loss, not starting a second trip.
    setTripStartOpen(true);
  }

  /**
   * Handles the "Finish Poolyn" card button.
   *
   * The button becomes active (filled amber) as soon as the trip starts. Pressing it navigates
   * to the crew chat where the actual "Finish trip and settle Poolyn Credits" action lives.
   *
   * If the trip is active and some riders have not yet acknowledged pickup readiness, a warning
   * dialog is shown first. The driver can wait for them or proceed to chat anyway. The final
   * credit-settlement guard lives in the chat screen's onFinishTrip() function.
   *
   * PRODUCTION TODO: Before allowing navigation to the settle screen, add a minimum elapsed-time
   * check (e.g. trip_started_at must be >= 10 minutes ago). This prevents repeated start-finish
   * cycles that transfer credits without a real trip occurring. The gate should live server-side
   * in poolyn_crew_trip_finish_and_settle_credits so it cannot be bypassed by the client.
   */
  function onPressFinishPoolyn() {
    if (!todayTrip) return;
    const dest = {
      pathname: "/(tabs)/profile/crew-chat/[tripInstanceId]" as const,
      params: { tripInstanceId: todayTrip.id },
    };

    // Only warn during an active trip (not before it starts, not after it is finished).
    if (finishTripActive && expectedPickupRiders.length > 0) {
      const unready = expectedPickupRiders.filter((m) => !riderReadyMap[m.userId]);
      if (unready.length > 0) {
        const shown = unready.slice(0, 3);
        const nameList = shown.map((m) => (m.fullName || "A rider").trim()).join(", ");
        const overflow = unready.length > 3 ? ` and ${unready.length - 3} more` : "";
        showAlert(
          "Riders not yet ready",
          `${nameList}${overflow} ${unready.length === 1 ? "has" : "have"} not confirmed pickup readiness yet. You can wait for them to tap ready, or go to chat now to finish and settle.`,
          [
            { text: "Wait", style: "cancel" },
            { text: "Go to chat", style: "default", onPress: () => router.push(dest) },
          ]
        );
        return;
      }
    }

    router.push(dest);
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
  const driverDice = useMemo(
    () =>
      computeCrewDriverDiceEligibility({
        memberPins: crewPinsForNav,
        commutePattern: crew.commute_pattern ?? "to_work",
        viewerHome: profilePins.home_location,
        viewerWork: profilePins.work_location,
      }),
    [crewPinsForNav, crew.commute_pattern, profilePins.home_location, profilePins.work_location]
  );

  const designatedDriverId = todayTrip?.designated_driver_user_id ?? null;
  const isTodaysDriver = !!(designatedDriverId && userId === designatedDriverId);
  const pickupDriverishId = todayTrip ? crewTripPickupAckDriverishId(todayTrip) : null;
  const riderReadyMap = useMemo(
    () => parseRiderPickupReadyMap(todayTrip?.rider_pickup_ready_at),
    [todayTrip?.rider_pickup_ready_at]
  );
  const expectedPickupRiders = useMemo(() => {
    if (!pickupDriverishId) return [];
    const ex = new Set(todayTrip?.excluded_pickup_user_ids ?? []);
    return roster.filter((m) => !ex.has(m.userId) && m.userId !== pickupDriverishId);
  }, [roster, todayTrip?.excluded_pickup_user_ids, pickupDriverishId]);
  const showDriverPickupReady =
    !!todayTrip?.trip_started_at &&
    !todayTrip?.trip_finished_at &&
    expectedPickupRiders.length > 0 &&
    !!pickupDriverishId &&
    userId === pickupDriverishId;
  const showRiderPickupAck = !!(
    todayTrip &&
    viewerShouldAckPickupReady(todayTrip, userId)
  );
  // The person who pressed "Start Poolyn" (recorded as trip_started_by_user_id) is the de-facto
  // driver for that run even when no designated_driver_user_id was set via dice/chat. They must
  // be able to see both the Resume and Finish buttons for the trip they are running.
  const isTripStarter = !!(todayTrip?.trip_started_by_user_id && todayTrip.trip_started_by_user_id === userId);

  /** Until a driver is picked, any member may start; after that, only the designated driver OR the
   *  person who already started the trip (so they can resume navigation if Maps was lost). */
  const canUseStartPoolyn = designatedDriverId == null || isTodaysDriver || isTripStarter;

  /** Finish button is visible to the designated driver, crew owner, or whoever started this run. */
  const canUseFinishPoolyn =
    !!todayTrip && !todayTrip.trip_finished_at && (isTodaysDriver || owner || isTripStarter);

  const finishTripActive = !!(todayTrip?.trip_started_at && !todayTrip?.trip_finished_at);

  const onRollDriverDice = useCallback(async () => {
    if (rollingDice || driverDice.eligibleUserIds.length < 2) return;
    setRollingDice(true);
    try {
      const inst = await getOrCreateTripInstance(crew.id, localDateKey());
      if (!inst.ok) {
        showAlert("Could not roll", inst.reason);
        return;
      }
      const res = await rollCrewDriverDice(inst.row.id, driverDice.eligibleUserIds);
      if (!res.ok) {
        showAlert("Driver dice", res.reason.replace(/_/g, " "));
        return;
      }
      const row = await fetchCrewTripInstance(inst.row.id);
      if (row) setTodayTrip(row);
      void loadMapAndRoster().then(() => onRefresh?.());
    } finally {
      setRollingDice(false);
    }
  }, [rollingDice, driverDice.eligibleUserIds, crew.id, loadMapAndRoster, onRefresh]);

  const driverDiceHint = useMemo(() => {
    if (driverDice.reason === "ok" && driverDice.eligibleUserIds.length >= 2) {
      return "Only the two homes farthest along your commute corridor (within ~15 km of the line), not mid-route.";
    }
    if (driverDice.reason === "no_geometry") {
      return "Save home and work on your profile to enable driver dice.";
    }
    if (driverDice.reason === "too_few_pins") {
      return "Need at least two members with saved home pins in this crew.";
    }
    if (driverDice.reason === "too_few_near_corridor") {
      return "Need two or more homes near the commute line.";
    }
    return "Homes sit between the ends along the route; pick a driver in chat instead.";
  }, [driverDice.eligibleUserIds.length, driverDice.reason]);

  const tripStatus = useMemo(() => {
    if (!todayTrip) {
      return {
        title: "Today’s trip",
        subtitle: loadingMap ? "Loading…" : "Refresh the card or open group chat.",
        icon: "time-outline" as const,
        variant: "muted" as const,
      };
    }
    if (todayTrip.trip_finished_at) {
      return {
        title: "Trip ended",
        subtitle: "Today’s run is done. This resets tomorrow.",
        icon: "checkmark-circle-outline" as const,
        variant: "done" as const,
      };
    }
    if (todayTrip.trip_started_at) {
      const mins =
        commuteStats?.duration_s != null
          ? Math.max(1, Math.round(commuteStats.duration_s / 60))
          : null;
      let startedAt = "";
      try {
        startedAt = new Date(todayTrip.trip_started_at).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
      } catch {
        /* ignore */
      }
      const etaPart =
        mins != null
          ? `~${mins} min (locked corridor estimate)`
          : "Corridor time unavailable";
      return {
        title: "Trip in progress",
        subtitle: `${etaPart}${startedAt ? ` · Started ${startedAt}` : ""}`,
        icon: "navigate-circle-outline" as const,
        variant: "active" as const,
      };
    }
    const driverName = designatedDriverId
      ? (roster.find((m) => m.userId === designatedDriverId)?.fullName ?? "").trim() ||
        "Today’s driver"
      : null;
    const subtitle = designatedDriverId
      ? `Waiting for ${driverName} to start Poolyn.`
      : "Pick today’s driver with the dice on this card (route ends only) or claim in group chat.";
    return {
      title: "Trip not started",
      subtitle,
      icon: "ellipse-outline" as const,
      variant: "idle" as const,
    };
  }, [todayTrip, loadingMap, commuteStats, designatedDriverId, roster]);

  const tripInProgress = tripStatus.variant === "active";

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

      <View
        style={[
          styles.tripStatusBox,
          tripStatus.variant === "active" && styles.tripStatusBoxActive,
          tripStatus.variant === "done" && styles.tripStatusBoxDone,
        ]}
        accessibilityLabel={`${tripStatus.title}. ${tripStatus.subtitle}`}
      >
        <Ionicons
          name={tripStatus.icon}
          size={22}
          color={
            tripStatus.variant === "active"
              ? Colors.primaryDark
              : tripStatus.variant === "done"
                ? Colors.textSecondary
                : Colors.textSecondary
          }
        />
        <View style={styles.tripStatusTextCol}>
          <Text style={styles.tripStatusTitle}>{tripStatus.title}</Text>
          <Text style={styles.tripStatusSubtitle}>{tripStatus.subtitle}</Text>
        </View>
      </View>

      {showRiderPickupAck ? (
        <View style={styles.riderAckBanner}>
          <Ionicons name="car-outline" size={22} color={Colors.primaryDark} />
          <View style={styles.riderAckTextCol}>
            <Text style={styles.riderAckTitle}>Driver started the trip</Text>
            <Text style={styles.riderAckSub}>
              Tap when you are ready for pickup. If you are not riding, say so in chat so the driver can skip your
              stop.
            </Text>
            <Pressable
              style={[styles.riderAckBtn, pickupAckBusy && styles.btnDisabled]}
              onPress={() => void onAckPickupReady()}
              disabled={pickupAckBusy}
            >
              {pickupAckBusy ? (
                <ActivityIndicator color={Colors.textOnPrimary} size="small" />
              ) : (
                <Text style={styles.riderAckBtnText}>I am ready for pickup</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {showDriverPickupReady ? (
        <View style={styles.driverReadyBox}>
          <Text style={styles.driverReadyTitle}>Pickup readiness</Text>
          {expectedPickupRiders.map((m) => {
            const ok = !!riderReadyMap[m.userId];
            return (
              <View key={m.userId} style={styles.driverReadyRow}>
                <Ionicons
                  name={ok ? "checkmark-circle" : "time-outline"}
                  size={20}
                  color={ok ? Colors.primary : Colors.textTertiary}
                />
                <Text style={styles.driverReadyName} numberOfLines={1}>
                  {(m.fullName || "Member").trim()}
                </Text>
                <Text style={ok ? styles.driverReadyOk : styles.driverReadyWait}>
                  {ok ? "Ready" : "Waiting"}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {!designatedDriverId && !todayTrip?.trip_finished_at ? (
        <View style={styles.driverDiceBlock}>
          <Pressable
            style={[
              styles.driverDiceBtn,
              (driverDice.eligibleUserIds.length < 2 || rollingDice) && styles.driverDiceBtnOff,
            ]}
            disabled={driverDice.eligibleUserIds.length < 2 || rollingDice}
            onPress={() => void onRollDriverDice()}
            accessibilityRole="button"
            accessibilityLabel="Pick driver at random from corridor ends"
          >
            {rollingDice ? (
              <ActivityIndicator color={Colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="dice-outline" size={20} color={Colors.textOnPrimary} />
                <Text style={styles.driverDiceBtnText}>Pick driver (dice)</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.driverDiceHint}>{driverDiceHint}</Text>
        </View>
      ) : null}

      {canUseStartPoolyn ? (
        <Pressable
          style={styles.startPoolynBtn}
          onPress={() => onPressTripStart()}
          accessibilityRole="button"
          accessibilityLabel={tripInProgress ? "Resume trip in Google Maps" : "Start Poolyn"}
        >
          <Ionicons name={tripInProgress ? "navigate-circle" : "car-sport"} size={22} color="#fff" />
          <Text style={styles.startPoolynBtnText}>{tripInProgress ? "Resume trip" : "Start Poolyn"}</Text>
        </Pressable>
      ) : null}

      {canUseFinishPoolyn && todayTrip && finishTripActive ? (
        <>
          <Pressable
            style={[
              styles.finishPoolynBtnBase,
              finishTripActive ? styles.finishPoolynBtnFilled : styles.finishPoolynBtnOutline,
            ]}
            onPress={() => onPressFinishPoolyn()}
          >
            <Ionicons
              name="flag-outline"
              size={22}
              color={finishTripActive ? "#fff" : "#B45309"}
            />
            <Text
              style={finishTripActive ? styles.finishPoolynBtnTextFilled : styles.finishPoolynBtnTextOutline}
            >
              Finish Poolyn
            </Text>
          </Pressable>
          {finishTripActive ? (
            <Text style={styles.finishHint}>
              Maps does not report back to Poolyn. In chat, use{" "}
              <Text style={styles.finishHintBold}>Finish trip and settle Poolyn Credits</Text>.
            </Text>
          ) : (
            <Text style={styles.finishHintMuted}>
              Outline until today&apos;s run has started; then this highlights so you can close the day and move
              credits.
            </Text>
          )}
        </>
      ) : null}

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
              crewmates&apos; home areas. In Start Poolyn, turn off anyone not riding today so they are not charged
              at settlement. Automated pickup checks against saved addresses are planned later.
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
        resumeTrip={tripInProgress}
        onTripOpened={(tripInstanceId) =>
          void (async () => {
            const row = await fetchCrewTripInstance(tripInstanceId);
            if (row) setTodayTrip(row);
            await loadMapAndRoster();
            onRefresh?.();
          })()
        }
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
  finishPoolynBtnBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.sm,
    borderWidth: 2,
  },
  finishPoolynBtnOutline: {
    backgroundColor: Colors.surface,
    borderColor: "#B45309",
  },
  finishPoolynBtnFilled: {
    backgroundColor: "#B45309",
    borderColor: "#B45309",
    ...Shadow.sm,
  },
  finishPoolynBtnTextOutline: {
    color: "#B45309",
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
  finishPoolynBtnTextFilled: {
    color: "#fff",
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
  },
  tripStatusBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tripStatusBoxActive: {
    borderColor: "rgba(11, 132, 87, 0.35)",
    backgroundColor: "rgba(11, 132, 87, 0.06)",
  },
  tripStatusBoxDone: {
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tripStatusTextCol: { flex: 1, minWidth: 0 },
  tripStatusTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: 4,
  },
  tripStatusSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  riderAckBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.35)",
  },
  riderAckTextCol: { flex: 1, minWidth: 0 },
  riderAckTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: 4,
  },
  riderAckSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  riderAckBtn: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  riderAckBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
  },
  driverReadyBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  driverReadyTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  driverReadyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 6,
  },
  driverReadyName: { flex: 1, minWidth: 0, fontSize: FontSize.sm, color: Colors.text },
  driverReadyOk: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.primary },
  driverReadyWait: { fontSize: FontSize.xs, color: Colors.textTertiary },
  driverDiceBlock: {
    marginTop: Spacing.sm,
    alignSelf: "stretch",
  },
  driverDiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    backgroundColor: "#7C3AED",
  },
  driverDiceBtnOff: {
    opacity: 0.45,
  },
  driverDiceBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
  },
  driverDiceHint: {
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: Spacing.xs,
    lineHeight: 15,
    paddingHorizontal: Spacing.xs,
  },
  finishHint: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 16,
    paddingHorizontal: Spacing.sm,
  },
  finishHintBold: { fontWeight: FontWeight.semibold, color: Colors.text },
  finishHintMuted: {
    fontSize: 10,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: Spacing.xs,
    lineHeight: 15,
    paddingHorizontal: Spacing.sm,
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
