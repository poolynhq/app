import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, extractDomain } from "@/lib/supabase";
import { orgRequiresFullActivationPaywall } from "@/lib/orgNetworkUi";
import { AdminOrgStatusBanner } from "@/components/AdminOrgStatusBanner";
import { Organisation } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const PLAN_LABELS: Record<string, string> = {
  free: "Scout Basic",
  starter: "Momentum Growth",
  business: "Pulse Business",
  enterprise: "Orbit Enterprise",
};

const ADMIN_NETWORK_WELCOME_KEY = "@poolyn/admin_network_dashboard_welcome_v1";

/** First label of a domain, title-cased (e.g. meridiantech.com → Meridiantech). */
function readableCompanyFromDomain(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!d) return "";
  const leaf = d.split(".")[0];
  if (!leaf) return d;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

function parseDashboardRpcPayload(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      const p = JSON.parse(data) as unknown;
      return typeof p === "object" && p !== null && !Array.isArray(p)
        ? (p as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.sectionHeaderWrap}>
      <View style={styles.sectionHeaderAccent} />
      <View style={styles.sectionHeaderTextCol}>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
      </View>
    </View>
  );
}

export default function AdminOverview() {
  const { profile, session } = useAuth();
  const router = useRouter();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  /** Same email domain as org, not in the workplace network (explorers). */
  const [domainExplorersCount, setDomainExplorersCount] = useState(0);
  const [totalRides, setTotalRides] = useState(0);
  /** Members with ride/request activity this calendar month (billing / engagement). */
  const [monthlyActiveCommuters, setMonthlyActiveCommuters] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [scheduledRides, setScheduledRides] = useState(0);
  const [peakHour, setPeakHour] = useState<string>("--");
  const [co2Saved, setCo2Saved] = useState(0);
  const [overageUsers, setOverageUsers] = useState(0);
  const [overageCost, setOverageCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdminWelcome, setShowAdminWelcome] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile?.org_id) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      if (!session?.user) {
        return;
      }

      const monthRef = new Date().toISOString().slice(0, 10);

      const [orgRes, membersListRes, dashRes] = await Promise.all([
        supabase
          .from("organisations")
          .select("*")
          .eq("id", profile.org_id)
          .single(),
        supabase
          .from("users")
          .select(
            "id, full_name, email, role, org_role, active, onboarding_completed, org_member_verified, created_at"
          )
          .eq("org_id", profile.org_id)
          .order("full_name"),
        supabase.rpc("poolyn_org_admin_dashboard_stats", { p_org_id: profile.org_id }),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (membersListRes.error) throw membersListRes.error;

      const memberRows = membersListRes.data ?? [];
      if (__DEV__ && dashRes.error) {
        console.warn("[admin overview] poolyn_org_admin_dashboard_stats", dashRes.error.message);
      }
      const dashPayload = !dashRes.error ? parseDashboardRpcPayload(dashRes.data) : null;

      // Prefer same-org list from PostgREST when RLS returns rows (matches Members tab).
      // Use SECURITY DEFINER RPC counts/ids only when the client list is empty (RLS gap, etc.).
      let memberCountVal = memberRows.length;
      let domainExplorersVal = Number(dashPayload?.domain_explorers_count ?? 0);
      let monthlyCommutersVal = 0;
      let orgUserIds: string[] = memberRows.map((r) => r.id);

      if (dashPayload) {
        monthlyCommutersVal = Number(dashPayload.monthly_active_commuters ?? 0);
        if (memberRows.length === 0) {
          memberCountVal = Number(dashPayload.total_members ?? 0);
          const rawIds = dashPayload.member_user_ids;
          if (Array.isArray(rawIds)) {
            orgUserIds = rawIds.filter((x): x is string => typeof x === "string");
          }
        }
      } else {
        const { data: mauData } = await supabase.rpc("org_active_user_count", {
          target_org_id: profile.org_id,
        });
        monthlyCommutersVal = typeof mauData === "number" ? mauData : 0;
      }

      if (orgUserIds.length === 0) {
        orgUserIds = memberRows.map((r) => r.id);
      }

      if (__DEV__) {
        if (memberRows.length === 0 && memberCountVal > 0) {
          console.warn(
            "[admin overview] member list empty but RPC reports",
            memberCountVal,
            "— check org_id",
            profile.org_id
          );
        }
        if (memberRows.length > 0 && memberCountVal !== memberRows.length) {
          console.warn("[admin overview] count mismatch (using list length)", {
            list: memberRows.length,
            shown: memberCountVal,
          });
        }
      }

      setOrg(orgRes.data);
      setMemberCount(memberCountVal);
      setDomainExplorersCount(domainExplorersVal);
      setMonthlyActiveCommuters(monthlyCommutersVal);

      const [ridesRes, requestsRes, scheduledRidesRes, peakRidesRes] =
        orgUserIds.length > 0
          ? await Promise.all([
              supabase
                .from("rides")
                .select("id", { count: "exact", head: true })
                .in("driver_id", orgUserIds)
                .in("status", ["scheduled", "active", "completed"]),
              supabase
                .from("ride_requests")
                .select("id", { count: "exact", head: true })
                .in("passenger_id", orgUserIds)
                .eq("status", "pending"),
              supabase
                .from("rides")
                .select("id", { count: "exact", head: true })
                .in("driver_id", orgUserIds)
                .eq("status", "scheduled"),
              supabase
                .from("rides")
                .select("depart_at")
                .in("driver_id", orgUserIds)
                .in("status", ["scheduled", "active", "completed"])
                .order("depart_at", { ascending: false })
                .limit(200),
            ])
          : [
              { count: 0, data: [], error: null },
              { count: 0, data: [], error: null },
              { count: 0, data: [], error: null },
              { data: [], error: null },
            ];

      let totalRidesVal = 0;
      let pendingVal = 0;
      let scheduledVal = 0;
      let peakRows: { depart_at: string }[] = [];

      if (ridesRes.error) {
        if (__DEV__) console.warn("[admin overview] rides count:", ridesRes.error.message);
      } else {
        totalRidesVal = ridesRes.count ?? 0;
      }
      if (requestsRes.error) {
        if (__DEV__) console.warn("[admin overview] ride_requests count:", requestsRes.error.message);
      } else {
        pendingVal = requestsRes.count ?? 0;
      }
      if (scheduledRidesRes.error) {
        if (__DEV__) console.warn("[admin overview] scheduled rides count:", scheduledRidesRes.error.message);
      } else {
        scheduledVal = scheduledRidesRes.count ?? 0;
      }
      if (peakRidesRes.error) {
        if (__DEV__) console.warn("[admin overview] peak rides:", peakRidesRes.error.message);
      } else {
        peakRows = (peakRidesRes.data ?? []) as { depart_at: string }[];
      }

      setTotalRides(totalRidesVal);
      setPendingRequests(pendingVal);
      setScheduledRides(scheduledVal);

      const [{ data: analyticsData, error: analyticsErr }, { data: planUsageData, error: planErr }] =
        await Promise.all([
          supabase.rpc("get_org_analytics_summary", {
            p_org_id: profile.org_id,
            p_month: monthRef,
          }),
          supabase.rpc("get_org_plan_usage", {
            p_org_id: profile.org_id,
            p_month: monthRef,
          }),
        ]);
      if (__DEV__ && (analyticsErr || planErr)) {
        console.warn("[admin overview] analytics RPC", analyticsErr?.message ?? planErr?.message);
      }

      const analytics = (analyticsData ?? {}) as Record<string, number>;
      const usage = (planUsageData ?? {}) as Record<string, number>;
      setCo2Saved(Number(analytics.co2_saved_kg ?? 0));
      setOverageUsers(Number(usage.overage_users ?? 0));
      setOverageCost(Number(usage.estimated_overage_cost ?? 0));

      const hourBuckets: Record<number, number> = {};
      for (const item of peakRows) {
        const dt = new Date(item.depart_at);
        const h = dt.getHours();
        hourBuckets[h] = (hourBuckets[h] ?? 0) + 1;
      }
      const bestHour = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0]?.[0];
      setPeakHour(bestHour ? `${bestHour}:00` : "--");
    } catch (e: any) {
      setError(e.message ?? "Failed to load dashboard data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.org_id, session?.user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (loading || error || !profile?.id || !profile.org_id) return;
    if (profile.org_role !== "admin") return;

    let cancelled = false;
    (async () => {
      try {
        const key = `${ADMIN_NETWORK_WELCOME_KEY}/${profile.id}/${profile.org_id}`;
        const seen = await AsyncStorage.getItem(key);
        if (cancelled || seen === "1") return;
        setShowAdminWelcome(true);
      } catch {
        /* still show welcome once if storage fails */
        if (!cancelled) setShowAdminWelcome(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, error, profile?.id, profile?.org_id, profile?.org_role]);

  const dismissAdminWelcome = useCallback(
    async (navigateToMembers: boolean) => {
      if (profile?.id && profile.org_id) {
        try {
          await AsyncStorage.setItem(
            `${ADMIN_NETWORK_WELCOME_KEY}/${profile.id}/${profile.org_id}`,
            "1"
          );
        } catch {
          /* ignore */
        }
      }
      setShowAdminWelcome(false);
      if (navigateToMembers) {
        router.push("/(admin)/members");
      }
    },
    [profile?.id, profile?.org_id, router]
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.error}
          />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const planLabel = PLAN_LABELS[org?.plan ?? "free"] ?? "Free";
  const isManagedNetwork = org?.org_type === "enterprise";
  const demandSupplyDelta = pendingRequests - scheduledRides;

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

  const orgDomainRaw = org?.domain?.trim() ?? "";
  const emailDomainRaw = profile?.email ? extractDomain(profile.email) : "";

  const orgDisplayName =
    org?.name?.trim() ||
    (orgDomainRaw ? readableCompanyFromDomain(orgDomainRaw) : "") ||
    (emailDomainRaw ? readableCompanyFromDomain(emailDomainRaw) : "") ||
    "Organisation";

  const orgDomainLine = orgDomainRaw
    ? `${orgDomainRaw} · ${planLabel}`
    : emailDomainRaw
      ? `${emailDomainRaw} · ${planLabel}`
      : planLabel;

  function explainNetworkType() {
    showAlert(
      "Network types",
      "Managed network: a formal workplace on Poolyn (enterprise) with verified email domain, admin dashboard, member tools, and plan billing.\n\nCommunity network: an informal or organically grown network where colleagues joined without the full enterprise package. You still get a shared pool, with lighter org controls."
    );
  }

  const othersCount = Math.max(0, memberCount - 1);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Modal
        visible={showAdminWelcome}
        transparent
        animationType="fade"
        onRequestClose={() => dismissAdminWelcome(false)}
      >
        <Pressable style={styles.welcomeOverlay} onPress={() => dismissAdminWelcome(false)}>
          <Pressable style={styles.welcomeCard} onPress={(e) => e.stopPropagation()}>
            <LinearGradient
              colors={["#E8F5EE", Colors.surface]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.welcomeGradient}
            >
              <View style={styles.welcomeIconWrap}>
                <Ionicons name="sparkles" size={28} color={Colors.primary} />
              </View>
              <Text style={styles.welcomeTitle}>
                {memberCount >= 2 ? "Your team is already here" : "Welcome, network admin"}
              </Text>
              <Text style={styles.welcomeBody}>
                {memberCount >= 2 ? (
                  <>
                    <Text style={styles.welcomeHighlight}>
                      {memberCount} people{" "}
                    </Text>
                    from your organisation are on Poolyn
                    {othersCount >= 1
                      ? `, including ${othersCount} colleague${othersCount === 1 ? "" : "s"} who joined before your admin setup.`
                      : "."}
                    {"\n\n"}
                    Review roles and verification under{" "}
                    <Text style={styles.welcomeBold}>Manage users</Text> on the Members tab.
                  </>
                ) : (
                  <>
                    You&apos;re set up as the admin for{" "}
                    <Text style={styles.welcomeHighlight}>{orgDisplayName}</Text>.
                    When your team joins, they&apos;ll appear in{" "}
                    <Text style={styles.welcomeBold}>Manage users</Text> (Members tab).
                  </>
                )}
              </Text>
            </LinearGradient>
            <View style={styles.welcomeActions}>
              {memberCount >= 2 ? (
                <TouchableOpacity
                  style={styles.welcomePrimaryBtn}
                  activeOpacity={0.85}
                  onPress={() => dismissAdminWelcome(true)}
                >
                  <Ionicons name="people" size={18} color={Colors.textOnPrimary} />
                  <Text style={styles.welcomePrimaryBtnText}>Open Manage users</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.welcomeSecondaryBtn}
                activeOpacity={0.85}
                onPress={() => dismissAdminWelcome(false)}
              >
                <Text style={styles.welcomeSecondaryBtnText}>
                  {memberCount >= 2 ? "Continue to dashboard" : "Got it"}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <AdminOrgStatusBanner />
        {/* Header — company first; dashboard title secondary */}
        <View style={styles.dashboardHeader}>
          <View style={styles.orgLogoWrap}>
            {orgLogoPublicUrl ? (
              <Image source={{ uri: orgLogoPublicUrl }} style={styles.orgLogoImage} />
            ) : (
              <View style={styles.orgLogoPlaceholder}>
                <Ionicons name="business" size={28} color={Colors.textTertiary} />
              </View>
            )}
          </View>
          <View style={styles.dashboardHeaderText}>
            <Text style={styles.orgTitle} numberOfLines={2}>
              {orgDisplayName}
            </Text>
            <Text style={styles.orgMeta} numberOfLines={2}>
              {orgDomainLine}
            </Text>
            <Text style={styles.dashboardKicker}>Network dashboard</Text>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.networkTypeBadge,
                  isManagedNetwork ? styles.networkTypeBadgeManaged : styles.networkTypeBadgeCommunity,
                ]}
              >
                <Text
                  style={[
                    styles.networkTypeBadgeText,
                    isManagedNetwork
                      ? styles.networkTypeBadgeTextManaged
                      : styles.networkTypeBadgeTextCommunity,
                  ]}
                >
                  {isManagedNetwork ? "Managed network" : "Community network"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={explainNetworkType}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="What do network types mean?"
              >
                <Ionicons name="information-circle-outline" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Stats: member totals (plan is in the header subtitle) */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="people" size={18} color={Colors.primary} />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statValue}>{memberCount}</Text>
              <Text style={styles.statLabel}>Total members</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.statCard}
            activeOpacity={0.75}
            onPress={() => {
              if (profile?.org_role === "admin") {
                router.push("/(admin)/domain-join-requests");
              }
            }}
            disabled={profile?.org_role !== "admin"}
            accessibilityRole="button"
            accessibilityLabel="Open domain join requests"
          >
            <View style={[styles.statIcon, { backgroundColor: "#F3E8FF" }]}>
              <Ionicons name="person-add-outline" size={18} color="#8B5CF6" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statValue}>{domainExplorersCount}</Text>
              <Text style={styles.statLabel}>Domain explorers</Text>
              <Text style={styles.statHint}>
                Same company email, not on the network — send join requests
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <SectionHeader eyebrow="Performance" title="Analytics" />
        <View style={styles.analyticsRow}>
          <Text style={styles.analyticsItem}>Total rides: {totalRides}</Text>
          <Text style={styles.analyticsItem}>CO₂ saved: {co2Saved} kg</Text>
          <Text style={styles.analyticsItem}>Peak commute time: {peakHour}</Text>
        </View>

        <SectionHeader eyebrow="Live signals" title="Network health" />
        <View style={styles.healthCard}>
          <Text style={styles.healthBody}>
            Demand vs supply: {pendingRequests} requests vs {scheduledRides} rides
          </Text>
          <Text style={styles.healthBody}>
            {demandSupplyDelta > 0
              ? `Drivers needed on key routes (${demandSupplyDelta} short).`
              : "Current supply is keeping pace with demand."}
          </Text>
        </View>

        <SectionHeader eyebrow="Billing" title="Plan usage & monetization" />
        <View style={styles.healthCard}>
          <Text style={styles.healthBody}>
            Members with ride or request activity this month: {monthlyActiveCommuters}
          </Text>
          <Text style={styles.healthMuted}>
            Counts people in your org who drove, rode, or sent a ride request in the current
            calendar month (used for plan limits). Separate from domain explorers, who share your
            email domain but are not members yet.
          </Text>
          <Text style={[styles.healthBody, { marginTop: Spacing.sm }]}>
            Overage users: {overageUsers}
          </Text>
          <Text style={styles.healthBody}>Estimated overage: ${overageCost.toFixed(2)}</Text>
        </View>

        <SectionHeader eyebrow="Shortcuts" title="Quick actions" />
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => router.push("/(admin)/members")}
          >
            <View style={[styles.actionIcon, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="people" size={20} color={Colors.primary} />
            </View>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitle}>Manage users</Text>
              <Text style={styles.actionDesc}>View and manage your team</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => {
              if (org && orgRequiresFullActivationPaywall(org.status)) {
                router.push("/(admin)/org-paywall");
              } else {
                router.push("/(admin)/invite");
              }
            }}
          >
            <View style={[styles.actionIcon, { backgroundColor: "#EFF6FF" }]}>
              <Ionicons name="share-outline" size={20} color={Colors.info} />
            </View>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitle}>Join network</Text>
              <Text style={styles.actionDesc}>Invite colleagues to join</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => router.push("/(admin)/members")}
          >
            <View style={[styles.actionIcon, { backgroundColor: "#F3E8FF" }]}>
              <Ionicons name="card-outline" size={20} color="#8B5CF6" />
            </View>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitle}>Incentives</Text>
              <Text style={styles.actionDesc}>Flex Credits and campaigns</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Plan Status */}
        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <View style={styles.planBadge}>
              <Ionicons name="diamond" size={16} color={Colors.accent} />
              <Text style={styles.planBadgeText}>{planLabel} Plan</Text>
            </View>
            {org?.trial_ends_at && (
              <Text style={styles.trialText}>
                Trial ends {new Date(org.trial_ends_at).toLocaleDateString()}
              </Text>
            )}
          </View>
          <Text style={styles.planDesc}>
            {org?.plan === "free"
              ? "Scout Basic: $29/month, up to 10 active users with basic matching."
              : org?.plan === "starter"
              ? "Momentum Growth: $49/month, includes 20 active users, then $2 per additional active user."
              : org?.plan === "business"
              ? "Pulse Business: $99/month, includes 100 active users, then $1.50 per additional active user."
              : "Orbit Enterprise includes SLA, guaranteed fallback rides, and custom integrations."}
          </Text>
          {(org?.plan === "free" || org?.plan === "starter") && (
            <TouchableOpacity
              style={styles.upgradeBtn}
              activeOpacity={0.7}
              onPress={() => router.push("/(admin)/settings")}
            >
              <Ionicons name="arrow-up-circle" size={18} color={Colors.textOnPrimary} />
              <Text style={styles.upgradeBtnText}>Upgrade Plan</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.base,
    paddingBottom: Spacing["5xl"],
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  errorText: {
    fontSize: FontSize.base,
    color: Colors.error,
    textAlign: "center",
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  retryBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primary,
  },
  retryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  dashboardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  orgLogoWrap: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  orgLogoImage: { width: "100%", height: "100%" },
  orgLogoPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  dashboardHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  orgTitle: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  orgMeta: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  dashboardKicker: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    flexWrap: "wrap",
  },
  networkTypeBadge: {
    borderRadius: BorderRadius.full,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
  },
  networkTypeBadgeManaged: {
    backgroundColor: Colors.primaryLight,
  },
  networkTypeBadgeCommunity: {
    backgroundColor: "#EFF6FF",
  },
  networkTypeBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  networkTypeBadgeTextManaged: {
    color: Colors.primaryDark,
  },
  networkTypeBadgeTextCommunity: {
    color: Colors.info,
  },
  sectionHeaderWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  sectionHeaderAccent: {
    width: 3,
    height: 28,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  sectionHeaderTextCol: {
    flex: 1,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  sectionHeaderTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  analyticsRow: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  analyticsItem: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  healthCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  healthBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  healthMuted: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 18,
    marginTop: Spacing.xs,
  },
  statCard: {
    width: "47%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  statTextCol: {
    flex: 1,
    minWidth: 0,
  },
  statValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    lineHeight: 22,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 1,
    fontWeight: FontWeight.medium,
  },
  statHint: {
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: 2,
    lineHeight: 12,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  actionCard: {
    width: "47%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  actionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  actionTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 2,
  },
  actionDesc: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.accentLight,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  planBadgeText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.accent,
  },
  trialText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
  planDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.base,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  upgradeBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  welcomeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  welcomeCard: {
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
    backgroundColor: Colors.surface,
    ...Shadow.lg,
  },
  welcomeGradient: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing.lg,
  },
  welcomeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  welcomeTitle: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
    letterSpacing: -0.3,
  },
  welcomeBody: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  welcomeHighlight: {
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
  },
  welcomeBold: {
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  welcomeActions: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  welcomePrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  welcomePrimaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  welcomeSecondaryBtn: {
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  welcomeSecondaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
});
