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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { Organisation } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { ORG_PLAN_LABELS } from "@/lib/orgPlanLabels";
import { createCommuteRideRequest, cancelMyPendingRideRequest } from "@/lib/rideRequests";
import { hasAdhocPostingVehicle } from "@/lib/adhocVehicleGate";
import {
  incrementRouteConfirmationCount,
  needsRouteDestinationDoubleCheck,
  ROUTE_CONFIRMATION_THRESHOLD,
} from "@/lib/routeTripConfirmation";
import { PoolynMiniTourModal, POOLYN_MINI_TOUR_DONE_KEY } from "@/components/home/PoolynMiniTourModal";
import { usePassengerPickupState } from "@/hooks/usePassengerPickupState";
import { useExpiryCountdown } from "@/hooks/useExpiryCountdown";
import { RoutinePoolynCrewMingleBlock } from "@/components/home/RoutinePoolynCrewMingle";
import { HomeNetworkHub } from "@/components/home/HomeNetworkHub";
import { CommuteRouteChoicePanel } from "@/components/home/CommuteRouteChoicePanel";
import { RoutePeopleSearchModal } from "@/components/home/RoutePeopleSearchModal";
import { WorkplaceNetworkDetailsModal } from "@/components/home/WorkplaceNetworkDetailsModal";
/* FUTURE USE: hero Poolyn Credits chip (commute_credits_balance)
import { formatPoolynCreditsBalance } from "@/lib/poolynCreditsUi";
*/
import { canViewerActAsPassenger } from "@/lib/commuteMatching";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import { resolveAvatarDisplayUrl } from "@/lib/avatarStorage";
import { getOrganisationLogoPublicUrl } from "@/lib/orgLogo";
import { shouldPromptForWorkplacePin } from "@/lib/workplaceRoutingGate";
import { useOrgAffiliations } from "@/hooks/useOrgAffiliations";

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
        <Text style={pStyles.title}>Build your profile</Text>
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scrollTo: scrollToParam } = useLocalSearchParams<{ scrollTo?: string | string[] }>();
  const scrollToParamNorm = Array.isArray(scrollToParam) ? scrollToParam[0] : scrollToParam;
  const { profile, refreshProfile, activeMode } = useAuth();
  const [postRequestOpen, setPostRequestOpen] = useState(false);
  const [postRequestSubmitting, setPostRequestSubmitting] = useState(false);
  const [postRequestDirection, setPostRequestDirection] = useState<"to_work" | "from_work">("to_work");
  const [postRequestTiming, setPostRequestTiming] = useState<PostPickupTiming>("now");
  const routineSectionYRef = useRef(0);
  const homeScrollRef = useRef<ScrollView>(null);
  const networkHubBlockY = useRef(0);
  const [miniTourVisible, setMiniTourVisible] = useState(false);
  const [commuteRouteReady, setCommuteRouteReady] = useState(false);
  const [routePeopleModalOpen, setRoutePeopleModalOpen] = useState(false);
  const [networkDetailOrg, setNetworkDetailOrg] = useState<Organisation | null>(null);

  const { unreadCount, refreshUnreadCount } = useUnreadNotificationCount(profile?.id ?? null);

  const { affiliations, reloadAffiliations } = useOrgAffiliations(profile?.id);

  useFocusEffect(
    useCallback(() => {
      void refreshProfile();
      void refreshUnreadCount();
      void reloadAffiliations();
    }, [refreshProfile, refreshUnreadCount, reloadAffiliations])
  );

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const commutePinsReady = useMemo(
    () =>
      Boolean(
        profile &&
          parseGeoPoint(profile.home_location as unknown) &&
          parseGeoPoint(profile.work_location as unknown)
      ),
    [profile]
  );
  const heroAvatarUri = resolveAvatarDisplayUrl(profile?.avatar_url);
  const showPostRequest = activeMode === "passenger";
  const passengerPickupEnabled = !!profile?.id && canViewerActAsPassenger(profile);
  const pickupState = usePassengerPickupState(profile?.id ?? null, passengerPickupEnabled);
  const pendingExpiryLabel = useExpiryCountdown(pickupState.pending?.expires_at);

  useFocusEffect(
    useCallback(() => {
      if (passengerPickupEnabled && profile?.id) void pickupState.reload();
    }, [passengerPickupEnabled, profile?.id, pickupState.reload])
  );

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

  const primaryAffiliation = useMemo(() => {
    if (!affiliations.length) return null;
    if (profile?.org_id) {
      const match = affiliations.find((a) => a.organisationId === profile.org_id);
      if (match) return match;
    }
    return affiliations[0] ?? null;
  }, [affiliations, profile?.org_id]);

  const org = primaryAffiliation?.org ?? null;
  const orgMemberCount = primaryAffiliation?.memberCount ?? 0;

  const hasOrg = affiliations.length > 0;
  const isEnterpriseOrg = org?.org_type === "enterprise";
  const isCommunityOrg = hasOrg && !isEnterpriseOrg;

  const orgPlanLabel = useMemo(() => {
    if (!org) return "";
    return ORG_PLAN_LABELS[org.plan ?? "free"] ?? String(org.plan ?? "");
  }, [org]);

  const heroGradientColors = useMemo((): [string, string, string] => {
    if (isEnterpriseOrg) return ["#DCFCE7", "#ECFDF5", "#FFFFFF"];
    if (isCommunityOrg) return ["#DBEAFE", "#F0F9FF", "#FFFFFF"];
    if (!hasOrg) return ["#FFEDD5", "#FFFBF0", "#FFFFFF"];
    return ["#F1F5F9", "#F8FAFC", "#FFFFFF"];
  }, [hasOrg, isEnterpriseOrg, isCommunityOrg]);

  const [poolynProgram, setPoolynProgram] = useState<"routine" | "adhoc">("routine");

  useEffect(() => {
    if (scrollToParamNorm !== "opportunities") return;
    setPoolynProgram("routine");
    const t = setTimeout(() => {
      homeScrollRef.current?.scrollTo({
        y: Math.max(0, networkHubBlockY.current - 16),
        animated: true,
      });
      router.replace("/(tabs)/home");
    }, 400);
    return () => clearTimeout(t);
  }, [scrollToParamNorm, router]);

  const orgAllowsOpenLane = org?.allow_cross_org === true;

  function showExplorerInfo() {
    showAlert(
      "Independent commuter",
      "No workplace network yet. You still match along your corridor with independents and any commuter.\n\nIf your company joins Poolyn later, they can add you or send an invite."
    );
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
          ? "Nearby drivers with seats are notified. This screen updates when someone accepts."
          : "Drivers get a heads-up to plan. This screen updates when someone accepts."
      );
      setPostRequestOpen(false);
    } else {
      showAlert("Could not post", res.reason);
    }
  }, [postRequestTiming, postRequestDirection, pickupState]);

  function handlePostPickupPress() {
    void (async () => {
      const needConfirm = await needsRouteDestinationDoubleCheck(postRequestDirection);
      const dirLabel = postRequestDirection === "to_work" ? "to work" : "from work";
      if (needConfirm) {
        showAlert(
          `Confirm ${dirLabel}`,
          `First ${ROUTE_CONFIRMATION_THRESHOLD} posts each way: check home and work in Profile so routing is right.`,
          [
            {
              text: "Edit commute",
              style: "cancel",
              onPress: () => {
                setPostRequestOpen(false);
                router.push("/(tabs)/profile/commute-locations");
              },
            },
            { text: "Looks good, post", onPress: () => void runPostPickupRequest() },
          ]
        );
        return;
      }
      await runPostPickupRequest();
    })();
  }

  useEffect(() => {
    if (!commutePinsReady) return;
    let cancelled = false;
    void AsyncStorage.getItem(POOLYN_MINI_TOUR_DONE_KEY).then((v) => {
      if (!cancelled && !v) setMiniTourVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [commutePinsReady]);

  return (
    <View style={styles.safe}>
      <ScrollView
        ref={homeScrollRef}
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing["5xl"] + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: gradient band by explorer / workplace type */}
        <LinearGradient
          colors={heroGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.heroHeader,
            { paddingTop: insets.top + Spacing.xs },
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
              {heroAvatarUri ? (
                <Image source={{ uri: heroAvatarUri }} style={styles.heroAvatarImg} />
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
                  {/* FUTURE USE: Poolyn Credits balance chip → poolyn-credits screen
                  <TouchableOpacity
                    style={styles.heroCreditsTouch}
                    onPress={() => router.push("/(tabs)/profile/poolyn-credits")}
                    ...
                  </TouchableOpacity>
                  */}
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
                <View style={styles.notifBellWrap}>
                  <Ionicons name="notifications-outline" size={21} color={Colors.text} />
                  {unreadCount > 0 ? (
                    <View style={styles.notifBadge}>
                      <Text style={styles.notifBadgeText}>
                        {unreadCount > 99 ? "99+" : String(unreadCount)}
                      </Text>
                    </View>
                  ) : null}
                </View>
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
                <View style={styles.heroOrgLogosRow}>
                  {affiliations.map((a) => {
                    const n = affiliations.length;
                    const wrapStyle =
                      n === 1
                        ? styles.heroOrgLogoWrap
                        : n === 2
                          ? styles.heroOrgLogoWrapDuo
                          : styles.heroOrgLogoWrapTrio;
                    const aEnterprise = a.org.org_type === "enterprise";
                    return (
                      <Pressable
                        key={a.organisationId}
                        style={({ pressed }) => [
                          styles.heroLogoPressable,
                          pressed && styles.heroLogoPressablePressed,
                        ]}
                        onPress={() => setNetworkDetailOrg(a.org)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          aEnterprise ? "Workplace details for " + (a.org.name ?? "") : "Network details"
                        }
                      >
                        <View style={wrapStyle}>
                          {a.logoPublicUrl ? (
                            <Image source={{ uri: a.logoPublicUrl }} style={styles.heroOrgLogo} />
                          ) : aEnterprise ? (
                            <View style={styles.heroOrgLogoPlaceholder}>
                              <Ionicons name="business" size={22} color={Colors.primaryDark} />
                            </View>
                          ) : (
                            <View
                              style={[
                                styles.heroOrgLogoPlaceholder,
                                styles.heroOrgLogoPlaceholderCommunity,
                              ]}
                            >
                              <Ionicons name="people-outline" size={22} color={Colors.info} />
                            </View>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        </LinearGradient>

        {profile && shouldPromptForWorkplacePin(profile) ? (
          <View style={styles.workplaceBanner}>
            <Ionicons name="business-outline" size={22} color={Colors.primaryDark} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.workplaceBannerTitle}>Add your workplace</Text>
              <Text style={styles.workplaceBannerBody}>
                With home, sets your main route and alternates.                 Not shown for verified company members when your workplace is already on file.
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/(tabs)/profile/commute-locations?focus=work")}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Add workplace for routing"
              >
                <Text style={styles.workplaceBannerLink}>Set workplace</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {passengerPickupEnabled && pickupState.pending ? (
          <View style={styles.pickupBanner}>
            <>
              <View style={styles.pickupBannerRow}>
                <Ionicons name="radio-outline" size={22} color={Colors.primaryDark} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pickupBannerTitle}>Pickup request active</Text>
                  <Text style={styles.pickupBannerBody}>
                    Drivers near you are notified. This status updates when someone accepts your pickup.
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
                      Cancels in {pendingExpiryLabel} if no one accepts. You can post again after that.
                    </Text>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                style={styles.pickupCancelBtn}
                onPress={() => {
                  if (!profile?.id) return;
                  showAlert("Cancel request?", "Drivers will no longer see this request.", [
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
          </View>
        ) : null}

        {commutePinsReady ? (
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
        ) : (
          <TouchableOpacity
            style={styles.searchRouteHeroBtnMuted}
            activeOpacity={0.88}
            onPress={() => router.push("/(tabs)/profile/commute-locations")}
            accessibilityRole="button"
            accessibilityLabel="Set home and work to find people on your route"
          >
            <Ionicons name="location-outline" size={22} color={Colors.textSecondary} />
            <Text style={styles.searchRouteHeroBtnMutedText}>Set home and work to find people on your route</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}

        {profile ? (
          <View style={styles.poolynProgramToggleWrap}>
            <Text style={styles.poolynProgramEyebrow}>YOUR POOLYN</Text>
            <Text style={styles.poolynProgramHint}>
              Regular commute: your saved home to work route. Ad-hoc: dated one-off trips.
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
                <View style={styles.poolynProgramSegInner}>
                  <Ionicons
                    name="swap-horizontal"
                    size={18}
                    color={poolynProgram === "routine" ? "#FFFFFF" : ROUTINE_ACCENT}
                  />
                  <Text
                    style={[
                      styles.poolynProgramSegText,
                      poolynProgram === "routine" && styles.poolynProgramSegTextOn,
                    ]}
                    numberOfLines={2}
                  >
                    Regular commute
                  </Text>
                </View>
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
                <View style={styles.poolynProgramSegInner}>
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={poolynProgram === "adhoc" ? "#FFFFFF" : ADHOC_ACCENT}
                  />
                  <Text
                    style={[
                      styles.poolynProgramSegText,
                      poolynProgram === "adhoc" && styles.poolynProgramSegTextOn,
                    ]}
                    numberOfLines={2}
                  >
                    Ad-hoc trips
                  </Text>
                </View>
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
            commutePinsReady ? (
              <View style={styles.routineUnifiedShell}>
                <View style={styles.routineUnifiedHeader}>
                  <Text style={styles.routineUnifiedEyebrow}>ROUTINE POOLYN</Text>
                  <Text style={styles.routineUnifiedTitle}>Your regular commute</Text>
                </View>
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
                <View style={styles.routineUnifiedDivider} />
                <View style={styles.routineUnifiedCrewBlock}>
                  <Text style={styles.routineUnifiedEyebrowCrew}>ROUTINE COMMUTE</Text>
                  <Text style={styles.routineUnifiedSubtitle}>Crewmates or the wider pool</Text>
                  <RoutinePoolynCrewMingleBlock
                    profile={profile}
                    orgId={profile.org_id}
                    setVisibilityMode={setVisibilityMode}
                    commuteRouteReady={commuteRouteReady}
                    minglePassengerPickup={
                      passengerPickupEnabled && showPostRequest
                        ? {
                            hasPendingRequest: !!pickupState.pending,
                            onOpenPostRequest: () => setPostRequestOpen(true),
                          }
                        : undefined
                    }
                    onCrewCreated={() => {
                      void refreshProfile();
                    }}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.exploreRoutineCard}>
                <Text style={styles.exploreRoutineEyebrow}>EXPLORE</Text>
                <Text style={styles.exploreRoutineTitle}>Your regular commute</Text>
                <Text style={styles.exploreRoutineBody}>
                  Save home and work when you want corridor matches. You can still join dated trips below.
                </Text>
                <TouchableOpacity
                  style={styles.exploreRoutinePrimary}
                  onPress={() => router.push("/(tabs)/profile/commute-locations?focus=work")}
                  activeOpacity={0.85}
                >
                  <Ionicons name="location-outline" size={20} color={Colors.textOnPrimary} />
                  <Text style={styles.exploreRoutinePrimaryText}>Set your commute</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.exploreRoutineSecondary}
                  onPress={() => router.push("/(tabs)/profile/driver-setup")}
                  activeOpacity={0.85}
                >
                  <Ionicons name="car-outline" size={20} color={Colors.primary} />
                  <Text style={styles.exploreRoutineSecondaryText}>Start driving</Text>
                </TouchableOpacity>
              </View>
            )
          ) : null}
        </View>
        ) : (
        <PillarSection
          variant="adhoc"
          eyebrow="AD-HOC POOLYN"
          title="One-off & planned trips"
          subtitle="Post a drive with date and seats, or search your workplace for a spare seat."
        >
          <TouchableOpacity
            style={styles.adhocRow}
            onPress={() => {
              void (async () => {
                if (!profile?.id) return;
                const ok = await hasAdhocPostingVehicle(profile.id);
                if (!ok) {
                  showAlert("Driver profile needed", "Add a vehicle with at least two seats to host a dated trip.", [
                    { text: "Not now", style: "cancel" },
                    { text: "Start driving", onPress: () => router.push("/(tabs)/profile/driver-setup") },
                  ]);
                  return;
                }
                router.push("/(tabs)/rides/post-dated-trip");
              })();
            }}
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
            onPress={() => router.push("/(tabs)/rides/search-seat")}
            activeOpacity={0.75}
          >
            <View style={[styles.adhocIconWrap, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="search-outline" size={22} color={Colors.primary} />
            </View>
            <View style={styles.adhocRowText}>
              <Text style={styles.adhocRowTitle}>Search for a seat</Text>
              <Text style={styles.adhocRowSub}>Where to where, date, and baggage needs.</Text>
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
            <HomeNetworkHub />
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
              Uses your saved home and work. Nearby or matching drivers get an alert. No need to open My Rides first.
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
        viewerHasOrg={affiliations.length > 0}
      />

      <WorkplaceNetworkDetailsModal
        visible={networkDetailOrg !== null}
        onClose={() => setNetworkDetailOrg(null)}
        variant={networkDetailOrg?.org_type === "enterprise" ? "enterprise" : "community"}
        org={networkDetailOrg}
        orgMemberCount={
          networkDetailOrg
            ? affiliations.find((a) => a.organisationId === networkDetailOrg.id)?.memberCount ?? orgMemberCount
            : orgMemberCount
        }
        planLabel={
          networkDetailOrg
            ? ORG_PLAN_LABELS[networkDetailOrg.plan ?? "free"] ?? String(networkDetailOrg.plan ?? "")
            : orgPlanLabel
        }
        logoPublicUrl={networkDetailOrg ? getOrganisationLogoPublicUrl(networkDetailOrg) : null}
      />
    </View>
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
    paddingHorizontal: Spacing.md,
    paddingTop: 0,
    paddingBottom: Spacing["5xl"],
  },
  workplaceBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  workplaceBannerTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 4,
  },
  workplaceBannerBody: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  workplaceBannerLink: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  pickupBanner: {
    marginHorizontal: 0,
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
  searchRouteHeroBtnMuted: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchRouteHeroBtnMutedText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textAlign: "center",
    flex: 1,
    flexShrink: 1,
  },
  exploreRoutineCard: {
    marginBottom: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  exploreRoutineEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.2,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  exploreRoutineTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  exploreRoutineBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  exploreRoutinePrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  exploreRoutinePrimaryText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  exploreRoutineSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  exploreRoutineSecondaryText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  poolynProgramToggleWrap: {
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
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
    borderRadius: BorderRadius.md,
    padding: 3,
    gap: 4,
    backgroundColor: Colors.borderLight,
  },
  poolynProgramSeg: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  poolynProgramSegInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 4,
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
  routineUnifiedShell: {
    borderRadius: BorderRadius.lg,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "#99F6E4",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.lg,
    overflow: "hidden",
    ...Shadow.sm,
  },
  routineUnifiedHeader: {
    marginBottom: Spacing.sm,
  },
  routineUnifiedEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.4,
    color: ROUTINE_ACCENT,
    marginBottom: 2,
  },
  routineUnifiedTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  routineUnifiedDivider: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: "#5EEAD4",
    opacity: 0.55,
    marginVertical: Spacing.md,
    marginHorizontal: -Spacing.md,
  },
  routineUnifiedCrewBlock: {
    paddingTop: 0,
  },
  routineUnifiedEyebrowCrew: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.4,
    color: ROUTINE_ACCENT,
    marginBottom: 2,
  },
  routineUnifiedSubtitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.35,
    marginBottom: Spacing.sm,
  },
  pillarShell: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing["2xl"],
    overflow: "hidden",
    ...Shadow.sm,
  },
  pillarShellRoutine: {
    backgroundColor: "#F0FDFA",
    borderColor: "#99F6E4",
  },
  pillarShellAdhoc: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  pillarContent: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
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
    marginHorizontal: -Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.md,
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
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
  },
  heroAvatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
    position: "relative",
  },
  notifBellWrap: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  notifBadge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  notifBadgeText: {
    color: Colors.textOnPrimary,
    fontSize: 10,
    fontWeight: FontWeight.bold,
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
  heroOrgLogosRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexShrink: 0,
    maxWidth: 168,
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
  heroOrgLogoWrapDuo: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: Colors.surface,
  },
  heroOrgLogoWrapTrio: {
    width: 30,
    height: 30,
    borderRadius: BorderRadius.sm,
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
