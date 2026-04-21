import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  ackCrewTripPickupReady,
  crewTripPickupAckDriverishId,
  deleteCrewAsOwner,
  fetchCrewMemberHomePins,
  fetchCrewOwnerHomeWork,
  fetchCrewRoster,
  fetchCrewTripInstance,
  fetchPendingCrewInvitees,
  getOrCreateTripInstance,
  isCrewOwner,
  parseRiderPickupReadyMap,
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
  buildCrewPoolRouteStaticMapUrl,
  buildCrewRoutineOverviewMapUrl,
  buildViewerCommuteStaticMapUrl,
  CREW_ROUTINE_STATIC_MAP_ASPECT,
  fetchDrivingRouteThroughWaypoints,
  fetchRouteInfo,
  mapboxTokenPresent,
} from "@/lib/mapboxCommutePreview";
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { showAlert } from "@/lib/platformAlert";
import { presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import { computeCrewDriverWheelPool } from "@/lib/crewDriverDicePool";
import {
  distanceMeters,
  orderPickupsAlongCommute,
  orderPickupsForDriverPoolRoute,
  orderPickupsGreedy,
  resolveCommuteGeometry,
  type ResolvedCommuteLeg,
} from "@/lib/crewRouteOrdering";
import { modMinutes, formatMinutesAsTime } from "@/lib/crewSchedulePlan";
import { computeCrewSchedulePlanForDriver } from "@/lib/crewScheduleForDriver";
import { CrewTripStartSummaryModal } from "@/components/home/CrewTripStartSummaryModal";
import { CrewTripScheduleModal } from "@/components/home/CrewTripScheduleModal";
import {
  computeCrewEqualCorridorRiderBreakdown,
  computeCrewPerRiderDetourAttributedContributions,
} from "@/lib/costModel";
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

const POOLYN_YELLOW = "#FACC15";
const POOLYN_YELLOW_TEXT = "#1A1A2E";

/** Planned driver departure from saved crew schedule (used for banners and reminders). */
function driverDepartMinutesFromCrew(c: CrewListRow): number {
  const mode = c.schedule_mode ?? "arrival";
  const anchor = c.schedule_anchor_minutes ?? 540;
  const est = c.estimated_pool_drive_minutes ?? 45;
  if (mode === "arrival") return modMinutes(anchor - est);
  return modMinutes(anchor);
}

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

/** Stable key for when the static map route must be recomputed (driver or excluded pickups). */
function tripInstanceMapSig(row: CrewTripInstanceRow | null): string {
  if (!row) return "";
  const ex = [...(row.excluded_pickup_user_ids ?? [])].sort().join(",");
  return `${row.designated_driver_user_id ?? ""}|${ex}`;
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
  /** Home pins for accepted crew_members only (excludes pending invites). Used for driver wheel. */
  const [acceptedMemberPins, setAcceptedMemberPins] = useState<CrewMemberMapPin[]>([]);
  /** Owner commute pins so corridor dice/wheel hints match server (not viewer-specific). */
  const [crewOwnerAnchor, setCrewOwnerAnchor] = useState<{
    home: unknown;
    work: unknown;
  } | null>(null);
  const [owner, setOwner] = useState(false);
  const [tripStartOpen, setTripStartOpen] = useState(false);
  const [todayTrip, setTodayTrip] = useState<CrewTripInstanceRow | null>(null);
  /** Avoids reloading the map when Realtime updates unrelated trip fields (e.g. pickup acks). */
  const mapTripSigRef = useRef<string>("");
  const [tripScheduleOpen, setTripScheduleOpen] = useState(false);
  /** Set when the wheel finishes so the schedule modal opens with the new driver before React re-renders trip state. */
  const [scheduleDriverIdOverride, setScheduleDriverIdOverride] = useState<string | null>(null);
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
    const [pinsMember, rosterRows, pending, crRes, geomRes, ownerHw] = await Promise.all([
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
      fetchCrewOwnerHomeWork(crew.id),
    ]);
    setRoster(rosterRows);
    setPendingInvitees(pending);
    setAcceptedMemberPins(pinsMember);
    setCrewOwnerAnchor(
      ownerHw ? { home: ownerHw.home_location, work: ownerHw.work_location } : null
    );
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
    const tripRow = inst.ok ? inst.row : null;
    setTodayTrip(tripRow);
    mapTripSigRef.current = tripInstanceMapSig(tripRow);

    if (!mapboxTokenPresent()) {
      setMapUrl(null);
      setLoadingMap(false);
      return;
    }

    const home = parseGeoPoint((ownerHw?.home_location ?? profilePins.home_location) as unknown);
    const work = parseGeoPoint((ownerHw?.work_location ?? profilePins.work_location) as unknown);

    let url: string | null = null;
    const designatedId = tripRow?.designated_driver_user_id ?? null;
    const excludedTrip = new Set(tripRow?.excluded_pickup_user_ids ?? []);

    if (home && work && designatedId) {
      const driverPin = pins.find((p) => p.userId === designatedId);
      if (driverPin) {
        const pattern = crew.commute_pattern ?? "to_work";
        const activeLeg: ResolvedCommuteLeg = pattern === "to_home" ? "to_home" : "to_work";
        const g = resolveCommuteGeometry({ pattern, activeLeg, home, work });
        if (g?.finalDestination) {
          const passengerPins = pins.filter(
            (p) => p.userId !== designatedId && !excludedTrip.has(p.userId)
          );
          const ordered = orderPickupsForDriverPoolRoute(
            driverPin,
            passengerPins,
            g.segmentStart,
            g.segmentEnd
          );
          let waypoints: { lat: number; lng: number }[] = [
            { lat: driverPin.lat, lng: driverPin.lng },
            ...ordered.map((p) => ({ lat: p.lat, lng: p.lng })),
            g.finalDestination,
          ];
          const MAX_WAYPOINTS = 25;
          if (waypoints.length > MAX_WAYPOINTS) {
            const first = waypoints[0]!;
            const last = waypoints[waypoints.length - 1]!;
            const mid = waypoints.slice(1, -1);
            waypoints = [first, ...mid.slice(0, MAX_WAYPOINTS - 2), last];
          }
          const routeCoords = await fetchDrivingRouteThroughWaypoints(waypoints);
          if (routeCoords && routeCoords.length >= 2) {
            const othersForPins = ordered.map((p) => ({ lat: p.lat, lng: p.lng }));
            url = buildCrewPoolRouteStaticMapUrl(routeCoords, {
              driver: { lat: driverPin.lat, lng: driverPin.lng },
              destination: g.finalDestination,
              others: othersForPins,
            });
          }
        }
      }
    }

    if (!url && home && work) {
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
    } else if (!url && pins.length > 0) {
      url = buildCrewMemberPinsMapUrl(pins.map((p) => ({ lat: p.lat, lng: p.lng })));
    }
    setMapUrl(url);
    setLoadingMap(false);
  }, [
    crew.id,
    crew.commute_pattern,
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
            if (!row) return;
            setTodayTrip(row);
            const nextSig = tripInstanceMapSig(row);
            if (nextSig !== mapTripSigRef.current) {
              void loadMapAndRoster();
            }
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [todayTrip?.id, todayTrip?.trip_finished_at, loadMapAndRoster]);

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
   * to the crew chat where the actual "Finish trip and settle credits" action lives.
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
          `${nameList}${overflow} ${unready.length === 1 ? "has" : "have"} not confirmed pickup readiness yet. You can wait for them to tap ready, or go to chat now to finish the trip.`,
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
  const wheelPool = useMemo(
    () =>
      computeCrewDriverWheelPool({
        memberPins: acceptedMemberPins,
        commutePattern: crew.commute_pattern ?? "to_work",
        viewerHome: profilePins.home_location,
        viewerWork: profilePins.work_location,
        corridorAnchorHome: crewOwnerAnchor?.home,
        corridorAnchorWork: crewOwnerAnchor?.work,
      }),
    [
      acceptedMemberPins,
      crew.commute_pattern,
      profilePins.home_location,
      profilePins.work_location,
      crewOwnerAnchor?.home,
      crewOwnerAnchor?.work,
    ]
  );

  const designatedDriverId = todayTrip?.designated_driver_user_id ?? null;
  /** Show owner- or dice-assigned driver; if missing on legacy rows, fall back to who started the run. */
  const todaysDriverDisplayId = designatedDriverId ?? todayTrip?.trip_started_by_user_id ?? null;

  /** All accepted passengers who should appear in pickup order (includes viewer when they ride). */
  const passengerPinsForLegPreview = useMemo(() => {
    const ex = new Set(todayTrip?.excluded_pickup_user_ids ?? []);
    return acceptedMemberPins.filter((p) => {
      if (ex.has(p.userId)) return false;
      if (designatedDriverId != null && p.userId === designatedDriverId) return false;
      return true;
    });
  }, [acceptedMemberPins, designatedDriverId, todayTrip?.excluded_pickup_user_ids]);

  const orderedLegsPreview = useMemo(() => {
    if (passengerPinsForLegPreview.length === 0) return [];
    const home = parseGeoPoint((crewOwnerAnchor?.home ?? profilePins.home_location) as unknown);
    const work = parseGeoPoint((crewOwnerAnchor?.work ?? profilePins.work_location) as unknown);
    const pattern = crew.commute_pattern ?? "to_work";
    const activeLeg: ResolvedCommuteLeg = pattern === "to_home" ? "to_home" : "to_work";
    const g =
      home && work ? resolveCommuteGeometry({ pattern, activeLeg, home, work }) : null;
    const driverPin =
      designatedDriverId != null
        ? acceptedMemberPins.find((p) => p.userId === designatedDriverId)
        : null;
    if (g && driverPin) {
      return orderPickupsForDriverPoolRoute(
        driverPin,
        passengerPinsForLegPreview,
        g.segmentStart,
        g.segmentEnd
      );
    }
    let origin: { lat: number; lng: number };
    if (home) origin = home;
    else {
      let lat = 0;
      let lng = 0;
      for (const p of passengerPinsForLegPreview) {
        lat += p.lat;
        lng += p.lng;
      }
      const n = passengerPinsForLegPreview.length;
      origin = { lat: lat / n, lng: lng / n };
    }
    if (g) {
      return orderPickupsAlongCommute(
        origin,
        passengerPinsForLegPreview,
        g.segmentStart,
        g.segmentEnd
      );
    }
    return orderPickupsGreedy(origin, passengerPinsForLegPreview);
  }, [
    passengerPinsForLegPreview,
    profilePins.home_location,
    profilePins.work_location,
    crewOwnerAnchor?.home,
    crewOwnerAnchor?.work,
    crew.commute_pattern,
    designatedDriverId,
    acceptedMemberPins,
  ]);

  const todaysDriverFullName = useMemo(() => {
    if (!todaysDriverDisplayId) return null;
    const n = (roster.find((m) => m.userId === todaysDriverDisplayId)?.fullName ?? "").trim();
    return n || null;
  }, [todaysDriverDisplayId, roster]);
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

  /**
   * First start: only the designated driver (defaults to crew owner each day). Resume: designated
   * driver or whoever already started this run (Maps reopen / legacy rows).
   */
  const canUseStartPoolyn = (() => {
    if (!todayTrip || todayTrip.trip_finished_at) return false;
    if (!todayTrip.trip_started_at) {
      return designatedDriverId != null && userId === designatedDriverId;
    }
    return (
      (designatedDriverId != null && userId === designatedDriverId) ||
      todayTrip.trip_started_by_user_id === userId
    );
  })();

  /** Finish button is visible to the designated driver, crew owner, or whoever started this run. */
  const canUseFinishPoolyn =
    !!todayTrip && !todayTrip.trip_finished_at && (isTodaysDriver || owner || isTripStarter);

  const finishTripActive = !!(todayTrip?.trip_started_at && !todayTrip?.trip_finished_at);

  const wheelHint = useMemo(() => {
    if (todayTrip?.trip_started_at && !todayTrip.trip_finished_at) {
      return "Poolyn is in progress. Today’s driver cannot be changed here.";
    }
    if (wheelPool.reason === "ok" && wheelPool.members.length >= 2) {
      return "Tap Choose driver to open Crew Chat. Spin the wheel or tap I choose to drive. Corridor ends are on the wheel by default.";
    }
    if (wheelPool.reason === "no_geometry") {
      return "Save home and work on your profile to align the corridor and the wheel.";
    }
    if (wheelPool.reason === "too_few_pins") {
      return "Need at least two accepted members with saved home pins in this crew.";
    }
    if (wheelPool.reason === "too_few_near_corridor") {
      return "Need two or more homes near the commute line.";
    }
    return "Homes sit between the ends along the route; pick a driver in Crew Chat instead.";
  }, [wheelPool.reason, wheelPool.members.length, todayTrip?.trip_started_at, todayTrip?.trip_finished_at]);

  /** After the trip starts, today’s driver is fixed until the day is done. */
  const chooseDriverDisabled = !!todayTrip?.trip_finished_at || !!todayTrip?.trip_started_at;

  const showChooseDriver = !todayTrip?.trip_finished_at;

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
      : "Pick today’s driver with Choose driver below or claim in Crew Chat.";
    return {
      title: "Trip not started",
      subtitle,
      icon: "time-outline" as const,
      variant: "idle" as const,
    };
  }, [todayTrip, loadingMap, commuteStats, designatedDriverId, roster]);

  const tripInProgress = tripStatus.variant === "active";

  const commuteSummary =
    commuteStats != null
      ? `${(commuteStats.distance_m / 1000).toFixed(1)} km · ~${Math.round(commuteStats.duration_s / 60)} min`
      : null;

  const riderCostPreview = useMemo(() => {
    if (!commuteStats?.distance_m) return null;
    const driverId = todayTrip?.designated_driver_user_id ?? null;
    const ex = new Set(todayTrip?.excluded_pickup_user_ids ?? []);

    if (!driverId) {
      const poolRiders = memberCount - 1;
      if (poolRiders < 1) return null;
      const bd = computeCrewEqualCorridorRiderBreakdown({
        lockedRouteDistanceM: commuteStats.distance_m,
        lockedRouteDurationS: commuteStats.duration_s,
        poolRiderCount: poolRiders,
      });
      if (!bd) return null;
      const c = bd.total_contribution;
      return { poolRiders, centsMin: c, centsMax: c, feePreviewCents: c };
    }

    const payingIds = roster
      .filter((m) => m.userId !== driverId && !ex.has(m.userId))
      .map((m) => m.userId);
    const poolRiders = payingIds.length;
    if (poolRiders < 1) return null;

    const home = parseGeoPoint((crewOwnerAnchor?.home ?? profilePins.home_location) as unknown);
    const work = parseGeoPoint((crewOwnerAnchor?.work ?? profilePins.work_location) as unknown);
    const pattern = crew.commute_pattern ?? "to_work";
    const activeLeg: ResolvedCommuteLeg = pattern === "to_home" ? "to_home" : "to_work";
    const g = home && work ? resolveCommuteGeometry({ pattern, activeLeg, home, work }) : null;

    const latLngByUserId: Record<string, { lat: number; lng: number } | undefined> = {};
    for (const p of acceptedMemberPins) {
      latLngByUserId[p.userId] = { lat: p.lat, lng: p.lng };
    }

    if (g) {
      const det = computeCrewPerRiderDetourAttributedContributions({
        lockedRouteDistanceM: commuteStats.distance_m,
        lockedRouteDurationS: commuteStats.duration_s,
        payingRiderUserIds: payingIds,
        segmentStart: g.segmentStart,
        segmentEnd: g.segmentEnd,
        latLngByUserId,
      });
      if (det) {
        const amounts = payingIds.map((id) => det.byUserId[id] ?? 0);
        return {
          poolRiders,
          centsMin: Math.min(...amounts),
          centsMax: Math.max(...amounts),
          feePreviewCents: Math.max(...amounts),
        };
      }
    }

    const bd = computeCrewEqualCorridorRiderBreakdown({
      lockedRouteDistanceM: commuteStats.distance_m,
      lockedRouteDurationS: commuteStats.duration_s,
      poolRiderCount: poolRiders,
    });
    if (!bd) return null;
    const c = bd.total_contribution;
    return { poolRiders, centsMin: c, centsMax: c, feePreviewCents: c };
  }, [
    commuteStats,
    roster,
    memberCount,
    todayTrip?.designated_driver_user_id,
    todayTrip?.excluded_pickup_user_ids,
    crew.commute_pattern,
    crewOwnerAnchor?.home,
    crewOwnerAnchor?.work,
    profilePins.home_location,
    profilePins.work_location,
    acceptedMemberPins,
  ]);

  /** Solo corridor minutes for schedule math (locked crew route, then profile). */
  const baseCorridorMinForSchedule = useMemo(() => {
    if (commuteStats?.duration_s && commuteStats.duration_s > 0) {
      return Math.max(1, Math.round(commuteStats.duration_s / 60));
    }
    if (crew.locked_route_duration_s != null && crew.locked_route_duration_s > 0) {
      return Math.max(1, Math.round(crew.locked_route_duration_s / 60));
    }
    return 25;
  }, [commuteStats, crew.locked_route_duration_s]);

  /** Passengers in today’s pool (roster minus driver, respecting excluded pickups). Drives live suggested start when roster changes. */
  const passengerUserIdsForSuggestedStart = useMemo(() => {
    if (!designatedDriverId) return [] as string[];
    const ex = new Set(todayTrip?.excluded_pickup_user_ids ?? []);
    return roster
      .filter((m) => m.userId !== designatedDriverId && !ex.has(m.userId))
      .map((m) => m.userId);
  }, [roster, designatedDriverId, todayTrip?.excluded_pickup_user_ids]);

  const suggestedSchedulePlan = useMemo(() => {
    if (!designatedDriverId) return null;
    return computeCrewSchedulePlanForDriver({
      commutePattern: crew.commute_pattern ?? "to_work",
      viewerHome: profilePins.home_location,
      viewerWork: profilePins.work_location,
      driverUserId: designatedDriverId,
      memberPins: acceptedMemberPins,
      passengerUserIds: passengerUserIdsForSuggestedStart,
      mode: crew.schedule_mode ?? "arrival",
      anchorMinutes: modMinutes(crew.schedule_anchor_minutes ?? 540),
      baseCorridorMinutes: baseCorridorMinForSchedule,
      extraMinByUserId: {},
    });
  }, [
    designatedDriverId,
    acceptedMemberPins,
    passengerUserIdsForSuggestedStart,
    crew.commute_pattern,
    crew.schedule_mode,
    crew.schedule_anchor_minutes,
    profilePins.home_location,
    profilePins.work_location,
    baseCorridorMinForSchedule,
  ]);

  const suggestedStartMinutes = suggestedSchedulePlan?.driverDepartMinutes ?? driverDepartMinutesFromCrew(crew);

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
          <Text style={styles.todaysDriverLine} numberOfLines={1}>
            Today&apos;s driver: {todaysDriverFullName ?? "Not set yet"}
          </Text>
          <View style={styles.chipRow}>
            <Pressable
              style={styles.infoChip}
              onPress={() => router.push(`/(tabs)/profile/crew-settings/${crew.id}`)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Crew settings, ${memberCount} members in crew`}
            >
              <Text style={styles.infoChipText}>{memberCount} members</Text>
            </Pressable>
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
              {crew.commute_pattern === "round_trip" ? (
                <>
                  <Ionicons name="git-compare-outline" size={14} color={Colors.primaryDark} />
                  <Text style={styles.patternBadgeText}>Round trip</Text>
                </>
              ) : (
                <>
                  <Text style={styles.patternBadgeText}>
                    {crew.commute_pattern === "to_home" ? "Work" : "Home"}
                  </Text>
                  <Ionicons name="arrow-forward" size={14} color={Colors.primaryDark} />
                  <Text style={styles.patternBadgeText}>
                    {crew.commute_pattern === "to_home" ? "Home" : "Work"}
                  </Text>
                </>
              )}
            </View>
          </View>
          {commuteSummary ? <Text style={styles.commuteSummary}>{commuteSummary}</Text> : null}
          <View style={styles.suggestedStartRow}>
            <Text style={styles.suggestedStartLine} numberOfLines={1}>
              <Text style={styles.suggestedStartLabel}>Suggested Start: </Text>
              <Text style={styles.suggestedStartTime}>{formatMinutesAsTime(suggestedStartMinutes)}</Text>
            </Text>
            {todayTrip && designatedDriverId ? (
              <Pressable
                onPress={() => setTripScheduleOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Open trip time calculator"
              >
                <Ionicons name="calculator-outline" size={20} color={Colors.primaryDark} />
              </Pressable>
            ) : null}
          </View>
          {riderCostPreview ? (
            <View style={styles.riderCostBlock}>
              <PassengerPaymentCostLines
                contributionCents={riderCostPreview.feePreviewCents}
                passengerHasWorkplaceOrgOnProfile={hasWorkplaceNetworkOnProfile}
                context="crew"
                textStyle="meta"
                primaryLine={
                  riderCostPreview.centsMin === riderCostPreview.centsMax
                    ? `Est. rider share (${riderCostPreview.poolRiders} rider${
                        riderCostPreview.poolRiders === 1 ? "" : "s"
                      }): ~$${(riderCostPreview.centsMin / 100).toFixed(2)} (incl. $1 stop fee)`
                    : `Est. rider share (${riderCostPreview.poolRiders} riders): about $${(
                        riderCostPreview.centsMin / 100
                      ).toFixed(2)} to $${(riderCostPreview.centsMax / 100).toFixed(
                        2
                      )} (incl. $1 stop fee). Off-corridor pickup adds to that rider only.`
                }
              />
            </View>
          ) : null}
        </View>
        <Pressable
          style={styles.iconBtn}
          onPress={() => router.push(`/(tabs)/profile/crew-settings/${crew.id}`)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Crew settings"
        >
          <Ionicons name="settings-outline" size={22} color={Colors.primary} />
        </Pressable>
      </View>

      <Pressable
        style={styles.mapWrap}
        onPress={() => openMapExternal()}
        disabled={!mapUrl || loadingMap}
        accessibilityRole="button"
        accessibilityLabel="Open route map"
      >
        {loadingMap ? (
          <View style={[styles.mapTile, styles.mapLoaderWrap]}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : mapUrl ? (
          <Image source={{ uri: mapUrl }} style={styles.mapTile} resizeMode="cover" />
        ) : (
          <View style={[styles.mapTile, styles.mapPlaceholder]}>
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
        designatedDriverId ? (
          <View style={styles.mapRouteKey}>
            
            <View style={styles.mapRouteKeyRow}>
              <Text style={styles.mapRouteKeyTag}>START</Text>
              <Text style={styles.mapRouteKeyText}> {todaysDriverFullName ?? "Driver"}</Text>
            </View>
            {orderedLegsPreview.map((p, i) => (
              <View key={`mapkey-${p.userId}`} style={styles.mapRouteKeyRow}>
                <Text style={styles.mapRouteKeyTag}>STOP {i + 1}</Text>
                <Text style={styles.mapRouteKeyText}> {(p.fullName || "Crewmate").trim()}</Text>
              </View>
            ))}
            {finalNavPoint ? (
              <View style={styles.mapRouteKeyRow}>
                <Text style={styles.mapRouteKeyTag}>END</Text>
                <Text style={styles.mapRouteKeyText}> {finalNavLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={styles.mapLegend}>
            Green route and pins: your commute line and crew homes (approximate areas).
          </Text>
        )
      ) : null}

      <View
        style={[
          styles.tripStatusBox,
          tripStatus.variant === "active" && styles.tripStatusBoxActive,
          tripStatus.variant === "done" && styles.tripStatusBoxDone,
        ]}
        accessibilityLabel={`${tripStatus.title}. ${tripStatus.subtitle}`}
      >
        {tripStatus.variant === "idle" ? (
          <View style={styles.tripStatusIconSpacer} />
        ) : (
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
        )}
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
              <Text style={styles.finishHintBold}>Finish trip</Text> to settle rider shares from Poolyn balances.
            </Text>
          ) : (
            <Text style={styles.finishHintMuted}>
              Outline until today&apos;s run has started; then this highlights so you can close the day in chat.
            </Text>
          )}
        </>
      ) : null}

      <View style={styles.chatAndWheelBlock}>
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
              <Text style={styles.chatBtnText}>Crew Chat</Text>
            </>
          )}
        </Pressable>

        {showChooseDriver ? (
          <>
            <Pressable
              style={[
                styles.chooseDriverBtn,
                chooseDriverDisabled && styles.chooseDriverBtnOff,
              ]}
              disabled={chooseDriverDisabled || opening}
              onPress={() => void openTodaysChat()}
              accessibilityRole="button"
              accessibilityLabel="Choose driver in crew chat"
            >
              {opening ? (
                <ActivityIndicator color={POOLYN_YELLOW_TEXT} />
              ) : (
                <>
                  <MaterialCommunityIcons name="steering" size={20} color={POOLYN_YELLOW_TEXT} />
                  <Text style={styles.chooseDriverBtnText}>Choose driver</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.wheelHintText}>{wheelHint}</Text>
          </>
        ) : null}
      </View>

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
            <Text style={styles.detailBulletLine}>
              • Pins show your home and work on your saved commute line when Mapbox can route.
            </Text>
            <Text style={styles.detailBulletLine}>
              • Smaller pins are crewmates&apos; home areas.
            </Text>
            <Text style={styles.detailBulletLine}>
              • In Start Poolyn, turn off anyone not riding today so they are not charged at settlement.
            </Text>
            <Text style={styles.detailBulletLine}>
              • Automated pickup checks against saved addresses are planned later.
            </Text>
          </View>

          {roster.length > 0 || pendingInvitees.length > 0 ? (
            <View style={styles.membersBlock}>
              {roster.length > 0 ? (
                <>
                  <Text style={styles.membersLabel}>In this crew</Text>
                  <View style={styles.memberChips}>
                    {roster.map((m) => (
                      <View
                        key={m.userId}
                        style={[
                          styles.memberChip,
                          designatedDriverId === m.userId && styles.memberChipDriver,
                        ]}
                      >
                        <Ionicons name="person" size={14} color={Colors.primaryDark} />
                        <Text style={styles.memberChipText} numberOfLines={1}>
                          {(m.fullName || "Member").trim()}
                          {m.userId === userId ? " (you)" : ""}
                        </Text>
                        {designatedDriverId === m.userId ? (
                          <View style={styles.driverBadge}>
                            <Text style={styles.driverBadgeText}>Driver</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              {pendingInvitees.length > 0 ? (
                <>
                  <Text style={[styles.membersLabel, styles.invitedLabel]}>Invited (pending)</Text>
                  <View style={styles.memberChips}>
                    {pendingInvitees.map((p) => (
                      <View key={p.userId} style={[styles.memberChip, styles.memberChipPending]}>
                        <Ionicons name="mail-outline" size={14} color={Colors.textSecondary} />
                        <Text style={[styles.memberChipText, styles.memberChipTextMuted]} numberOfLines={1}>
                          {(p.fullName || "Invited").trim()}
                          {p.userId === userId ? " (you)" : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {orderedLegsPreview.length > 0 ? (
            <View style={styles.legsBlock}>
              <Text style={styles.legsTitle}>Pickup order &amp; legs</Text>
              <Text style={styles.legsExplainer}>
                Order uses the crew corridor (same for everyone). It does not come from the driver wheel. Poolyn does
                not track arrivals. Confirm stops in Google Maps. If Maps does not advance, open the next row here.
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

      {todayTrip && (scheduleDriverIdOverride ?? designatedDriverId) ? (
        <CrewTripScheduleModal
          visible={tripScheduleOpen}
          onClose={() => {
            setTripScheduleOpen(false);
            setScheduleDriverIdOverride(null);
          }}
          onSaved={() => {
            void loadMapAndRoster().then(() => onRefresh?.());
          }}
          crew={crew}
          tripInstance={todayTrip}
          driverUserId={scheduleDriverIdOverride ?? designatedDriverId!}
          viewerUserId={userId}
          roster={roster}
          memberPins={acceptedMemberPins}
          viewerHome={profilePins.home_location}
          viewerWork={profilePins.work_location}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.28)",
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
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
  },
  compactHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  iconBtn: { padding: 4, marginTop: 2 },
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
  suggestedStartRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  suggestedStartLine: {
    flex: 1,
    minWidth: 0,
  },
  suggestedStartLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  suggestedStartTime: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
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
  todaysDriverLine: {
    marginTop: 6,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  membersBlock: { marginBottom: Spacing.sm },
  membersLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  memberChips: { flexDirection: "column", gap: Spacing.sm, paddingVertical: 2, alignSelf: "stretch" },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignSelf: "stretch",
  },
  memberChipDriver: {
    borderColor: "rgba(11, 132, 87, 0.55)",
    backgroundColor: "rgba(236, 253, 245, 0.95)",
  },
  driverBadge: {
    marginLeft: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primary,
  },
  driverBadgeText: {
    fontSize: 9,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
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
  },
  /** Matches Mapbox `CREW_ROUTINE_STATIC_MAP_SIZE` so the bitmap is not cropped by a mismatched frame. */
  mapTile: {
    width: "100%",
    aspectRatio: CREW_ROUTINE_STATIC_MAP_ASPECT,
  },
  mapLoaderWrap: {
    justifyContent: "center",
    alignItems: "center",
  },
  mapLegend: {
    fontSize: 10,
    lineHeight: 14,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  mapRouteKey: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    gap: 4,
  },
  mapRouteKeyIntro: {
    fontSize: 10,
    lineHeight: 14,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  mapRouteKeyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 4,
  },
  mapRouteKeyTag: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    minWidth: 52,
  },
  mapRouteKeyText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 14,
    color: Colors.textSecondary,
  },
  mapPlaceholder: {
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
  tripStatusIconSpacer: {
    width: 22,
    minHeight: 22,
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
  chatAndWheelBlock: {
    alignSelf: "stretch",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  chooseDriverBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    backgroundColor: POOLYN_YELLOW,
  },
  chooseDriverBtnOff: {
    opacity: 0.45,
  },
  chooseDriverBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: POOLYN_YELLOW_TEXT,
  },
  wheelHintText: {
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
    gap: 6,
  },
  detailBulletLine: {
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
