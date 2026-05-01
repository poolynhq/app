import { useCallback, useEffect, useMemo, useState } from "react";
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
  Platform,
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
import * as ImagePicker from "expo-image-picker";
import { logoObjectNameAndContentType, storageUploadBody } from "@/lib/storageImageMeta";
import {
  getOrganisationLogoPublicUrl,
  organisationSettingsRecord,
  uploadOrganisationLogoObject,
} from "@/lib/orgLogo";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { ORG_PLAN_LABELS } from "@/lib/orgPlanLabels";
import { OrgAdminCorridorsMap } from "@/components/admin/OrgAdminCorridorsMap";

const EMPTY_CORRIDOR_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function isFeatureCollection(x: unknown): x is GeoJSON.FeatureCollection {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as GeoJSON.FeatureCollection).type === "FeatureCollection" &&
    Array.isArray((x as GeoJSON.FeatureCollection).features)
  );
}

function parseWorkCentroidJson(x: unknown): { lng: number; lat: number } | null {
  if (x == null || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const lng = Number(o.lng);
  const lat = Number(o.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

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

function SectionHeader({
  eyebrow,
  title,
  onInfoPress,
  infoAccessibilityLabel,
}: {
  eyebrow: string;
  title: string;
  onInfoPress?: () => void;
  infoAccessibilityLabel?: string;
}) {
  return (
    <View style={styles.sectionHeaderWrap}>
      <View style={styles.sectionHeaderAccent} />
      <View style={styles.sectionHeaderBody}>
        <View style={styles.sectionHeaderTextCol}>
          <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
          <Text style={styles.sectionHeaderTitle}>{title}</Text>
        </View>
        {onInfoPress ? (
          <InlineInfoButton
            onPress={onInfoPress}
            accessibilityLabel={infoAccessibilityLabel ?? "More information"}
          />
        ) : null}
      </View>
    </View>
  );
}

function InlineInfoButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name="information-circle-outline" size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function AdminOverview() {
  const { profile, session } = useAuth();
  const router = useRouter();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  /** Same email domain as org, not in the workplace network (explorers). */
  const [domainExplorersCount, setDomainExplorersCount] = useState(0);
  /** Pooled org trips this calendar month (same basis as CO₂ in get_org_analytics_summary). */
  const [esgPooledTripsMonth, setEsgPooledTripsMonth] = useState(0);
  const [esgReportMonthLabel, setEsgReportMonthLabel] = useState("");
  /** Members with ride/request activity this calendar month (billing / engagement). */
  const [monthlyActiveCommuters, setMonthlyActiveCommuters] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [scheduledRides, setScheduledRides] = useState(0);
  const [co2Saved, setCo2Saved] = useState(0);
  const [overageUsers, setOverageUsers] = useState(0);
  const [overageCost, setOverageCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdminWelcome, setShowAdminWelcome] = useState(false);
  /** PostGIS clusters from member home_location (RPC). */
  const [autoCorridors, setAutoCorridors] = useState<
    {
      clusterId: number;
      name: string;
      memberCount: number;
      subtitle: string;
      centroidLng?: number;
      centroidLat?: number;
    }[]
  >([]);
  const [corridorHomesGeo, setCorridorHomesGeo] =
    useState<GeoJSON.FeatureCollection>(EMPTY_CORRIDOR_FC);
  const [corridorAxesGeo, setCorridorAxesGeo] =
    useState<GeoJSON.FeatureCollection>(EMPTY_CORRIDOR_FC);
  const [corridorWorkCentroid, setCorridorWorkCentroid] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  /** Poolyn Crews linked to org_id (Crew Poolyn on Home). */
  const [orgCrews, setOrgCrews] = useState<{ id: string; name: string; memberCount: number }[]>([]);
  const [logoUploading, setLogoUploading] = useState(false);

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

      const [orgRes, membersListRes, dashRes, crewSummaryRes, autoCorridorsRes] = await Promise.all([
        supabase.from("organisations").select("*").eq("id", profile.org_id).single(),
        supabase
          .from("user_org_memberships")
          .select("id")
          .eq("organisation_id", profile.org_id),
        supabase.rpc("poolyn_org_admin_dashboard_stats", { p_org_id: profile.org_id }),
        supabase.rpc("poolyn_org_admin_crew_summary", { p_org_id: profile.org_id }),
        supabase.rpc("poolyn_org_auto_route_corridors", { p_org_id: profile.org_id }),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (membersListRes.error) throw membersListRes.error;

      if (crewSummaryRes.error) {
        if (__DEV__) {
          console.warn("[admin overview] poolyn_org_admin_crew_summary", crewSummaryRes.error.message);
        }
        setOrgCrews([]);
      } else {
        const crewRows = (crewSummaryRes.data ?? []) as Array<{
          crew_id: string;
          crew_name: string;
          member_count: number | string;
        }>;
        setOrgCrews(
          crewRows.map((r) => ({
            id: r.crew_id,
            name: r.crew_name,
            memberCount: Number(r.member_count ?? 0),
          }))
        );
      }

      if (autoCorridorsRes.error) {
        if (__DEV__) {
          console.warn("[admin overview] poolyn_org_auto_route_corridors", autoCorridorsRes.error.message);
        }
        setAutoCorridors([]);
        setCorridorHomesGeo(EMPTY_CORRIDOR_FC);
        setCorridorAxesGeo(EMPTY_CORRIDOR_FC);
        setCorridorWorkCentroid(null);
      } else {
        let raw: unknown = autoCorridorsRes.data;
        if (typeof raw === "string") {
          try {
            raw = JSON.parse(raw) as unknown;
          } catch {
            raw = null;
          }
        }
        const mapRow = (row: Record<string, unknown>) => {
          const clng = Number(row.centroid_lng);
          const clat = Number(row.centroid_lat);
          return {
            clusterId: Number(row.cluster_id ?? 0),
            name: String(row.name ?? "Corridor"),
            memberCount: Math.floor(Number(row.member_count ?? 0)),
            subtitle: String(row.subtitle ?? ""),
            ...(Number.isFinite(clng) && Number.isFinite(clat)
              ? { centroidLng: clng, centroidLat: clat }
              : {}),
          };
        };
        const arr = Array.isArray(raw) ? raw : null;
        if (arr) {
          setAutoCorridors(arr.map((row: Record<string, unknown>) => mapRow(row)));
          setCorridorHomesGeo(EMPTY_CORRIDOR_FC);
          setCorridorAxesGeo(EMPTY_CORRIDOR_FC);
          setCorridorWorkCentroid(null);
        } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const o = raw as Record<string, unknown>;
          const list = Array.isArray(o.corridors) ? o.corridors : [];
          setAutoCorridors(
            (list as Record<string, unknown>[]).map((row) => mapRow(row))
          );
          setCorridorHomesGeo(
            isFeatureCollection(o.homes_geojson) ? o.homes_geojson : EMPTY_CORRIDOR_FC
          );
          setCorridorAxesGeo(
            isFeatureCollection(o.axis_lines_geojson) ? o.axis_lines_geojson : EMPTY_CORRIDOR_FC
          );
          setCorridorWorkCentroid(parseWorkCentroidJson(o.work_centroid));
        } else {
          setAutoCorridors([]);
          setCorridorHomesGeo(EMPTY_CORRIDOR_FC);
          setCorridorAxesGeo(EMPTY_CORRIDOR_FC);
          setCorridorWorkCentroid(null);
        }
      }

      const memberRows = membersListRes.data ?? [];
      if (__DEV__ && dashRes.error) {
        console.warn("[admin overview] poolyn_org_admin_dashboard_stats", dashRes.error.message);
      }
      const dashPayload = !dashRes.error ? parseDashboardRpcPayload(dashRes.data) : null;

      // Prefer same-org list from PostgREST when RLS returns rows (matches Members tab).
      // Use SECURITY DEFINER RPC counts when the client list is empty (RLS gap, etc.).
      let memberCountVal = memberRows.length;
      let domainExplorersVal = Number(dashPayload?.domain_explorers_count ?? 0);
      let monthlyCommutersVal = 0;

      if (dashPayload) {
        monthlyCommutersVal = Number(dashPayload.monthly_active_commuters ?? 0);
        if (memberRows.length === 0) {
          memberCountVal = Number(dashPayload.total_members ?? 0);
        }
      } else {
        const { data: mauData } = await supabase.rpc("org_active_user_count", {
          target_org_id: profile.org_id,
        });
        monthlyCommutersVal = typeof mauData === "number" ? mauData : 0;
      }

      if (__DEV__) {
        if (memberRows.length === 0 && memberCountVal > 0) {
          console.warn(
            "[admin overview] member list empty but RPC reports",
            memberCountVal,
            "; check org_id",
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
      setPendingRequests(Math.floor(Number(analytics.pending_requests ?? 0)));
      setScheduledRides(Math.floor(Number(analytics.scheduled_rides ?? 0)));
      setEsgPooledTripsMonth(Math.floor(Number(analytics.total_rides ?? 0)));
      setCo2Saved(Number(analytics.co2_saved_kg ?? 0));
      setOverageUsers(Number(usage.overage_users ?? 0));
      setOverageCost(Number(usage.estimated_overage_cost ?? 0));
      try {
        const d = new Date(`${monthRef}T12:00:00`);
        setEsgReportMonthLabel(d.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
      } catch {
        setEsgReportMonthLabel("");
      }
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

  const handleChangeOrgLogo = useCallback(async () => {
    if (profile?.org_role !== "admin" || !profile.org_id || !org?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      showAlert("Photo access", "Allow photo library access to upload your company logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;
    setLogoUploading(true);
    try {
      const response = await fetch(uri);
      if (!response.ok) {
        showAlert("Upload failed", `Could not read image (HTTP ${response.status}).`);
        return;
      }
      const buf = await response.arrayBuffer();
      const { objectName, contentType } = logoObjectNameAndContentType(
        uri,
        response.headers.get("content-type"),
        buf
      );
      const path = `${org.id}/${objectName}`;
      const fileBody = storageUploadBody(buf, contentType);
      const { error: uploadError } = await uploadOrganisationLogoObject(path, fileBody, {
        contentType,
      });
      if (uploadError) {
        showAlert("Upload failed", uploadError.message);
        return;
      }
      const nextSettings = { ...organisationSettingsRecord(org.settings), logo_path: path };
      const { error: metaErr } = await supabase
        .from("organisations")
        .update({ settings: nextSettings })
        .eq("id", org.id);
      if (metaErr) {
        showAlert("Save failed", metaErr.message);
        return;
      }
      setOrg((prev) => {
        const base = prev ?? org;
        return base ? { ...base, settings: nextSettings } : prev;
      });
      showAlert("Logo updated", "Members see this on Home and Profile when they open company details.");
    } catch (e) {
      showAlert("Upload failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLogoUploading(false);
    }
  }, [profile?.org_role, profile?.org_id, org?.id, org?.settings]);

  const corridorMapFallbackCenter = useMemo((): [number, number] => {
    const c = autoCorridors.find(
      (x) => x.centroidLng != null && x.centroidLat != null
    );
    return c?.centroidLng != null && c.centroidLat != null
      ? [c.centroidLng, c.centroidLat]
      : [138.6, -34.85];
  }, [autoCorridors]);

  const corridorMapEmptyHint = useMemo(() => {
    const noGeo =
      corridorHomesGeo.features.length === 0 &&
      corridorAxesGeo.features.length === 0 &&
      corridorWorkCentroid == null;
    if (autoCorridors.length > 0 && noGeo) {
      return "Corridor names are showing, but map layers need the latest Poolyn database migration (corridors with GeoJSON). Apply pending Supabase migrations, then refresh.";
    }
    return undefined;
  }, [autoCorridors, corridorHomesGeo, corridorAxesGeo, corridorWorkCentroid]);

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

  const planLabel = ORG_PLAN_LABELS[org?.plan ?? "free"] ?? "Plan";
  const isManagedNetwork = org?.org_type === "enterprise";
  const demandSupplyDelta = pendingRequests - scheduledRides;

  const orgLogoPublicUrl = getOrganisationLogoPublicUrl(org);
  const adminCanEditLogo = profile?.org_role === "admin" && !!org?.id;

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

  function explainDomainExplorers() {
    showAlert(
      "Domain explorers",
      "People who verified a company email on your domain but are not members of this network yet. Open Join requests to invite them."
    );
  }

  function explainRouteGroups() {
    showAlert(
      "Commute corridors on this screen",
      "Poolyn assigns these from member geography only. We group people who saved a home pin and finished onboarding. Homes within about 10 km land in the same cluster. When enough people saved a workplace pin, clusters are named by compass direction from that workplace centroid.\n\nThe map shows home density (heatmap), a straight axis from the combined workplace centroid to each cluster (not turn-by-turn routing), and a blue workplace dot when work pins exist.\n\nMembers find who is near them on Home and form Poolyn Crews there. The crew list below is separate from these clusters."
    );
  }

  function explainOrgCrewsOnDashboard() {
    showAlert(
      "Poolyn Crews (this list)",
      "Carpool crews linked to your workplace when someone creates a crew while signed in with this organisation. Each line is one crew and how many people are in it."
    );
  }

  function explainEsgSnapshot() {
    showAlert(
      "ESG snapshot (this month)",
      "Pooled trips counts scheduled, active, and completed Poolyn rides in the calendar month where the driver belongs to your organisation.\n\nEstimated CO₂ avoided uses 2.3 kg per pooled trip for internal reporting. Adjust factors in your formal ESG process if your auditor requires a different emissions model."
    );
  }

  function explainMonthlyActive() {
    showAlert(
      "Active members (this month)",
      "Count of people in your org who drove, rode, or sent a ride request during the current calendar month. Plan limits use this count. It does not include domain explorers, who are not network members yet."
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
        contentContainerStyle={[styles.content, Platform.OS === "web" && styles.contentWebDesktop]}
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
        {/* Header: company first; dashboard title secondary */}
        <View style={styles.dashboardHeader}>
          <TouchableOpacity
            style={styles.orgLogoOuter}
            activeOpacity={adminCanEditLogo ? 0.82 : 1}
            onPress={adminCanEditLogo ? () => void handleChangeOrgLogo() : undefined}
            disabled={!adminCanEditLogo || logoUploading}
            accessibilityRole={adminCanEditLogo ? "button" : "image"}
            accessibilityLabel={adminCanEditLogo ? "Change company logo" : "Company logo"}
          >
            <View style={styles.orgLogoClip}>
              {orgLogoPublicUrl ? (
                <Image source={{ uri: orgLogoPublicUrl }} style={styles.orgLogoImage} />
              ) : (
                <View style={styles.orgLogoPlaceholder}>
                  <Ionicons name="business" size={28} color={Colors.textTertiary} />
                </View>
              )}
              {logoUploading ? (
                <View style={styles.orgLogoUploading}>
                  <ActivityIndicator color={Colors.primary} />
                </View>
              ) : null}
            </View>
            {adminCanEditLogo && !logoUploading ? (
              <View style={styles.orgLogoEditBadge} pointerEvents="none">
                <Ionicons name="camera" size={12} color={Colors.textOnPrimary} />
              </View>
            ) : null}
          </TouchableOpacity>
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
          <View style={[styles.statCard, styles.statCardSplit]}>
            <TouchableOpacity
              style={styles.statCardSplitMain}
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
                <Text style={styles.statHint}>Same domain, not on the network yet</Text>
              </View>
            </TouchableOpacity>
            <InlineInfoButton
              onPress={explainDomainExplorers}
              accessibilityLabel="What are domain explorers?"
            />
          </View>
        </View>

        <SectionHeader
          eyebrow="ESG"
          title="Environmental snapshot"
          onInfoPress={explainEsgSnapshot}
          infoAccessibilityLabel="How ESG numbers are calculated"
        />
        {esgReportMonthLabel ? (
          <Text style={styles.esgMonthLine}>{esgReportMonthLabel}</Text>
        ) : null}
        <View style={styles.analyticsRow}>
          <View style={styles.analyticsCell}>
            <Text style={styles.analyticsValue}>{esgPooledTripsMonth}</Text>
            <Text style={styles.analyticsLabel}>Pooled trips</Text>
          </View>
          <View style={styles.analyticsCell}>
            <Text style={styles.analyticsValue}>
              {co2Saved.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </Text>
            <Text style={styles.analyticsLabel}>Est. CO₂ avoided (kg)</Text>
          </View>
        </View>

        <SectionHeader
          eyebrow="Route planning"
          title="Commute corridors"
          onInfoPress={explainRouteGroups}
          infoAccessibilityLabel="How corridors are built"
        />
        <View style={styles.healthCard}>
          {autoCorridors.length > 0 ? (
            <>
              <Text style={styles.healthMuted}>Assigned automatically from member home locations.</Text>
              <OrgAdminCorridorsMap
                homesGeoJson={corridorHomesGeo}
                axisLinesGeoJson={corridorAxesGeo}
                workCentroid={corridorWorkCentroid}
                mapHeight={260}
                fallbackCenter={corridorMapFallbackCenter}
                emptyGeometryHint={corridorMapEmptyHint}
              />
              <View style={styles.corridorList}>
                {autoCorridors.map((c) => (
                  <View key={`auto-${c.clusterId}`}>
                    <Text style={styles.healthBody}>
                      {c.name}: {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    </Text>
                    {c.subtitle ? <Text style={styles.corridorSubtitle}>{c.subtitle}</Text> : null}
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.healthBody}>
              No corridors yet. Members need a saved home location and completed onboarding to appear in clusters.
            </Text>
          )}
        </View>

        <SectionHeader
          eyebrow="Carpool crews"
          title="Poolyn Crews (this organisation)"
          onInfoPress={explainOrgCrewsOnDashboard}
          infoAccessibilityLabel="What are Poolyn Crews on the dashboard?"
        />
        <View style={[styles.healthCard, { marginBottom: Spacing.sm }]}>
          {orgCrews.length === 0 ? (
            <Text style={styles.healthBody}>
              No crews linked to this organisation yet. Crews created from Home (Crew Poolyn) while on this
              workplace account are listed here with member counts.
            </Text>
          ) : (
            <>
              <Text style={styles.healthMuted}>Workplace-linked crews from Home.</Text>
              {orgCrews.map((c) => (
                <Text key={c.id} style={[styles.healthBody, { marginTop: Spacing.sm }]}>
                  {c.name}: {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                </Text>
              ))}
            </>
          )}
        </View>

        <SectionHeader eyebrow="Live signals" title="Network health" />
        <View style={styles.healthCard}>
          <Text style={styles.healthBody}>
            {pendingRequests} open requests · {scheduledRides} scheduled rides
          </Text>
          <Text style={styles.healthMuted}>
            {demandSupplyDelta > 0
              ? `${demandSupplyDelta} more seats needed on busy routes.`
              : "Supply is keeping pace with demand."}
          </Text>
        </View>

        <SectionHeader eyebrow="Billing" title="Plan usage & monetization" />
        <View style={styles.healthCard}>
          <View style={styles.healthInlineRow}>
            <Text style={[styles.healthBody, styles.healthInlineText]}>
              Active this month: {monthlyActiveCommuters}
            </Text>
            <InlineInfoButton
              onPress={explainMonthlyActive}
              accessibilityLabel="How active members are counted"
            />
          </View>
          <Text style={[styles.healthBody, { marginTop: Spacing.sm }]}>
            Overage: {overageUsers} · Est. ${overageCost.toFixed(2)}
          </Text>
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
              ? "Pool pilot: up to 10 active members; core matching."
              : org?.plan === "starter"
              ? "MergeLane: $49/mo, 20 members included, $2 per extra member."
              : org?.plan === "business"
              ? "Convoy Run: $99/mo, 100 members included, $1.50 per extra member, full admin."
              : "Orbit Enterprise: SLA, custom member counts, integrations."}
          </Text>
          {org?.plan !== "enterprise" && (
            <TouchableOpacity
              style={styles.upgradeBtn}
              activeOpacity={0.7}
              onPress={() => router.push("/(admin)/org-paywall?intent=upgrade")}
            >
              <Ionicons name="arrow-up-circle" size={18} color={Colors.textOnPrimary} />
              <Text style={styles.upgradeBtnText}>Upgrade plan</Text>
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
  /** Readable line length and map width on desktop browsers (org dashboard is web-first). */
  contentWebDesktop: {
    maxWidth: 960,
    width: "100%",
    alignSelf: "center",
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
  orgLogoOuter: {
    width: 64,
    height: 64,
    flexShrink: 0,
    position: "relative",
  },
  orgLogoClip: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  orgLogoImage: { width: "100%", height: "100%" },
  orgLogoPlaceholder: {
    flex: 1,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  orgLogoUploading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.72)",
    justifyContent: "center",
    alignItems: "center",
  },
  orgLogoEditBadge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: Colors.surface,
    ...Shadow.sm,
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
    alignItems: "flex-start",
    gap: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  sectionHeaderAccent: {
    width: 3,
    height: 28,
    borderRadius: 2,
    backgroundColor: Colors.primary,
    marginTop: 2,
  },
  sectionHeaderBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    minWidth: 0,
  },
  sectionHeaderTextCol: {
    flex: 1,
    minWidth: 0,
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
  esgMonthLine: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: -2,
  },
  analyticsRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  analyticsCell: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  analyticsValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  analyticsLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: "center",
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
  healthInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  healthInlineText: {
    flex: 1,
    minWidth: 0,
  },
  corridorList: {
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  corridorSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 16,
    marginTop: 2,
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
  statCardSplit: {
    alignItems: "flex-start",
    paddingRight: Spacing.xs,
  },
  statCardSplitMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minWidth: 0,
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
