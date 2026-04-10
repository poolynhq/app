import { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  Image,
  Modal,
  Pressable,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
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
  DiscoverMapLegend,
  type DiscoverMapLegendLens,
} from "@/components/maps/DiscoverMapLegend";
import { Organisation } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
  RoleTheme,
} from "@/constants/theme";
import { viewerMyRoutesDisplayCollection } from "@/lib/viewerRoutePrimarySwap";
import { createCommuteRideRequest, cancelMyPendingRideRequest } from "@/lib/rideRequests";
import {
  incrementRouteConfirmationCount,
  needsRouteDestinationDoubleCheck,
  ROUTE_CONFIRMATION_THRESHOLD,
} from "@/lib/routeTripConfirmation";
import { PoolynMiniTourModal, POOLYN_MINI_TOUR_DONE_KEY } from "@/components/home/PoolynMiniTourModal";
import { usePassengerPickupState } from "@/hooks/usePassengerPickupState";
import { useExpiryCountdown } from "@/hooks/useExpiryCountdown";
import { fetchDrivingRoute } from "@/lib/mapboxDirections";
import { HomeNetworkHub } from "@/components/home/HomeNetworkHub";
import { RoutinePoolynCrewMingleBlock } from "@/components/home/RoutinePoolynCrewMingle";
import { CommuteRouteChoicePanel } from "@/components/home/CommuteRouteChoicePanel";
import { RoutePeopleSearchModal } from "@/components/home/RoutePeopleSearchModal";
import { formatPoolynCreditsBalance } from "@/lib/poolynCreditsUi";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** e.g. Mon, 24-May */
function formatHomeDateLine(d = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${d.getDate()}-${mon[d.getMonth()]}`;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Scout Basic",
  starter: "Momentum Growth",
  business: "Pulse Business",
  enterprise: "Orbit Enterprise",
};

function ProfileCompletion({
  profile,
  onEditProfile,
}: {
  profile: any;
  onEditProfile: () => void;
}) {
  const checks = [
    { done: !!profile?.full_name, label: "Name added" },
    { done: !!profile?.phone_number, label: "Phone number" },
    { done: !!profile?.avatar_url, label: "Profile photo" },
    {
      done: !!(profile?.home_location && profile?.work_location),
      label: "Home & work commute",
    },
    {
      done:
        profile?.role === "passenger" || !!profile?.licence_number,
      label: "Licence verified",
    },
  ];
  const completed = checks.filter((c) => c.done).length;
  const pct = Math.round((completed / checks.length) * 100);
  const incomplete = checks.filter((c) => !c.done);

  if (pct === 100) return null;

  return (
    <View style={pStyles.card}>
      <View style={pStyles.header}>
        <Text style={pStyles.title}>Complete your profile</Text>
        <Text style={pStyles.pct}>{pct}%</Text>
      </View>
      <View style={pStyles.bar}>
        <View style={[pStyles.barFill, { width: `${pct}%` }]} />
      </View>
      {incomplete.slice(0, 2).map((item, i) => (
        <View key={i} style={pStyles.item}>
          <Ionicons
            name="ellipse-outline"
            size={16}
            color={Colors.textTertiary}
          />
          <Text style={pStyles.itemText}>{item.label}</Text>
        </View>
      ))}
      {incomplete.length > 2 && (
        <Text style={pStyles.more}>
          +{incomplete.length - 2} more in Profile
        </Text>
      )}
      <TouchableOpacity style={pStyles.editShortcut} onPress={onEditProfile} activeOpacity={0.8}>
        <Ionicons name="create-outline" size={18} color={Colors.primary} />
        <Text style={pStyles.editShortcutText}>Update in Edit profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const pStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  pct: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  bar: {
    height: 6,
    backgroundColor: Colors.borderLight,
    borderRadius: 3,
    marginBottom: Spacing.md,
  },
  barFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  itemText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  more: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: FontWeight.medium,
    marginTop: Spacing.xs,
  },
  editShortcut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  editShortcutText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
});

const ROUTINE_ACCENT = "#0D9488";
const ADHOC_ACCENT = "#D97706";

function PillarSection({
  variant,
  eyebrow,
  title,
  subtitle,
  belowTitle,
  children,
}: {
  variant: "routine" | "adhoc";
  eyebrow: string;
  title: string;
  /** Omit or empty to save vertical space. */
  subtitle?: string | null;
  /** Rendered directly under the title (e.g. commute route preview). */
  belowTitle?: ReactNode;
  children: ReactNode;
}) {
  const accent = variant === "routine" ? ROUTINE_ACCENT : ADHOC_ACCENT;
  const sub = subtitle?.trim();
  return (
    <View
      style={[styles.pillarShell, variant === "routine" ? styles.pillarShellRoutine : styles.pillarShellAdhoc]}
    >
      <View style={[styles.pillarAccentBar, { backgroundColor: accent }]} />
      <View style={styles.pillarContent}>
        <Text style={[styles.pillarEyebrow, { color: accent }]}>{eyebrow}</Text>
        <Text style={styles.pillarTitle}>{title}</Text>
        {belowTitle ? <View style={styles.pillarBelowTitle}>{belowTitle}</View> : null}
        {sub ? <Text style={styles.pillarSubtitle}>{sub}</Text> : null}
        <View style={styles.pillarChildren}>{children}</View>
      </View>
    </View>
  );
}

type PostPickupTiming = "now" | 15 | 30 | 45 | 60;

export default function Dashboard() {
  const router = useRouter();
  const { scrollTo: scrollToParam } = useLocalSearchParams<{ scrollTo?: string | string[] }>();
  const scrollToParamNorm = Array.isArray(scrollToParam) ? scrollToParam[0] : scrollToParam;
  const homeScrollRef = useRef<ScrollView>(null);
  const networkHubBlockY = useRef(0);
  const seatsSectionInnerY = useRef(0);
  const scrollToSeatsOnHome = useCallback(() => {
    const y = networkHubBlockY.current + seatsSectionInnerY.current - 24;
    homeScrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
  }, []);
  const { profile, refreshProfile, activeMode, toggleMode, rolePalette } = useAuth();
  const [viewerMapRefetchTick, setViewerMapRefetchTick] = useState(0);
  const [promotedViewerRouteKey, setPromotedViewerRouteKey] = useState<string | null>(null);
  const [postRequestOpen, setPostRequestOpen] = useState(false);
  const [postRequestSubmitting, setPostRequestSubmitting] = useState(false);
  const [postRequestDirection, setPostRequestDirection] = useState<"to_work" | "from_work">("to_work");
  const [postRequestTiming, setPostRequestTiming] = useState<PostPickupTiming>("now");
  const routineSectionYRef = useRef(0);
  const [miniTourVisible, setMiniTourVisible] = useState(false);
  const [commuteRouteReady, setCommuteRouteReady] = useState(false);
  const [routePeopleModalOpen, setRoutePeopleModalOpen] = useState(false);

  const {
    demandPoints,
    supplyPoints,
    routeLines,
    reload: reloadMapLayers,
    loading: homeMapLayersLoading,
  } = useDiscoverMapLayers(profile ?? null);

  const {
    viewerPinsGeoJson,
    viewerMyRoutesGeoJson,
    routeCorridors,
    routesLoading,
  } = useDiscoverViewerLayers(profile ?? null, viewerMapRefetchTick);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await refreshProfile();
        reloadMapLayers();
        setViewerMapRefetchTick((t) => t + 1);
      })();
    }, [refreshProfile, reloadMapLayers])
  );
  const [org, setOrg] = useState<Organisation | null>(null);
  const [orgMemberCount, setOrgMemberCount] = useState(0);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const isFlexible = profile?.role === "both";
  const effectiveRole = isFlexible ? (activeMode ?? "both") : (profile?.role ?? "both");
  const showQuickActions = !isFlexible || activeMode != null;
  const quickDriver = isFlexible ? activeMode === "driver" : profile?.role === "driver";
  const quickPassenger = isFlexible ? activeMode === "passenger" : profile?.role === "passenger";
  const showPostRequest = quickPassenger;

  const passengerPickupEnabled =
    !!profile?.id &&
    (profile.role === "passenger" || profile.role === "both" || showPostRequest);
  const pickupState = usePassengerPickupState(profile?.id ?? null, passengerPickupEnabled);
  const pendingExpiryLabel = useExpiryCountdown(pickupState.pending?.expires_at);
  const [rideTripHint, setRideTripHint] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (passengerPickupEnabled && profile?.id) void pickupState.reload();
    }, [passengerPickupEnabled, profile?.id, pickupState.reload])
  );

  useEffect(() => {
    const r = pickupState.upcomingRides[0];
    if (!r) {
      setRideTripHint(null);
      return;
    }
    const o = parseGeoPoint(r.origin);
    const d = parseGeoPoint(r.destination);
    if (!o || !d) {
      setRideTripHint(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetchDrivingRoute([
        [o.lng, o.lat],
        [d.lng, d.lat],
      ]);
      if (cancelled) return;
      if (res.ok) {
        const mins = Math.max(1, Math.round(res.route.durationS / 60));
        setRideTripHint(`~${mins} min trip (traffic-aware est.)`);
      } else {
        setRideTripHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickupState.upcomingRides]);

  const roleBadgeLabel =
    isFlexible
      ? activeMode === "driver"
        ? "Driving today"
        : activeMode === "passenger"
        ? "Riding today"
        : "Flexible"
      : profile?.role === "driver"
      ? "Driver"
      : profile?.role === "passenger"
      ? "Passenger"
      : "Flexible";

  async function handleShareWithLeadership() {
    try {
      await Share.share({
        title: "Poolyn Corporate Carpooling",
        message:
          "Hey! I've been using Poolyn for corporate carpooling. Check it out. Your company can sponsor a business account for the whole team: https://poolyn.app",
      });
    } catch {
      // ignore
    }
  }

  const homeMapFallbackCenter = useMemo((): [number, number] => {
    if (!profile) return [138.6, -34.85];
    const home = parseGeoPoint(profile.home_location as unknown);
    if (home) return [home.lng, home.lat];
    const work = parseGeoPoint(profile.work_location as unknown);
    if (work) return [work.lng, work.lat];
    return [138.6, -34.85];
  }, [profile]);

  const homeMapLayerEmphasis = useMemo(
    () => mapLayerEmphasisForProfile(profile ?? null, activeMode ?? null),
    [profile, activeMode]
  );

  const homeMapDemandPoints = useMemo(
    () => filterPointsToViewerCorridors(demandPoints, routeCorridors),
    [demandPoints, routeCorridors]
  );
  const homeMapSupplyPoints = useMemo(
    () => filterPointsToViewerCorridors(supplyPoints, routeCorridors),
    [supplyPoints, routeCorridors]
  );
  const homeMapRouteLines = useMemo(
    () => filterRouteLinesToViewerCorridors(routeLines, routeCorridors),
    [routeLines, routeCorridors]
  );

  const homeRouteCorridorDemandLine = useMemo(() => {
    if (homeMapLayerEmphasis !== "demand" || routeCorridors.length === 0) return "";
    const r = countPickupDemandByCorridorDisjoint(homeMapDemandPoints, routeCorridors);
    return formatDisjointCorridorPickupSummary(r);
  }, [homeMapLayerEmphasis, homeMapDemandPoints, routeCorridors]);

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

  const homeViewerRoutesDisplayed = useMemo(
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

  const homeMapLegendLens = useMemo((): DiscoverMapLegendLens => {
    if (!profile) return "overview";
    if (isFlexible && activeMode === null) return "flex_none";
    if (quickPassenger && !quickDriver) return "passenger";
    if (quickDriver && !quickPassenger) return "driver";
    if (profile.role === "passenger") return "passenger";
    if (profile.role === "driver") return "driver";
    return "overview";
  }, [profile, isFlexible, activeMode, quickPassenger, quickDriver]);

  useEffect(() => {
    async function loadOrgContext() {
      if (!profile?.org_id) {
        setOrg(null);
        setOrgMemberCount(0);
        return;
      }

      const [orgRes, memberRes] = await Promise.all([
        supabase.from("organisations").select("*").eq("id", profile.org_id).single(),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("org_id", profile.org_id),
      ]);
      setOrg(orgRes.data ?? null);
      setOrgMemberCount(memberRes.count ?? 0);
    }

    loadOrgContext();
  }, [profile?.org_id]);

  const hasOrg = !!profile?.org_id && !!org;
  const isEnterpriseOrg = org?.org_type === "enterprise";
  const isCommunityOrg = hasOrg && !isEnterpriseOrg;

  const heroGradientColors = useMemo((): [string, string, string] => {
    if (isEnterpriseOrg) return ["#DCFCE7", "#ECFDF5", "#FFFFFF"];
    if (isCommunityOrg) return ["#DBEAFE", "#F0F9FF", "#FFFFFF"];
    if (!hasOrg) return ["#FFEDD5", "#FFFBF0", "#FFFFFF"];
    return ["#F1F5F9", "#F8FAFC", "#FFFFFF"];
  }, [hasOrg, isEnterpriseOrg, isCommunityOrg]);

  const [poolynProgram, setPoolynProgram] = useState<"routine" | "adhoc">("routine");
  const orgAllowsOpenLane = org?.allow_cross_org === true;

  let orgLogoPublicUrl: string | null = null;
  if (
    org?.settings &&
    typeof org.settings === "object" &&
    !Array.isArray(org.settings)
  ) {
    const lp = String((org.settings as { logo_path?: string }).logo_path ?? "").trim();
    if (lp) {
      orgLogoPublicUrl =
        supabase.storage.from("org-logos").getPublicUrl(lp).data.publicUrl ?? null;
    }
  }

  function showExplorerInfo() {
    showAlert(
      "Independent commuter",
      "You are not in a workplace network yet. You can mingle with other independents and any commuter along your corridor.\n\nWhen an organisation on your email domain is set up, they can add you or send an invite code."
    );
  }

  function showWorkplaceInfo() {
    if (!org) return;
    const plan = PLAN_LABELS[org.plan ?? "free"] ?? org.plan;
    const lines = [
      org.name,
      org.domain ? `Domain: ${org.domain}` : null,
      `Plan: ${plan}`,
      orgMemberCount > 0 ? `About ${orgMemberCount} members in this network` : null,
      "",
      "Workplace network member. Discover starts with your org; switch scope to include wider pools when you want.",
    ].filter(Boolean);
    showAlert("Your workplace", lines.join("\n"));
  }

  function showCommunityNetworkInfo() {
    if (!org) return;
    const lines = [
      org.name,
      org.domain ? `Domain: ${org.domain}` : null,
      orgMemberCount > 0 ? `${orgMemberCount} colleagues on Poolyn` : null,
      "",
      "Community network: you share a pool with others on your work email domain. Discover starts with your network; you can widen scope to any commuter when you want.",
    ].filter(Boolean);
    showAlert("Your network", lines.join("\n"));
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

  const runPostPickupRequest = useCallback(async () => {
    setPostRequestSubmitting(true);
    const isNow = postRequestTiming === "now";
    const res = await createCommuteRideRequest({
      direction: postRequestDirection,
      leaveInMins: isNow ? null : postRequestTiming,
      flexibilityMins: isNow ? 10 : 15,
    });
    setPostRequestSubmitting(false);
    if (res.ok) {
      await incrementRouteConfirmationCount(postRequestDirection);
      void pickupState.reload();
      showAlert(
        "Request sent",
        isNow
          ? "Nearby drivers with seats are being notified now. Watch for a banner or sound on their phone."
          : "Drivers get advance notice so they can plan. You will see confirmation when someone accepts."
      );
      setPostRequestOpen(false);
      setViewerMapRefetchTick((t) => t + 1);
      void reloadMapLayers();
    } else {
      showAlert("Could not post", res.reason);
    }
  }, [postRequestTiming, postRequestDirection, pickupState, reloadMapLayers]);

  function handlePostPickupPress() {
    void (async () => {
      const needConfirm = await needsRouteDestinationDoubleCheck(postRequestDirection);
      const dirLabel = postRequestDirection === "to_work" ? "to work" : "from work";
      if (needConfirm) {
        showAlert(
          `Confirm your ${dirLabel} trip`,
          `For your first ${ROUTE_CONFIRMATION_THRESHOLD} pickup posts in each direction, double-check saved home and work so drivers are routed correctly.`,
          [
            {
              text: "Edit commute",
              style: "cancel",
              onPress: () => {
                setPostRequestOpen(false);
                router.push("/(tabs)/profile/commute-locations");
              },
            },
            { text: "Destination OK — post", onPress: () => void runPostPickupRequest() },
          ]
        );
        return;
      }
      await runPostPickupRequest();
    })();
  }

  useEffect(() => {
    if (!profile?.onboarding_completed) return;
    let cancelled = false;
    void AsyncStorage.getItem(POOLYN_MINI_TOUR_DONE_KEY).then((v) => {
      if (!cancelled && !v) setMiniTourVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.onboarding_completed]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        ref={homeScrollRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — gradient band by explorer / workplace type */}
        <LinearGradient
          colors={heroGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.heroHeader,
            !hasOrg && styles.heroExplorer,
            isEnterpriseOrg && styles.heroEnterprise,
            isCommunityOrg && styles.heroCommunity,
          ]}
        >
          <View style={styles.heroTopBand}>
            <TouchableOpacity
              style={styles.heroAvatarBtn}
              activeOpacity={0.82}
              onPress={() => router.push("/(tabs)/profile")}
              accessibilityRole="button"
              accessibilityLabel="Profile"
              accessibilityHint="Opens your profile and settings"
            >
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.heroAvatarImg} />
              ) : (
                <View style={styles.heroAvatarPlaceholder}>
                  <Ionicons name="person" size={24} color={Colors.textSecondary} />
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.heroTextBlock}>
              <View style={styles.heroGreetRow}>
                <Text
                  style={[
                    styles.heroGreetingCaps,
                    !hasOrg && styles.heroGreetingExplorer,
                    isEnterpriseOrg && styles.heroGreetingEnterprise,
                    isCommunityOrg && styles.heroGreetingCommunity,
                  ]}
                >
                  {getGreeting().toUpperCase()}
                </Text>
                <View style={styles.heroDateCreditsCol}>
                  <Text
                    style={[
                      styles.heroDateLine,
                      !hasOrg && styles.heroDateLineExplorer,
                      isEnterpriseOrg && styles.heroDateLineEnterprise,
                      isCommunityOrg && styles.heroDateLineCommunity,
                    ]}
                  >
                    {formatHomeDateLine()}
                  </Text>
                  <TouchableOpacity
                    style={styles.heroCreditsTouch}
                    onPress={() => router.push("/(tabs)/profile/poolyn-credits")}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel="Poolyn Credits"
                  >
                    <Ionicons name="sparkles" size={14} color={Colors.accent} />
                    <Text style={styles.heroCreditsText}>
                      {formatPoolynCreditsBalance(profile?.commute_credits_balance ?? 0)}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text
                style={[
                  styles.heroNameDisplay,
                  !hasOrg && styles.heroNameExplorer,
                  isEnterpriseOrg && styles.heroNameEnterprise,
                  isCommunityOrg && styles.heroNameCommunity,
                ]}
              >
                {firstName}
              </Text>
              {!hasOrg ? (
                <Text style={styles.heroOrgLineExplorer} numberOfLines={1}>
                  Independent explorer
                </Text>
              ) : isEnterpriseOrg ? (
                <View style={styles.heroOrgLineRow}>
                  <Text style={styles.heroOrgLineNameEnt} numberOfLines={1}>
                    {org!.name}
                  </Text>
                  <Text style={styles.heroOrgLineKindEnt} numberOfLines={1}>
                    {" "}
                    · Workplace
                  </Text>
                </View>
              ) : (
                <View style={styles.heroOrgLineRow}>
                  <Text style={styles.heroOrgLineNameCom} numberOfLines={1}>
                    {org!.name}
                  </Text>
                  <Text style={styles.heroOrgLineKindCom} numberOfLines={1}>
                    {" "}
                    · Community
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.heroRightActions}>
              <TouchableOpacity
                style={styles.heroIconBtn}
                activeOpacity={0.75}
                onPress={() => router.push("/(tabs)/profile/activity")}
                accessibilityRole="button"
                accessibilityLabel="Activity and messages"
              >
                <Ionicons name="notifications-outline" size={21} color={Colors.text} />
              </TouchableOpacity>
              {!hasOrg ? (
                <Pressable
                  style={({ pressed }) => [styles.heroLogoPressable, pressed && styles.heroLogoPressablePressed]}
                  onPress={showExplorerInfo}
                  accessibilityRole="button"
                  accessibilityLabel="About independent commuting"
                >
                  <View style={styles.heroBadgeIconWrap}>
                    <Ionicons name="compass-outline" size={20} color="#C2410C" />
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.heroLogoPressable, pressed && styles.heroLogoPressablePressed]}
                  onPress={isEnterpriseOrg ? showWorkplaceInfo : showCommunityNetworkInfo}
                  accessibilityRole="button"
                  accessibilityLabel={isEnterpriseOrg ? "Workplace details" : "Network details"}
                >
                  <View style={styles.heroOrgLogoWrap}>
                    {orgLogoPublicUrl ? (
                      <Image source={{ uri: orgLogoPublicUrl }} style={styles.heroOrgLogo} />
                    ) : isEnterpriseOrg ? (
                      <View style={styles.heroOrgLogoPlaceholder}>
                        <Ionicons name="business" size={22} color={Colors.primaryDark} />
                      </View>
                    ) : (
                      <View style={[styles.heroOrgLogoPlaceholder, styles.heroOrgLogoPlaceholderCommunity]}>
                        <Ionicons name="people-outline" size={22} color={Colors.info} />
                      </View>
                    )}
                  </View>
                </Pressable>
              )}
            </View>
          </View>
        </LinearGradient>

        {passengerPickupEnabled &&
        (pickupState.pending || pickupState.upcomingRides.length > 0) ? (
          <View style={styles.pickupBanner}>
            {pickupState.pending ? (
              <>
                <View style={styles.pickupBannerRow}>
                  <Ionicons name="radio-outline" size={22} color={Colors.primaryDark} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.pickupBannerTitle}>Pickup request active</Text>
                    <Text style={styles.pickupBannerBody}>
                      Notifying drivers on their phones. You can leave this screen open — we will update when
                      someone accepts.
                    </Text>
                    <Text style={styles.pickupBannerMeta}>
                      {pickupState.pending.direction === "from_work" ? "From work" : "To work"} ·{" "}
                      {new Date(pickupState.pending.desired_depart_at).toLocaleString(undefined, {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    {pendingExpiryLabel ? (
                      <Text style={styles.pickupBannerCountdown}>
                        Auto-cancels in {pendingExpiryLabel} if no one accepts — then you can post again.
                      </Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.pickupCancelBtn}
                  onPress={() => {
                    if (!profile?.id) return;
                    showAlert("Cancel request?", "Drivers will stop seeing this pickup need.", [
                      { text: "Keep waiting", style: "cancel" },
                      {
                        text: "Cancel request",
                        style: "destructive",
                        onPress: async () => {
                          const res = await cancelMyPendingRideRequest(profile.id);
                          if (res.ok) void pickupState.reload();
                          else showAlert("Could not cancel", res.reason);
                        },
                      },
                    ]);
                  }}
                >
                  <Text style={styles.pickupCancelBtnText}>Cancel request</Text>
                </TouchableOpacity>
              </>
            ) : pickupState.upcomingRides[0] ? (
              <View style={styles.pickupBannerRow}>
                <Ionicons name="checkmark-circle" size={22} color={Colors.primaryDark} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pickupBannerTitle}>You are booked</Text>
                  <Text style={styles.pickupBannerBody}>
                    {pickupState.upcomingRides[0].driverName?.trim() || "Your driver"} accepted your pickup.
                    {rideTripHint ? ` ${rideTripHint}.` : " Open My Rides → Active for full details."}
                  </Text>
                  <Text style={styles.pickupBannerMeta}>
                    {pickupState.upcomingRides[0].direction === "from_work" ? "From work" : "To work"} ·{" "}
                    {new Date(pickupState.upcomingRides[0].departAt).toLocaleString(undefined, {
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  <TouchableOpacity
                    style={styles.pickupRidesLink}
                    onPress={() => router.push("/(tabs)/rides")}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.pickupRidesLinkText}>Open My Rides</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {profile?.onboarding_completed && profile.home_location && profile.work_location ? (
          <TouchableOpacity
            style={styles.searchRouteHeroBtn}
            activeOpacity={0.88}
            onPress={() => setRoutePeopleModalOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="People along your route"
          >
            <Ionicons name="people-outline" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.searchRouteHeroBtnText}>Who’s on my route?</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.textOnPrimary} />
          </TouchableOpacity>
        ) : null}

        {profile ? (
          <View style={styles.poolynProgramToggleWrap}>
            <Text style={styles.poolynProgramEyebrow}>YOUR POOLYN</Text>
            <Text style={styles.poolynProgramHint}>
              Regular commute uses your saved home–work line. Ad-hoc is for dated, one-off trips.
            </Text>
            <View style={styles.poolynProgramSegments}>
              <Pressable
                style={[
                  styles.poolynProgramSeg,
                  poolynProgram === "routine" && styles.poolynProgramSegOnRoutine,
                ]}
                onPress={() => setPoolynProgram("routine")}
                accessibilityRole="button"
                accessibilityState={{ selected: poolynProgram === "routine" }}
                accessibilityLabel="Regular commute Poolyn"
              >
                <Ionicons
                  name="repeat"
                  size={20}
                  color={poolynProgram === "routine" ? "#FFFFFF" : ROUTINE_ACCENT}
                />
                <Text
                  style={[
                    styles.poolynProgramSegText,
                    poolynProgram === "routine" && styles.poolynProgramSegTextOn,
                  ]}
                >
                  Regular commute
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.poolynProgramSeg,
                  poolynProgram === "adhoc" && styles.poolynProgramSegOnAdhoc,
                ]}
                onPress={() => setPoolynProgram("adhoc")}
                accessibilityRole="button"
                accessibilityState={{ selected: poolynProgram === "adhoc" }}
                accessibilityLabel="Ad-hoc Poolyn"
              >
                <Ionicons
                  name="calendar-outline"
                  size={20}
                  color={poolynProgram === "adhoc" ? "#FFFFFF" : ADHOC_ACCENT}
                />
                <Text
                  style={[
                    styles.poolynProgramSegText,
                    poolynProgram === "adhoc" && styles.poolynProgramSegTextOn,
                  ]}
                >
                  Ad-hoc trips
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* ── Regular commute: route card + corridor pillar ── */}
        {poolynProgram === "routine" ? (
        <View
          onLayout={(e) => {
            routineSectionYRef.current = e.nativeEvent.layout.y;
          }}
        >
          {profile != null && profile.id ? (
            <View style={styles.commuteRouteOuterCard}>
              <Text style={styles.commuteRouteOuterEyebrow}>ROUTINE POOLYN</Text>
              <Text style={styles.commuteRouteOuterTitle}>Your regular commute</Text>
              <CommuteRouteChoicePanel
                omitOuterCard
                userId={profile.id}
                profile={{
                  home_location: profile.home_location,
                  work_location: profile.work_location,
                }}
                onRouteReadyChange={setCommuteRouteReady}
                onEditCommutePins={() => router.push("/(tabs)/profile/commute-locations")}
              />
            </View>
          ) : null}

        <PillarSection
          variant="routine"
          eyebrow="ON YOUR CORRIDOR"
          title="Crew, mingle, and map"
          subtitle={null}
        >
          {profile?.id ? (
            <RoutinePoolynCrewMingleBlock
              profile={profile}
              orgId={profile.org_id}
              visibilityMode={profile.visibility_mode}
              setVisibilityMode={setVisibilityMode}
              commuteRouteReady={commuteRouteReady}
              onCrewCreated={() => {
                reloadMapLayers();
                setViewerMapRefetchTick((t) => t + 1);
                void refreshProfile();
              }}
            />
          ) : null}
          <View style={styles.roleWrap}>
            <View
              style={[
                styles.roleBadge,
                { backgroundColor: rolePalette.light, borderColor: rolePalette.border },
              ]}
            >
              <Ionicons name={rolePalette.icon} size={16} color={rolePalette.primary} />
              <Text style={[styles.roleBadgeText, { color: rolePalette.text }]}>
                {roleBadgeLabel}
              </Text>
            </View>
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
                  Any commuter
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {isFlexible && (
            <View
              style={[
                styles.modeToggleCard,
                { borderColor: rolePalette.border, backgroundColor: rolePalette.light },
              ]}
            >
              <View style={styles.modeToggleHeader}>
                <Ionicons name="swap-horizontal" size={18} color={rolePalette.primary} />
                <Text style={[styles.modeToggleTitle, { color: rolePalette.text }]}>
                  Today I&apos;m…
                </Text>
              </View>
              <View style={styles.modeToggleRow}>
                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor:
                        activeMode === "driver" ? RoleTheme.driver.primary : Colors.surface,
                      borderColor:
                        activeMode === "driver" ? RoleTheme.driver.primary : Colors.border,
                    },
                  ]}
                  onPress={() => toggleMode("driver")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="car-sport-outline"
                    size={18}
                    color={activeMode === "driver" ? "#FFFFFF" : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: activeMode === "driver" ? "#FFFFFF" : Colors.textSecondary },
                    ]}
                  >
                    Driving
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor:
                        activeMode === "passenger"
                          ? RoleTheme.passenger.primary
                          : Colors.surface,
                      borderColor:
                        activeMode === "passenger"
                          ? RoleTheme.passenger.primary
                          : Colors.border,
                    },
                  ]}
                  onPress={() => toggleMode("passenger")}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="people-outline"
                    size={18}
                    color={activeMode === "passenger" ? "#FFFFFF" : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: activeMode === "passenger" ? "#FFFFFF" : Colors.textSecondary },
                    ]}
                  >
                    Riding
                  </Text>
                </TouchableOpacity>
              </View>
              {!activeMode && (
                <Text style={styles.modeNeutralHint}>
                  Choose driving or riding so matches and the map align with what you&apos;re doing.
                </Text>
              )}
            </View>
          )}

          {showQuickActions && (
            <>
              <Text style={styles.pillarInlineLabel}>Quick actions</Text>
              <View style={styles.quickActions}>
                {quickDriver && (
                  <TouchableOpacity
                    style={styles.actionCard}
                    activeOpacity={0.72}
                    onPress={() => router.push("/(tabs)/rides")}
                  >
                    <View style={styles.actionTitleRow}>
                      <View style={[styles.actionIcon, { backgroundColor: Colors.primaryLight }]}>
                        <Ionicons name="add-circle" size={24} color={Colors.primary} />
                      </View>
                      <Text style={styles.actionTitle}>Offer a ride</Text>
                    </View>
                    <Text style={styles.actionDesc}>
                      Post your trip in My Rides with time and seats — you show up on the map and in seats others
                      can book below.
                    </Text>
                  </TouchableOpacity>
                )}
                {quickPassenger && (
                  <TouchableOpacity
                    style={styles.actionCard}
                    activeOpacity={0.72}
                    onPress={scrollToSeatsOnHome}
                  >
                    <View style={styles.actionTitleRow}>
                      <View style={[styles.actionIcon, { backgroundColor: "#EFF6FF" }]}>
                        <Ionicons name="search" size={24} color={Colors.info} />
                      </View>
                      <Text style={styles.actionTitle}>Find a ride</Text>
                    </View>
                    <Text style={styles.actionDesc}>
                      Browse posted trips with free seats and reserve one — for when a driver already shared a ride
                      and you do not need a new pickup request.
                    </Text>
                  </TouchableOpacity>
                )}
                {showPostRequest && (
                  <TouchableOpacity
                    style={styles.actionCard}
                    activeOpacity={0.72}
                    onPress={() => setPostRequestOpen(true)}
                  >
                    <View style={styles.actionTitleRow}>
                      <View style={[styles.actionIcon, { backgroundColor: "#FFFBEB" }]}>
                        <Ionicons name="megaphone-outline" size={24} color="#D97706" />
                      </View>
                      <Text style={styles.actionTitle}>Post a request</Text>
                    </View>
                    <Text style={styles.actionDesc}>
                      No posted trip fits? Ping drivers on your corridor — not the same as booking an existing seat.
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          <Text style={styles.pillarInlineLabel}>Live map</Text>
          {profile ? (
            <DiscoverMapLegend
              lens={homeMapLegendLens}
              corridorBandFilter={routeCorridors.length > 0}
              scopeNetwork={profile.visibility_mode !== "nearby"}
              compact
            />
          ) : null}
          {homeRouteCorridorDemandLine ? (
            <Text style={styles.mapCorridorHint}>{homeRouteCorridorDemandLine}</Text>
          ) : null}
          <DiscoverMapLayers
            demandGeoJson={homeMapDemandPoints}
            supplyGeoJson={homeMapSupplyPoints}
            routeGeoJson={homeMapRouteLines}
            viewerPinsGeoJson={viewerPinsGeoJson}
            viewerMyRoutesGeoJson={homeViewerRoutesDisplayed}
            layerEmphasis={homeMapLayerEmphasis}
            title="Corridor map"
            mapHeight={220}
            fallbackCenter={homeMapFallbackCenter}
            remoteLoading={homeMapLayersLoading || routesLoading}
            onViewerRouteAlternateTap={
              hasViewerRouteAlternates ? (key) => setPromotedViewerRouteKey(key) : undefined
            }
          />
        </PillarSection>
        </View>
        ) : (
        <PillarSection
          variant="adhoc"
          eyebrow="AD-HOC POOLYN"
          title="One-off & planned trips"
          subtitle="Dated trips live in My Rides for now. Richer search is on the way."
        >
          <TouchableOpacity
            style={styles.adhocRow}
            onPress={() => router.push("/(tabs)/rides")}
            activeOpacity={0.75}
          >
            <View style={[styles.adhocIconWrap, { backgroundColor: "#FEF3C7" }]}>
              <Ionicons name="calendar-outline" size={22} color={ADHOC_ACCENT} />
            </View>
            <View style={styles.adhocRowText}>
              <Text style={styles.adhocRowTitle}>Post a dated trip</Text>
              <Text style={styles.adhocRowSub}>Create a drive with time, route, and seats.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.adhocRow}
            onPress={() => router.push("/(tabs)/rides")}
            activeOpacity={0.75}
          >
            <View style={[styles.adhocIconWrap, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="albums-outline" size={22} color={Colors.primary} />
            </View>
            <View style={styles.adhocRowText}>
              <Text style={styles.adhocRowTitle}>My rides &amp; bookings</Text>
              <Text style={styles.adhocRowSub}>Everything you&apos;re hosting or booked on.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        </PillarSection>
        )}

        {profile ? (
          <View
            style={styles.networkHubBlock}
            onLayout={(e) => {
              networkHubBlockY.current = e.nativeEvent.layout.y;
            }}
          >
            <HomeNetworkHub
              scrollToParam={scrollToParamNorm}
              onRequestScrollToSeats={scrollToSeatsOnHome}
              onSeatsSectionInnerLayout={(y) => {
                seatsSectionInnerY.current = y;
              }}
            />
          </View>
        ) : null}

        <ProfileCompletion
          profile={profile}
          onEditProfile={() => router.push("/(tabs)/profile?edit=1")}
        />

        {org?.org_type === "community" && (
          <View
            style={[
              styles.shareLeaderCard,
              { borderColor: Colors.accent, backgroundColor: Colors.accentLight },
            ]}
          >
            <View style={styles.shareLeaderHeader}>
              <Ionicons name="megaphone-outline" size={20} color="#D97706" />
              <Text style={styles.shareLeaderTitle}>
                {orgMemberCount >= 3
                  ? `${orgMemberCount} colleagues from your domain are on Poolyn!`
                  : "No corporate account for your domain yet"}
              </Text>
            </View>
            <Text style={styles.shareLeaderBody}>
              {orgMemberCount >= 3
                ? "Help your team save time and money. Share Poolyn with a manager or HR lead who can activate a Business account."
                : "Share Poolyn with your leadership so your company can sponsor a Business account and unlock priority matching."}
            </Text>
            <TouchableOpacity
              style={styles.shareLeaderBtn}
              onPress={handleShareWithLeadership}
              activeOpacity={0.8}
            >
              <Ionicons name="share-social-outline" size={16} color="#FFFFFF" />
              <Text style={styles.shareLeaderBtnText}>Share with leadership</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      <Modal
        visible={postRequestOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!postRequestSubmitting) setPostRequestOpen(false);
        }}
      >
        <Pressable
          style={postRequestModalStyles.backdrop}
          onPress={() => {
            if (!postRequestSubmitting) setPostRequestOpen(false);
          }}
        >
          <Pressable style={postRequestModalStyles.card} onPress={(e) => e.stopPropagation()}>
            <Text style={postRequestModalStyles.modalTitle}>Post pickup request</Text>
            <Text style={postRequestModalStyles.modalSub}>
              Uses your saved home and work. Drivers who are nearby, on a matching commute, or on a posted ride
              with free seats get an alert on their phone. You do not need to open My Rides to reach them.
            </Text>
            <Text style={postRequestModalStyles.fieldLabel}>Direction</Text>
            <View style={postRequestModalStyles.chipRow}>
              {(["to_work", "from_work"] as const).map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    postRequestModalStyles.chip,
                    postRequestDirection === d && postRequestModalStyles.chipOn,
                  ]}
                  onPress={() => setPostRequestDirection(d)}
                >
                  <Text
                    style={[
                      postRequestModalStyles.chipText,
                      postRequestDirection === d && postRequestModalStyles.chipTextOn,
                    ]}
                  >
                    {d === "to_work" ? "To work" : "From work"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={postRequestModalStyles.fieldLabel}>When</Text>
            <View style={postRequestModalStyles.chipRow}>
              <TouchableOpacity
                style={[
                  postRequestModalStyles.chip,
                  postRequestTiming === "now" && postRequestModalStyles.chipOn,
                ]}
                onPress={() => setPostRequestTiming("now")}
              >
                <Text
                  style={[
                    postRequestModalStyles.chipText,
                    postRequestTiming === "now" && postRequestModalStyles.chipTextOn,
                  ]}
                >
                  Now
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  postRequestModalStyles.chip,
                  postRequestTiming === 15 && postRequestModalStyles.chipOn,
                ]}
                onPress={() => setPostRequestTiming(15)}
              >
                <Text
                  style={[
                    postRequestModalStyles.chipText,
                    postRequestTiming === 15 && postRequestModalStyles.chipTextOn,
                  ]}
                >
                  In 15 min
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={postRequestModalStyles.fieldLabelMuted}>Other times</Text>
            <View style={postRequestModalStyles.chipRow}>
              {[30, 45, 60].map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    postRequestModalStyles.chipSm,
                    postRequestTiming === m && postRequestModalStyles.chipOn,
                  ]}
                  onPress={() => setPostRequestTiming(m as PostPickupTiming)}
                >
                  <Text
                    style={[
                      postRequestModalStyles.chipText,
                      postRequestTiming === m && postRequestModalStyles.chipTextOn,
                    ]}
                  >
                    {m} min
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={postRequestModalStyles.modalActions}>
              <TouchableOpacity
                style={postRequestModalStyles.cancelBtn}
                disabled={postRequestSubmitting}
                onPress={() => setPostRequestOpen(false)}
              >
                <Text style={postRequestModalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={postRequestModalStyles.postBtn}
                disabled={postRequestSubmitting}
                onPress={handlePostPickupPress}
              >
                {postRequestSubmitting ? (
                  <ActivityIndicator color={Colors.textOnPrimary} />
                ) : (
                  <Text style={postRequestModalStyles.postBtnText}>Post</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <PoolynMiniTourModal visible={miniTourVisible} onClose={() => setMiniTourVisible(false)} />

      <RoutePeopleSearchModal
        visible={routePeopleModalOpen}
        onClose={() => setRoutePeopleModalOpen(false)}
        orgAllowsOpenLane={orgAllowsOpenLane}
        viewerHasOrg={Boolean(profile?.org_id)}
      />
    </SafeAreaView>
  );
}

const postRequestModalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  modalSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  fieldLabelMuted: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  chip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipSm: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  chipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  chipTextOn: {
    color: Colors.primaryDark,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  cancelText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  postBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  postBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing["5xl"],
  },
  pickupBanner: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary,
    ...Shadow.sm,
  },
  pickupBannerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  pickupBannerTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  pickupBannerBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  pickupBannerMeta: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    fontWeight: FontWeight.medium,
  },
  pickupBannerCountdown: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.accent,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  pickupCancelBtn: {
    marginTop: Spacing.md,
    alignSelf: "flex-start",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  pickupCancelBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.error,
  },
  pickupRidesLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: Spacing.sm,
  },
  pickupRidesLinkText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  searchRouteHeroBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
    ...Shadow.sm,
  },
  searchRouteHeroBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
    textAlign: "center",
    flexShrink: 1,
  },
  poolynProgramToggleWrap: {
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.md,
  },
  poolynProgramEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.5,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  poolynProgramHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  poolynProgramSegments: {
    flexDirection: "row",
    borderRadius: BorderRadius.lg,
    padding: 4,
    gap: 6,
    backgroundColor: Colors.borderLight,
  },
  poolynProgramSeg: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  poolynProgramSegOnRoutine: {
    backgroundColor: ROUTINE_ACCENT,
    borderColor: "#0F766E",
    ...Shadow.sm,
  },
  poolynProgramSegOnAdhoc: {
    backgroundColor: ADHOC_ACCENT,
    borderColor: "#B45309",
    ...Shadow.sm,
  },
  poolynProgramSegText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    textAlign: "center",
    flexShrink: 1,
  },
  poolynProgramSegTextOn: {
    color: "#FFFFFF",
  },
  commuteRouteOuterCard: {
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: "#99F6E4",
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadow.md,
  },
  commuteRouteOuterEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.5,
    color: ROUTINE_ACCENT,
    marginBottom: 4,
  },
  commuteRouteOuterTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.35,
    marginBottom: Spacing.md,
  },
  pillarShell: {
    flexDirection: "row",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing["2xl"],
    overflow: "hidden",
    ...Shadow.md,
  },
  pillarShellRoutine: {
    backgroundColor: "#F0FDFA",
    borderColor: "#99F6E4",
  },
  pillarShellAdhoc: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  pillarAccentBar: {
    width: 5,
    alignSelf: "stretch",
  },
  pillarContent: {
    flex: 1,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.base,
    paddingLeft: Spacing.md,
  },
  pillarEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.4,
    marginBottom: Spacing.xs,
  },
  pillarTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.4,
    marginBottom: Spacing.sm,
  },
  pillarBelowTitle: {
    marginBottom: Spacing.md,
  },
  pillarSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  pillarChildren: {
    gap: Spacing.md,
  },
  pillarInlineLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: -Spacing.sm,
  },
  networkHubBlock: {
    marginBottom: Spacing["2xl"],
  },
  adhocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.14)",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    ...Shadow.sm,
  },
  adhocIconWrap: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  adhocRowText: {
    flex: 1,
    minWidth: 0,
  },
  adhocRowTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  adhocRowSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: 17,
  },
  heroHeader: {
    marginHorizontal: -Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.lg,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
    borderWidth: 1,
    ...Shadow.md,
  },
  heroExplorer: {
    borderColor: "#FDBA74",
  },
  heroEnterprise: {
    borderColor: "#86EFAC",
  },
  heroCommunity: {
    borderColor: "#93C5FD",
  },
  heroTopBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  heroAvatarBtn: {
    flexShrink: 0,
  },
  heroAvatarImg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
  },
  heroAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
  heroTextBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  heroGreetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.md,
    marginBottom: 4,
  },
  heroDateCreditsCol: {
    alignItems: "flex-end",
  },
  heroDateLine: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.2,
    color: Colors.textSecondary,
  },
  heroDateLineExplorer: { color: "#A16207" },
  heroDateLineEnterprise: { color: "#166534" },
  heroDateLineCommunity: { color: "#64748B" },
  heroCreditsTouch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(255,255,255,0.6)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
  },
  heroCreditsText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
    color: Colors.text,
    fontVariant: ["tabular-nums"],
  },
  heroGreetingCaps: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 1.6,
    color: Colors.textSecondary,
    flexShrink: 1,
  },
  heroGreetingExplorer: { color: "#A16207" },
  heroGreetingEnterprise: { color: "#166534" },
  heroGreetingCommunity: { color: "#475569" },
  heroNameDisplay: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: -0.45,
    lineHeight: 30,
    color: Colors.text,
  },
  heroNameExplorer: { color: "#7C2D12" },
  heroNameEnterprise: { color: "#14532D" },
  heroNameCommunity: { color: "#0F172A" },
  heroOrgLineExplorer: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#9A3412",
    marginTop: 2,
  },
  heroOrgLineRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "nowrap",
    marginTop: 2,
    minWidth: 0,
  },
  heroOrgLineNameEnt: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#14532D",
    flexShrink: 1,
  },
  heroOrgLineKindEnt: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#166534",
    flexShrink: 0,
  },
  heroOrgLineNameCom: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#0F172A",
    flexShrink: 1,
  },
  heroOrgLineKindCom: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#2563EB",
    flexShrink: 0,
  },
  heroRightActions: {
    flexShrink: 0,
    alignItems: "flex-end",
    gap: 6,
  },
  heroIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.94)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  heroLogoPressable: {
    borderRadius: BorderRadius.md + 2,
  },
  heroLogoPressablePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  heroBadgeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFEDD5",
    borderWidth: 1,
    borderColor: "#FDBA74",
    justifyContent: "center",
    alignItems: "center",
  },
  heroOrgLogoWrap: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: Colors.surface,
  },
  heroOrgLogo: { width: "100%", height: "100%" },
  heroOrgLogoPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.surface,
  },
  heroOrgLogoPlaceholderCommunity: {
    backgroundColor: "#DBEAFE",
  },
  roleWrap: {
    marginBottom: 0,
    gap: Spacing.sm,
  },
  roleBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
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
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  visibilityTextActive: {
    color: Colors.textOnPrimary,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: 0,
  },
  actionCard: {
    width: "47%",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  actionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  actionTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    flexShrink: 1,
    textAlign: "left",
  },
  actionDesc: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
    textAlign: "center",
  },
  mapCorridorHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
    fontWeight: FontWeight.semibold,
  },
  // ── Flexible mode toggle ─────────────────────────────────
  modeToggleCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    padding: Spacing.base,
    marginBottom: 0,
    ...Shadow.sm,
  },
  modeToggleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modeToggleTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  modeToggleRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
  },
  modeBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  modeNeutralHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    textAlign: "center",
    lineHeight: 18,
  },
  // ── Role badge (updated) ──────────────────────────────────
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: Spacing.md,
  },
  // ── Share leadership card ─────────────────────────────────
  shareLeaderCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    padding: Spacing.base,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  shareLeaderHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  shareLeaderTitle: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: "#92400E",
  },
  shareLeaderBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  shareLeaderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "#D97706",
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    alignSelf: "flex-start",
  },
  shareLeaderBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: "#FFFFFF",
  },
});
