import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { showAlert } from "@/lib/platformAlert";
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { haversineKm } from "@/lib/geoDistance";
import { presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import { RideRouteStepsModal } from "@/components/rides/RideRouteStepsModal";
import { useExpiryCountdown } from "@/hooks/useExpiryCountdown";
import { listMyUpcomingRidesAsPassenger, type PassengerUpcomingRide } from "@/lib/passengerRides";
import { listMyUpcomingRidesAsDriver, type DriverUpcomingRide } from "@/lib/driverRides";
import {
  acceptRideRequestAsDriver,
  listMyPendingRideRequests,
  listOpenRideRequestsForDriver,
  runExpireStalePickupRequests,
  type MyPendingRideRequestRow,
  type RideRequestOpenRow,
} from "@/lib/rideRequests";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

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

function ActiveRideCard({
  rideId,
  origin,
  destination,
  title,
  meta,
  sub,
}: {
  rideId: string;
  origin: unknown;
  destination: unknown;
  title: string;
  meta: string;
  sub: string;
}) {
  const router = useRouter();
  const [stepsOpen, setStepsOpen] = useState(false);
  const pickup = parseGeoPoint(origin);

  return (
    <View style={styles.upcomingRideCard}>
      <Text style={styles.upcomingRideTitle}>{title}</Text>
      <Text style={styles.upcomingRideMeta}>{meta}</Text>
      <Text style={styles.upcomingRideSub}>{sub}</Text>
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
        {pickup ? (
          <TouchableOpacity
            style={styles.rideActionBtn}
            activeOpacity={0.8}
            onPress={() => presentDrivingNavigationPicker(pickup.lat, pickup.lng)}
            accessibilityRole="button"
            accessibilityLabel="Turn-by-turn navigation to pickup"
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
        visible={stepsOpen}
        onClose={() => setStepsOpen(false)}
        origin={origin}
        destination={destination}
        title="Full route (pickup to drop-off)"
      />
    </View>
  );
}

export default function MyRides() {
  const router = useRouter();
  const { profile } = useAuth();
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const tabParam = Array.isArray(tab) ? tab[0] : tab;
  const canDrive = profile?.role === "driver" || profile?.role === "both";

  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [openRequests, setOpenRequests] = useState<RideRequestOpenRow[]>([]);
  const [myPending, setMyPending] = useState<MyPendingRideRequestRow[]>([]);
  const [passengerUpcoming, setPassengerUpcoming] = useState<PassengerUpcomingRide[]>([]);
  const [driverUpcoming, setDriverUpcoming] = useState<DriverUpcomingRide[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const isPassengerRole = profile?.role === "passenger" || profile?.role === "both";

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
    if (!profile?.id) {
      setMyPending([]);
      return;
    }
    await runExpireStalePickupRequests();
    const rows = await listMyPendingRideRequests(profile.id);
    setMyPending(rows);
  }, [profile?.id]);

  const loadDriverUpcoming = useCallback(async () => {
    if (!profile?.id || !canDrive) {
      setDriverUpcoming([]);
      return;
    }
    setDriverUpcoming(await listMyUpcomingRidesAsDriver(profile.id));
  }, [profile?.id, canDrive]);

  const loadPassengerUpcoming = useCallback(async () => {
    if (!profile?.id || !isPassengerRole) {
      setPassengerUpcoming([]);
      return;
    }
    setPassengerUpcoming(await listMyUpcomingRidesAsPassenger(profile.id));
  }, [profile?.id, isPassengerRole]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadOpenRequests(),
      loadMyPending(),
      loadPassengerUpcoming(),
      loadDriverUpcoming(),
    ]);
    setRefreshing(false);
  }, [loadOpenRequests, loadMyPending, loadPassengerUpcoming, loadDriverUpcoming]);

  useEffect(() => {
    void loadOpenRequests();
    void loadMyPending();
    void loadPassengerUpcoming();
    void loadDriverUpcoming();
  }, [loadOpenRequests, loadMyPending, loadPassengerUpcoming, loadDriverUpcoming]);

  const tabs = useMemo(() => {
    const base: { key: TabKey; label: string }[] = [
      { key: "upcoming", label: "Active" },
      ...(canDrive ? [{ key: "open_requests" as const, label: "Respond" }] : []),
      { key: "past", label: "History" },
    ];
    return base;
  }, [canDrive]);

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
      showAlert("Could not accept", res.reason);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Rides</Text>
        <Text style={styles.headerSub}>
          New pickup requests alert drivers on their phone first. Use this screen for history and backup
          actions.
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
              Same-org requests only. You need an active vehicle with more than one seat. Prefer accepting from
              the push alert you already received.
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
                        Pickup ≈ {pickupKm} km from your home (straight line). Full detour depends on your route —
                        Maps after accept shows the real path.
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

            {passengerUpcoming.length > 0 ? (
              <View style={styles.myRequestsBlock}>
                <Text style={styles.blockTitle}>Your upcoming rides</Text>
                {passengerUpcoming.map((ride) => (
                  <ActiveRideCard
                    key={ride.rideId}
                    rideId={ride.rideId}
                    origin={ride.origin}
                    destination={ride.destination}
                    title={`${ride.driverName?.trim() || "Driver"} · ${
                      ride.direction === "from_work" ? "From work" : "To work"
                    }`}
                    meta={formatDepart(ride.departAt)}
                    sub="Pickup is highlighted on your Home map."
                  />
                ))}
              </View>
            ) : null}

            {canDrive && driverUpcoming.length > 0 ? (
              <View style={styles.myRequestsBlock}>
                <Text style={styles.blockTitle}>Your upcoming drives</Text>
                {driverUpcoming.map((ride) => (
                  <ActiveRideCard
                    key={ride.rideId}
                    rideId={ride.rideId}
                    origin={ride.origin}
                    destination={ride.destination}
                    title={`You are driving · ${
                      ride.direction === "from_work" ? "From work" : "To work"
                    }`}
                    meta={formatDepart(ride.departAt)}
                    sub="Navigate to pickup, message your passengers, or preview the full route as steps."
                  />
                ))}
              </View>
            ) : null}

            {myPending.length === 0 && passengerUpcoming.length === 0 && !(canDrive && driverUpcoming.length > 0) ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="calendar-outline" size={44} color={Colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>Your next ride appears here</Text>
              <Text style={styles.emptyBody}>
                Post a pickup request from Home, accept one under Open requests if you drive, or reserve a seat from
                Discover.
              </Text>
              <View style={styles.ctaRow}>
                <TouchableOpacity
                  style={[styles.ctaButton, styles.ctaButtonSecondary]}
                  activeOpacity={0.8}
                  onPress={() => router.push("/(tabs)/home?scrollTo=opportunities")}
                >
                  <Ionicons name="search" size={18} color={Colors.primary} />
                  <Text style={styles.ctaTextSecondary}>Find rides on Discover</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ctaButton}
                  activeOpacity={0.8}
                  onPress={() => router.push("/(tabs)/home")}
                >
                  <Ionicons name="home-outline" size={18} color={Colors.textOnPrimary} />
                  <Text style={styles.ctaText}>Back to Home</Text>
                </TouchableOpacity>
              </View>
            </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.panel}>
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="time-outline" size={44} color={Colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>Ride history</Text>
              <Text style={styles.emptyBody}>Completed rides unlock reliability insights and badges.</Text>
            </View>
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
  blockTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
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
});
