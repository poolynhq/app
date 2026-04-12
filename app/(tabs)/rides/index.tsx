import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { showAlert } from "@/lib/platformAlert";
import { supabase } from "@/lib/supabase";
import { normalizeRpcGeoJson, parseGeoPoint } from "@/lib/parseGeoPoint";
import { haversineKm } from "@/lib/geoDistance";
import { presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import { RideRouteStepsModal } from "@/components/rides/RideRouteStepsModal";
import { useExpiryCountdown } from "@/hooks/useExpiryCountdown";
import {
  formatPassengerUpcomingCard,
  listMyUpcomingRidesAsPassenger,
  type PassengerUpcomingRide,
} from "@/lib/passengerRides";
import {
  type DriverUpcomingRide,
  formatDriverUpcomingCard,
  listMyUpcomingRidesAsDriver,
} from "@/lib/driverRides";
import {
  acceptRideRequestAsDriver,
  listMyPendingRideRequests,
  listOpenRideRequestsForDriver,
  runExpireStalePickupRequests,
  type MyPendingRideRequestRow,
  type RideRequestOpenRow,
} from "@/lib/rideRequests";
import {
  listMyCompletedCrewTripsForHistory,
  type CompletedCrewTripHistoryRow,
} from "@/lib/crewMessaging";
import { CrewTripHistoryCard } from "@/components/rides/CrewTripHistoryCard";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { canViewerActAsDriver } from "@/lib/commuteMatching";
import {
  ADHOC_DRIVER_REPLY_MAX_CHARS,
  cancelMyAdhocSeatRequest,
  firstNameOnly,
  formatAdhocPassengerPendingCard,
  listPendingAdhocBookingsForDriver,
  listPendingAdhocSeatRequestsAsPassenger,
  poolynRespondAdhocSeatBooking,
  type AdhocPassengerPendingRow,
  type AdhocPendingBookingRow,
} from "@/lib/adhocPoolyn";
import { passengerCancelConfirmedAdhocSeat } from "@/lib/adhocCancellation";
import { PassengerPaymentCostLines } from "@/components/home/PassengerPaymentCostLines";

type TabKey = "upcoming" | "open_requests" | "past";

function PendingExpiryHint({ expiresAt }: { expiresAt: string }) {
  const label = useExpiryCountdown(expiresAt);
  if (!label) return null;
  return <Text style={styles.expiryHint}>Auto-cancels in {label} if no driver accepts</Text>;
}

function formatDepart(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function rideRequestAcceptErrorMessage(raw: string): string {
  const key = raw.trim();
  const map: Record<string, string> = {
    driver_org_closed_network:
      "Your organisation is set to in-network commuting only. Ask an admin to allow cross-network commuting in Admin → Settings if you should pick up people outside your workplace.",
    passenger_org_closed_network:
      "This person’s organisation does not allow commuting with people outside their network.",
    driver_outer_riders_disabled:
      "Turn on “Show riders outside my workplace” under the map on Home to accept pickup requests from other organisations.",
    org_mismatch:
      "This pickup cannot be matched under current network rules. Check cross-network settings for both organisations.",
  };
  return map[key] ?? raw;
}

function RideCardActions({
  rideId,
  origin,
  destination,
  passengerLegPickup,
  riderLegDestination,
  showNavigate = true,
}: {
  rideId: string;
  origin: unknown;
  destination: unknown;
  /** When set, Navigate and Steps use your pickup to trip end (rider leg). */
  passengerLegPickup?: unknown | null;
  /** Rider search destination (e.g. Mildura); steps go pickup → here, not driver end city. */
  riderLegDestination?: unknown | null;
  /** Passengers on someone else’s trip use Message and Steps only. */
  showNavigate?: boolean;
}) {
  const router = useRouter();
  const [stepsOpen, setStepsOpen] = useState(false);
  const navPoint = passengerLegPickup
    ? parseGeoPoint(normalizeRpcGeoJson(passengerLegPickup))
    : parseGeoPoint(normalizeRpcGeoJson(origin));
  const riderLeg = Boolean(passengerLegPickup);
  const legDest = riderLegDestination ?? destination;

  return (
    <>
      <View style={styles.rideActionsRow}>
        <TouchableOpacity
          style={styles.rideActionBtn}
          activeOpacity={0.8}
          onPress={() => router.push(`/(tabs)/messages/${rideId}`)}
          accessibilityRole="button"
          accessibilityLabel="Open ride messages"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.primary} />
          <Text style={styles.rideActionText}>Message</Text>
        </TouchableOpacity>
        {showNavigate && navPoint ? (
          <TouchableOpacity
            style={styles.rideActionBtn}
            activeOpacity={0.8}
            onPress={() => presentDrivingNavigationPicker(navPoint.lat, navPoint.lng)}
            accessibilityRole="button"
            accessibilityLabel={
              riderLeg ? "Turn-by-turn navigation to your pickup point" : "Turn-by-turn navigation to pickup"
            }
          >
            <Ionicons name="navigate-outline" size={18} color={Colors.primary} />
            <Text style={styles.rideActionText}>Navigate</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.rideActionBtn}
          activeOpacity={0.8}
          onPress={() => setStepsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="View route steps"
        >
          <Ionicons name="list-outline" size={18} color={Colors.primary} />
          <Text style={styles.rideActionText}>Steps</Text>
        </TouchableOpacity>
      </View>
      <RideRouteStepsModal
        key={riderLeg ? `rider-leg-${rideId}` : `full-route-${rideId}`}
        visible={stepsOpen}
        onClose={() => setStepsOpen(false)}
        origin={riderLeg ? (passengerLegPickup ?? origin) : origin}
        destination={riderLeg ? legDest : destination}
        title={riderLeg ? "Your leg (pickup to drop-off)" : "Full route (pickup to drop-off)"}
        hint={
          riderLeg
            ? showNavigate
              ? "Steps from your pickup point to the trip drop-off (Mapbox). Open Navigate for live turn-by-turn to your pickup first if you need it."
              : "Steps from your pickup point to your searched destination (Mapbox)."
            : undefined
        }
      />
    </>
  );
}

function ActiveRideCard({
  rideId,
  origin,
  destination,
  title,
  meta,
  sub,
  passengerLegPickup,
  riderLegDestination,
  expectedContributionCents,
  passengerHasWorkplaceOrg,
}: {
  rideId: string;
  origin: unknown;
  destination: unknown;
  title: string;
  meta: string;
  sub: string;
  passengerLegPickup?: unknown | null;
  riderLegDestination?: unknown | null;
  expectedContributionCents?: number;
  passengerHasWorkplaceOrg?: boolean;
}) {
  return (
    <View style={styles.upcomingRideCard}>
      <Text style={styles.upcomingRideTitle}>{title}</Text>
      <Text style={styles.upcomingRideMeta}>{meta}</Text>
      <Text style={styles.upcomingRideSub}>{sub}</Text>
      {typeof expectedContributionCents === "number" && expectedContributionCents > 0 ? (
        <PassengerPaymentCostLines
          contributionCents={expectedContributionCents}
          passengerHasWorkplaceOrgOnProfile={Boolean(passengerHasWorkplaceOrg)}
          context="mingle"
          textStyle="meta"
          containerStyle={{ marginTop: Spacing.sm }}
        />
      ) : null}
      <RideCardActions
        rideId={rideId}
        origin={origin}
        destination={destination}
        passengerLegPickup={passengerLegPickup}
        riderLegDestination={riderLegDestination}
        showNavigate={false}
      />
    </View>
  );
}

function DriverTripDashboardCard({
  ride,
  pendingForRide,
  adhocDriverNotes,
  setAdhocDriverNotes,
  adhocRespondBusy,
  onRespondAdhoc,
}: {
  ride: DriverUpcomingRide;
  pendingForRide: AdhocPendingBookingRow[];
  adhocDriverNotes: Record<string, string>;
  setAdhocDriverNotes: Dispatch<SetStateAction<Record<string, string>>>;
  adhocRespondBusy: string | null;
  onRespondAdhoc: (bookingId: string, accept: boolean) => void;
}) {
  const router = useRouter();
  const card = formatDriverUpcomingCard(ride);
  const pendingCount = pendingForRide.length;
  const confirmedCount = ride.confirmedPassengerCount;
  const statusLabel = ride.status === "active" ? "In progress" : "Scheduled";
  const kindLabel = ride.poolynContext === "adhoc" ? "Dated trip" : "Commute";

  return (
    <View style={styles.dashCard}>
      <View
        style={[
          styles.dashAccent,
          ride.poolynContext === "adhoc" ? styles.dashAccentAdhoc : styles.dashAccentCommute,
        ]}
      />
      <View style={styles.dashCardBody}>
        <View style={styles.dashHeaderRow}>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{kindLabel}</Text>
          </View>
          <Text style={[styles.dashStatus, ride.status === "active" ? styles.dashStatusActive : null]}>
            {statusLabel}
          </Text>
        </View>
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              {ride.seatsAvailable} seat{ride.seatsAvailable === 1 ? "" : "s"} left
            </Text>
          </View>
          {confirmedCount > 0 ? (
            <View style={[styles.pill, styles.pillMuted]}>
              <Text style={styles.pillTextMuted}>
                {confirmedCount} booked
              </Text>
            </View>
          ) : null}
          {pendingCount > 0 ? (
            <View style={[styles.pill, styles.pillWarn]}>
              <Ionicons name="mail-unread-outline" size={14} color={Colors.warning} />
              <Text style={styles.pillWarnText}>
                {pendingCount} request{pendingCount === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.dashTitle}>{card.title}</Text>
        <Text style={styles.dashMeta}>{formatDepart(ride.departAt)}</Text>
        <Text style={styles.dashSub}>{card.sub}</Text>
        {ride.passengerContributions.length > 0 ? (
          <View style={styles.driverPricingBlock}>
            <Text style={styles.driverPricingTitle}>Rider trip shares (estimate)</Text>
            {ride.passengerContributions.map((pc) => (
              <Text key={pc.passengerId} style={styles.driverPricingLine}>
                {firstNameOnly(pc.fullName ?? "Rider")}: $
                {(Math.max(0, pc.expectedContributionCents) / 100).toFixed(2)} trip share
              </Text>
            ))}
            <Text style={styles.driverPricingHint}>
              Amounts follow the multi-stop Poolyn pricing snapshot. They can change if riders or pickups change.
            </Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.dashDetailLink}
          onPress={() => router.push(`/(tabs)/rides/trip/${ride.rideId}`)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Open trip details"
        >
          <Text style={styles.dashDetailLinkText}>Trip details and booked riders</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
        </TouchableOpacity>
        <RideCardActions rideId={ride.rideId} origin={ride.origin} destination={ride.destination} />

        {pendingForRide.length > 0 ? (
          <View style={styles.nestedRequests}>
            <Text style={styles.nestedRequestsTitle}>Respond to seat requests</Text>
            <Text style={styles.nestedRequestsHint}>
              First names only. Coordinate in Messages on this ride after you accept.
            </Text>
            {pendingForRide.map((b) => (
              <View key={b.id} style={styles.adhocBookingCard}>
                <Text style={styles.requestName}>{firstNameOnly(b.passenger.full_name)}</Text>
                <Text style={styles.requestMeta}>
                  {b.ride.adhoc_origin_label ?? "Start"} → {b.ride.adhoc_destination_label ?? "End"} ·{" "}
                  {formatDepart(b.ride.depart_at)}
                </Text>
                {b.pickup_km_from_ride_origin != null ? (
                  <Text style={styles.requestSub}>
                    Pickup ≈ {b.pickup_km_from_ride_origin.toFixed(1)} km from your trip start (straight line).
                  </Text>
                ) : null}
                {b.needs_checked_bag ? (
                  <Text style={styles.requestSub}>Wants checked-bag-sized luggage space.</Text>
                ) : null}
                {b.passenger_message ? (
                  <Text style={styles.adhocPassengerMsg}>&ldquo;{b.passenger_message}&rdquo;</Text>
                ) : null}
                <TextInput
                  style={styles.adhocNoteInput}
                  placeholder="Optional reply (visible in Poolyn only)"
                  placeholderTextColor={Colors.textTertiary}
                  value={adhocDriverNotes[b.id] ?? ""}
                  onChangeText={(t) =>
                    setAdhocDriverNotes((prev) => ({ ...prev, [b.id]: t }))
                  }
                  multiline
                  maxLength={ADHOC_DRIVER_REPLY_MAX_CHARS}
                />
                <View style={styles.adhocBtnRow}>
                  <TouchableOpacity
                    style={[styles.adhocSecondaryBtn, adhocRespondBusy === b.id && styles.btnDisabled]}
                    disabled={adhocRespondBusy === b.id}
                    onPress={() => void onRespondAdhoc(b.id, false)}
                  >
                    {adhocRespondBusy === b.id ? (
                      <ActivityIndicator color={Colors.primary} size="small" />
                    ) : (
                      <Text style={styles.adhocSecondaryBtnText}>Decline</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.adhocPrimaryBtn, adhocRespondBusy === b.id && styles.btnDisabled]}
                    disabled={adhocRespondBusy === b.id}
                    onPress={() => void onRespondAdhoc(b.id, true)}
                  >
                    {adhocRespondBusy === b.id ? (
                      <ActivityIndicator color={Colors.textOnPrimary} size="small" />
                    ) : (
                      <Text style={styles.adhocPrimaryBtnText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function MyRides() {
  const router = useRouter();
  const { profile, session, refreshProfile } = useAuth();
  const userId = profile?.id ?? session?.user?.id ?? null;
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const tabParam = Array.isArray(tab) ? tab[0] : tab;
  const canDrive = profile ? canViewerActAsDriver(profile) : false;

  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [openRequests, setOpenRequests] = useState<RideRequestOpenRow[]>([]);
  const [myPending, setMyPending] = useState<MyPendingRideRequestRow[]>([]);
  const [passengerUpcoming, setPassengerUpcoming] = useState<PassengerUpcomingRide[]>([]);
  const [driverUpcoming, setDriverUpcoming] = useState<DriverUpcomingRide[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [crewHistory, setCrewHistory] = useState<CompletedCrewTripHistoryRow[]>([]);
  const [loadingCrewHistory, setLoadingCrewHistory] = useState(false);
  const [adhocPending, setAdhocPending] = useState<AdhocPendingBookingRow[]>([]);
  const [adhocPassengerPending, setAdhocPassengerPending] = useState<AdhocPassengerPendingRow[]>([]);
  const [adhocRespondBusy, setAdhocRespondBusy] = useState<string | null>(null);
  const [adhocDriverNotes, setAdhocDriverNotes] = useState<Record<string, string>>({});
  const [cancellingAdhocBookingId, setCancellingAdhocBookingId] = useState<string | null>(null);
  const [cancellingConfirmedRideId, setCancellingConfirmedRideId] = useState<string | null>(null);
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);

  useEffect(() => {
    if (tabParam === "open" && canDrive) setActiveTab("open_requests");
  }, [tabParam, canDrive]);

  const loadOpenRequests = useCallback(async () => {
    if (!canDrive) {
      setOpenRequests([]);
      return;
    }
    setLoadingOpen(true);
    const rows = await listOpenRideRequestsForDriver();
    setOpenRequests(rows);
    setLoadingOpen(false);
  }, [canDrive]);

  const loadMyPending = useCallback(async () => {
    if (!userId) {
      setMyPending([]);
      return;
    }
    await runExpireStalePickupRequests();
    const rows = await listMyPendingRideRequests(userId);
    setMyPending(rows);
  }, [userId]);

  const loadDriverUpcoming = useCallback(async () => {
    if (!userId) {
      setDriverUpcoming([]);
      return;
    }
    setDriverUpcoming(await listMyUpcomingRidesAsDriver(userId));
  }, [userId]);

  const loadPassengerUpcoming = useCallback(async () => {
    if (!userId) {
      setPassengerUpcoming([]);
      return;
    }
    setPassengerUpcoming(await listMyUpcomingRidesAsPassenger(userId));
  }, [userId]);

  const loadCrewHistory = useCallback(async () => {
    if (!userId) {
      setCrewHistory([]);
      return;
    }
    setLoadingCrewHistory(true);
    setCrewHistory(await listMyCompletedCrewTripsForHistory(userId));
    await refreshProfile();
    setLoadingCrewHistory(false);
  }, [userId, refreshProfile]);

  const loadAdhocPending = useCallback(async () => {
    if (!userId) {
      setAdhocPending([]);
      return;
    }
    setAdhocPending(await listPendingAdhocBookingsForDriver(userId));
  }, [userId]);

  const loadAdhocPassengerPending = useCallback(async () => {
    if (!userId) {
      setAdhocPassengerPending([]);
      return;
    }
    setAdhocPassengerPending(await listPendingAdhocSeatRequestsAsPassenger(userId));
  }, [userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadOpenRequests(),
      loadMyPending(),
      loadPassengerUpcoming(),
      loadDriverUpcoming(),
      loadCrewHistory(),
      loadAdhocPending(),
      loadAdhocPassengerPending(),
    ]);
    setRefreshing(false);
  }, [
    loadOpenRequests,
    loadMyPending,
    loadPassengerUpcoming,
    loadDriverUpcoming,
    loadCrewHistory,
    loadAdhocPending,
    loadAdhocPassengerPending,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingUpcoming(true);
      await Promise.all([
        loadOpenRequests(),
        loadMyPending(),
        loadPassengerUpcoming(),
        loadDriverUpcoming(),
        loadAdhocPending(),
        loadAdhocPassengerPending(),
      ]);
      if (!cancelled) setLoadingUpcoming(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    loadOpenRequests,
    loadMyPending,
    loadPassengerUpcoming,
    loadDriverUpcoming,
    loadAdhocPending,
    loadAdhocPassengerPending,
  ]);

  useEffect(() => {
    if (activeTab === "past") void loadCrewHistory();
  }, [activeTab, loadCrewHistory]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      void loadPassengerUpcoming();
      void loadAdhocPassengerPending();
    }, [userId, loadPassengerUpcoming, loadAdhocPassengerPending])
  );

  const tabs = useMemo(() => {
    const base: { key: TabKey; label: string }[] = [
      { key: "upcoming", label: "Active" },
      ...(canDrive ? [{ key: "open_requests" as const, label: "Respond" }] : []),
      { key: "past", label: "History" },
    ];
    return base;
  }, [canDrive]);

  const adhocPendingByRideId = useMemo(() => {
    const m = new Map<string, AdhocPendingBookingRow[]>();
    for (const b of adhocPending) {
      const cur = m.get(b.ride_id) ?? [];
      cur.push(b);
      m.set(b.ride_id, cur);
    }
    return m;
  }, [adhocPending]);

  const totalPendingAdhoc = adhocPending.length;
  const activeTabSummary = useMemo(() => {
    const driveCount = driverUpcoming.length;
    const rideCount = passengerUpcoming.length;
    const bits: string[] = [];
    if (driveCount > 0) bits.push(`${driveCount} trip${driveCount === 1 ? "" : "s"} driving`);
    if (rideCount > 0) bits.push(`${rideCount} as rider`);
    if (myPending.length > 0) bits.push(`${myPending.length} pickup request${myPending.length === 1 ? "" : "s"} waiting`);
    if (totalPendingAdhoc > 0) bits.push(`${totalPendingAdhoc} seat request${totalPendingAdhoc === 1 ? "" : "s"} to answer`);
    if (adhocPassengerPending.length > 0) {
      bits.push(
        `${adhocPassengerPending.length} dated trip request${adhocPassengerPending.length === 1 ? "" : "s"} pending`
      );
    }
    return bits.join(" · ");
  }, [driverUpcoming.length, passengerUpcoming.length, myPending.length, totalPendingAdhoc, adhocPassengerPending.length]);

  function pickupKmFromHome(origin: unknown): number | null {
    const h = parseGeoPoint(profile?.home_location as unknown);
    const o = parseGeoPoint(origin);
    if (!h || !o) return null;
    return Math.round(haversineKm(h, o) * 10) / 10;
  }

  async function onAcceptRequest(requestId: string) {
    setAcceptingId(requestId);
    const res = await acceptRideRequestAsDriver(requestId);
    setAcceptingId(null);
    if (res.ok) {
      const { data: ride } = await supabase.from("rides").select("origin").eq("id", res.rideId).maybeSingle();
      const pt = ride?.origin ? parseGeoPoint(ride.origin) : null;
      if (pt) {
        showAlert(
          "Accepted",
          "Navigation opens in Maps with turn-by-turn to your colleague's pickup.",
          [
            {
              text: "Navigate to pickup",
              onPress: () => presentDrivingNavigationPicker(pt.lat, pt.lng),
            },
            { text: "Later", style: "cancel" },
          ]
        );
      } else {
        showAlert(
          "Accepted",
          "A ride was created. Pickup and payment steps still follow your normal ride flow."
        );
      }
      void loadOpenRequests();
      void loadMyPending();
      void loadPassengerUpcoming();
      void loadDriverUpcoming();
      setActiveTab("upcoming");
    } else {
      showAlert("Could not accept", rideRequestAcceptErrorMessage(res.reason));
    }
  }

  function onPassengerCancelConfirmedSeat(rideId: string) {
    showAlert(
      "Leave this trip?",
      "You will no longer be booked. The driver is notified. You can search for another dated trip anytime.",
      [
        { text: "Stay booked", style: "cancel" },
        {
          text: "Cancel my seat",
          style: "destructive",
          onPress: () => {
            showAlert(
              "Confirm",
              "This frees your seat for someone else. Continue?",
              [
                { text: "Back", style: "cancel" },
                {
                  text: "Yes, cancel my seat",
                  style: "destructive",
                  onPress: async () => {
                    setCancellingConfirmedRideId(rideId);
                    const res = await passengerCancelConfirmedAdhocSeat(rideId);
                    setCancellingConfirmedRideId(null);
                    if (res.ok) {
                      void loadPassengerUpcoming();
                    } else {
                      showAlert("Could not cancel", res.reason);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function onCancelAdhocPassengerRequest(bookingId: string) {
    showAlert(
      "Cancel this request?",
      "The driver will be notified. You can search for another trip anytime.",
      [
        { text: "Keep waiting", style: "cancel" },
        {
          text: "Cancel request",
          style: "destructive",
          onPress: async () => {
            setCancellingAdhocBookingId(bookingId);
            const res = await cancelMyAdhocSeatRequest(bookingId);
            setCancellingAdhocBookingId(null);
            if (res.ok) {
              void loadAdhocPassengerPending();
              void loadDriverUpcoming();
            } else {
              showAlert("Could not cancel", res.reason);
            }
          },
        },
      ]
    );
  }

  async function onRespondAdhoc(bookingId: string, accept: boolean) {
    const note = (adhocDriverNotes[bookingId] ?? "").trim();
    setAdhocRespondBusy(bookingId);
    const res = await poolynRespondAdhocSeatBooking({
      bookingId,
      accept,
      message: note,
    });
    setAdhocRespondBusy(null);
    if (res.ok) {
      setAdhocDriverNotes((prev) => {
        const n = { ...prev };
        delete n[bookingId];
        return n;
      });
      showAlert(
        accept ? "Confirmed" : "Declined",
        accept
          ? "The rider is added to your trip. Use Messages on this ride to coordinate in Poolyn."
          : "They can search for another trip."
      );
      void loadAdhocPending();
      void loadAdhocPassengerPending();
      void loadDriverUpcoming();
      void loadPassengerUpcoming();
    } else {
      showAlert("Could not update", res.reason);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Rides</Text>
        <Text style={styles.headerSub}>
          Dated trips you post as driver appear under Active. Pull to refresh.
        </Text>
      </View>

      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={Colors.primary} />
        }
      >
        {activeTab === "open_requests" ? (
          <View style={styles.panel}>
            <Text style={styles.panelHint}>
              Open requests use your saved commute and organisation rules. Cross-network pickups are allowed only
              when both workplaces permit it and you have enabled outside riders on Home. You need an active
              vehicle with more than one seat. Prefer accepting from the push alert you already received.
            </Text>
            {loadingOpen ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xl }} />
            ) : openRequests.length === 0 ? (
              <View style={styles.emptyInline}>
                <Ionicons name="checkmark-done-outline" size={40} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>No open requests</Text>
                <Text style={styles.emptyBody}>When someone posts a pickup need, it appears here and in Activity.</Text>
              </View>
            ) : (
              openRequests.map((r) => {
                const pickupKm = pickupKmFromHome(r.origin);
                return (
                <View key={r.id} style={styles.requestCard}>
                  <Text style={styles.requestName}>{r.passenger_name?.trim() || "Colleague"}</Text>
                  <Text style={styles.requestMeta}>
                    {r.direction === "from_work" ? "From work" : "To work"} · {formatDepart(r.desired_depart_at)}
                  </Text>
                  <Text style={styles.requestSub}>±{r.flexibility_mins} min flexibility</Text>
                  {pickupKm != null ? (
                    <View style={styles.detourBlock}>
                      <View style={styles.detourBarTrack}>
                        <View style={styles.detourBarFill} />
                      </View>
                      <Text style={styles.detourHint}>
                        Pickup ≈ {pickupKm} km from your home (straight line). Real detour shows in Maps after you
                        accept.
                      </Text>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={styles.acceptBtn}
                    disabled={acceptingId === r.id}
                    onPress={() => void onAcceptRequest(r.id)}
                    activeOpacity={0.85}
                  >
                    {acceptingId === r.id ? (
                      <ActivityIndicator color={Colors.textOnPrimary} />
                    ) : (
                      <Text style={styles.acceptBtnText}>Accept &amp; create ride</Text>
                    )}
                  </TouchableOpacity>
                </View>
                );
              })
            )}
          </View>
        ) : activeTab === "upcoming" ? (
          <View style={styles.panel}>
            {loadingUpcoming ? (
              <View style={styles.loadingBlock}>
                <ActivityIndicator color={Colors.primary} size="large" />
                <Text style={styles.loadingHint}>Loading your trips</Text>
              </View>
            ) : null}

            {!loadingUpcoming && activeTabSummary.length > 0 ? (
              <View style={styles.summaryStrip}>
                <Ionicons name="pulse-outline" size={18} color={Colors.primaryDark} />
                <Text style={styles.summaryStripText}>{activeTabSummary}</Text>
              </View>
            ) : null}

            {myPending.length > 0 ? (
              <View style={styles.myRequestsBlock}>
                <Text style={styles.blockTitle}>Your open pickup requests</Text>
                {myPending.map((r) => (
                  <View key={r.id} style={styles.miniCard}>
                    <Text style={styles.miniCardText}>
                      {r.direction === "from_work" ? "From work" : "To work"} · {formatDepart(r.desired_depart_at)}
                    </Text>
                    <Text style={styles.miniCardSub}>Waiting for a driver</Text>
                    <PendingExpiryHint expiresAt={r.expires_at} />
                  </View>
                ))}
              </View>
            ) : null}

            {adhocPassengerPending.length > 0 ? (
              <View style={styles.myRequestsBlock}>
                <Text style={styles.sectionEyebrow}>Riding</Text>
                <Text style={styles.blockTitle}>Dated trip requests (pending)</Text>
                <Text style={styles.blockSubtitle}>
                  Your search corridor is the title. The line below is the driver&apos;s posted trip. They respond
                  under My rides on their account.
                </Text>
                {adhocPassengerPending.map((p) => {
                  const card = formatAdhocPassengerPendingCard(p);
                  return (
                    <View key={p.id} style={styles.passengerPendingCard}>
                      <Text style={styles.requestName}>{card.title}</Text>
                      <Text style={styles.requestMeta}>{card.meta}</Text>
                      <Text style={styles.requestSub}>{card.sub}</Text>
                      {p.needs_checked_bag ? (
                        <Text style={styles.requestSub}>You asked for checked-bag-sized space.</Text>
                      ) : null}
                      {p.passenger_message?.trim() ? (
                        <Text style={styles.adhocPassengerMsg}>&ldquo;{p.passenger_message.trim()}&rdquo;</Text>
                      ) : null}
                      <TouchableOpacity
                        style={styles.cancelAdhocRequestBtn}
                        activeOpacity={0.85}
                        disabled={cancellingAdhocBookingId === p.id}
                        onPress={() => void onCancelAdhocPassengerRequest(p.id)}
                      >
                        {cancellingAdhocBookingId === p.id ? (
                          <ActivityIndicator color={Colors.primary} size="small" />
                        ) : (
                          <Text style={styles.cancelAdhocRequestText}>Cancel request</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {passengerUpcoming.length > 0 ? (
              <View style={styles.myRequestsBlock}>
                <Text style={styles.sectionEyebrow}>Riding</Text>
                <Text style={styles.blockTitle}>With someone else driving</Text>
                {passengerUpcoming.map((ride) => {
                  const card = formatPassengerUpcomingCard(ride);
                  return (
                  <View key={ride.rideId} style={styles.passengerCardWrap}>
                    <View style={styles.passengerAccent} />
                    <View style={styles.passengerCardInner}>
                      <Text style={styles.passengerKind}>Passenger</Text>
                      <ActiveRideCard
                        rideId={ride.rideId}
                        origin={ride.origin}
                        destination={ride.destination}
                        title={card.title}
                        meta={card.meta}
                        sub={card.sub}
                        passengerLegPickup={
                          ride.poolynContext === "adhoc" ? ride.passengerPickup : null
                        }
                        riderLegDestination={
                          ride.poolynContext === "adhoc" ? ride.passengerSearchDest : null
                        }
                        expectedContributionCents={ride.expectedContributionCents}
                        passengerHasWorkplaceOrg={!!profile?.org_id}
                      />
                      {ride.poolynContext === "adhoc" ? (
                        <TouchableOpacity
                          style={styles.cancelConfirmedSeatBtn}
                          activeOpacity={0.85}
                          disabled={cancellingConfirmedRideId === ride.rideId}
                          onPress={() => onPassengerCancelConfirmedSeat(ride.rideId)}
                        >
                          {cancellingConfirmedRideId === ride.rideId ? (
                            <ActivityIndicator color={Colors.primary} size="small" />
                          ) : (
                            <Text style={styles.cancelConfirmedSeatText}>Cancel my seat</Text>
                          )}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  );
                })}
              </View>
            ) : null}

            {driverUpcoming.length > 0 ? (
              <View style={styles.myRequestsBlock}>
                <Text style={styles.sectionEyebrow}>Driving</Text>
                <Text style={styles.blockTitle}>Your upcoming trips</Text>
                <Text style={styles.blockSubtitle}>
                  Status, seats left, and how many seat requests need an answer. Requests stay on the trip they
                  belong to.
                </Text>
                {driverUpcoming.map((ride) => (
                  <DriverTripDashboardCard
                    key={ride.rideId}
                    ride={ride}
                    pendingForRide={adhocPendingByRideId.get(ride.rideId) ?? []}
                    adhocDriverNotes={adhocDriverNotes}
                    setAdhocDriverNotes={setAdhocDriverNotes}
                    adhocRespondBusy={adhocRespondBusy}
                    onRespondAdhoc={(id, accept) => void onRespondAdhoc(id, accept)}
                  />
                ))}
              </View>
            ) : null}

            {!loadingUpcoming &&
            myPending.length === 0 &&
            adhocPassengerPending.length === 0 &&
            passengerUpcoming.length === 0 &&
            driverUpcoming.length === 0 &&
            adhocPending.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="calendar-outline" size={44} color={Colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>Nothing upcoming yet</Text>
              <Text style={styles.emptyBody}>
                Post a dated trip to offer seats, or search for a ride someone else posted. Commute pickups you
                request also land here once a driver accepts.
              </Text>
              <View style={styles.ctaRow}>
                <TouchableOpacity
                  style={styles.ctaButton}
                  activeOpacity={0.8}
                  onPress={() => router.push("/(tabs)/rides/post-dated-trip")}
                >
                  <Ionicons name="add-circle-outline" size={18} color={Colors.textOnPrimary} />
                  <Text style={styles.ctaText}>Post a dated trip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.ctaButton, styles.ctaButtonSecondary]}
                  activeOpacity={0.8}
                  onPress={() => router.push("/(tabs)/rides/search-seat")}
                >
                  <Ionicons name="search" size={18} color={Colors.primary} />
                  <Text style={styles.ctaTextSecondary}>Search for a seat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.ctaButton, styles.ctaButtonSecondary]}
                  activeOpacity={0.8}
                  onPress={() => router.push("/(tabs)/home?scrollTo=opportunities")}
                >
                  <Ionicons name="navigate-outline" size={18} color={Colors.primary} />
                  <Text style={styles.ctaTextSecondary}>Home: Mingle and network</Text>
                </TouchableOpacity>
              </View>
            </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.panel}>
            {loadingCrewHistory && crewHistory.length === 0 ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xl }} />
            ) : null}
            {crewHistory.map((h) => (
              <CrewTripHistoryCard key={h.id} row={h} />
            ))}
            {!loadingCrewHistory && crewHistory.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="time-outline" size={44} color={Colors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>Ride history</Text>
                <Text style={styles.emptyBody}>
                  Finished Crew Poolyn trips appear here with route and Poolyn Credit breakdown. Start a day from
                  Home → your crew card, then finish and settle from the crew chat when the run is done.
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
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
    paddingBottom: Spacing.sm,
  },
  headerSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: Spacing.xs,
    maxWidth: 420,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  tabBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    alignSelf: "stretch",
    flexGrow: 0,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tab: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
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
  body: { flex: 1 },
  bodyContent: { paddingBottom: Spacing["3xl"] },
  panel: { paddingHorizontal: Spacing.xl },
  panelHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  requestCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  requestName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  requestMeta: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  requestSub: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  detourBlock: {
    marginTop: Spacing.sm,
  },
  detourBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.borderLight,
    overflow: "hidden",
    marginBottom: Spacing.xs,
  },
  detourBarFill: {
    width: "42%",
    height: "100%",
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  detourHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  acceptBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  acceptBtnText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  myRequestsBlock: {
    marginBottom: Spacing.lg,
  },
  sectionEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: Spacing.xs,
  },
  blockTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  blockSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.md,
    marginTop: -4,
  },
  loadingBlock: {
    alignItems: "center",
    paddingVertical: Spacing["2xl"],
    marginBottom: Spacing.md,
  },
  loadingHint: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  summaryStrip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.2)",
  },
  summaryStripText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
    fontWeight: FontWeight.medium,
  },
  dashCard: {
    flexDirection: "row",
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    ...Shadow.md,
  },
  dashAccent: {
    width: 5,
    borderTopLeftRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.lg,
  },
  dashAccentAdhoc: {
    backgroundColor: Colors.primary,
  },
  dashAccentCommute: {
    backgroundColor: Colors.info,
  },
  dashCardBody: {
    flex: 1,
    padding: Spacing.md,
  },
  dashHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  kindBadge: {
    backgroundColor: Colors.borderLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  kindBadgeText: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    letterSpacing: 0.4,
  },
  dashStatus: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  dashStatusActive: {
    color: Colors.success,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.borderLight,
  },
  pillText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  pillMuted: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillTextMuted: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  pillWarn: {
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  pillWarnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.warning,
  },
  dashTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    lineHeight: 22,
  },
  dashMeta: {
    fontSize: FontSize.sm,
    color: Colors.primaryDark,
    fontWeight: FontWeight.semibold,
    marginTop: Spacing.xs,
  },
  dashSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  driverPricingBlock: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  driverPricingTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  driverPricingLine: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
    marginTop: 2,
  },
  driverPricingHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    lineHeight: 16,
  },
  dashDetailLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.25)",
  },
  dashDetailLinkText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
    flex: 1,
  },
  nestedRequests: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  nestedRequestsTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  nestedRequestsHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 17,
  },
  passengerCardWrap: {
    flexDirection: "row",
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  passengerAccent: {
    width: 5,
    backgroundColor: Colors.secondaryLight,
  },
  passengerCardInner: {
    flex: 1,
    padding: Spacing.sm,
  },
  passengerKind: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  miniCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  miniCardText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: FontWeight.medium,
  },
  miniCardSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  expiryHint: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.accent,
    marginTop: Spacing.xs,
  },
  upcomingRideCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  upcomingRideTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  upcomingRideMeta: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  upcomingRideSub: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
    lineHeight: 16,
  },
  rideActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  rideActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rideActionText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
  },
  emptyInline: {
    alignItems: "center",
    paddingVertical: Spacing["2xl"],
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing["2xl"],
    paddingHorizontal: Spacing.lg,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.borderLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  ctaRow: {
    flexDirection: "column",
    gap: Spacing.sm,
    width: "100%",
    maxWidth: 320,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.md,
  },
  ctaButtonSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    ...Shadow.sm,
  },
  ctaText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  ctaTextSecondary: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  adhocHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  adhocBookingCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  passengerPendingCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  adhocPassengerMsg: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontStyle: "italic",
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  cancelAdhocRequestBtn: {
    alignSelf: "flex-start",
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  cancelAdhocRequestText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  cancelConfirmedSeatBtn: {
    alignSelf: "flex-start",
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  cancelConfirmedSeatText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  adhocNoteInput: {
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    minHeight: 44,
    textAlignVertical: "top",
  },
  adhocBtnRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  adhocSecondaryBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    minHeight: 44,
  },
  adhocSecondaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  adhocPrimaryBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    minHeight: 44,
  },
  adhocPrimaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  btnDisabled: { opacity: 0.55 },
});
