import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useDiscoverMapLayers } from "@/hooks/useDiscoverMapLayers";
import { DiscoverMapLayers } from "@/components/maps/DiscoverMapLayers";
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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
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

export default function Dashboard() {
  const router = useRouter();
  const { profile, refreshProfile, activeMode, toggleMode, rolePalette } = useAuth();
  const [org, setOrg] = useState<Organisation | null>(null);
  const [orgMemberCount, setOrgMemberCount] = useState(0);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const isFlexible = profile?.role === "both";
  const effectiveRole = isFlexible ? (activeMode ?? "both") : (profile?.role ?? "both");
  const showQuickActions = !isFlexible || activeMode != null;
  const quickDriver = isFlexible ? activeMode === "driver" : profile?.role === "driver";
  const quickPassenger = isFlexible ? activeMode === "passenger" : profile?.role === "passenger";
  const showPostRequest = quickPassenger || (!isFlexible && profile?.role === "driver");

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

  const { demandPoints, supplyPoints, routeLines } = useDiscoverMapLayers(profile ?? null);

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
      "You are not in a workplace network yet. You can mingle with other independents and nearby commuters.\n\nWhen an organisation on your email domain is set up, they can add you or send an invite code."
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
      "Community network: you share a pool with others on your work email domain. Discover starts with your network; you can widen scope to nearby commuters when you want.",
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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero header — background by explorer / workplace type */}
        <View
          style={[
            styles.heroHeader,
            !hasOrg && styles.heroExplorer,
            isEnterpriseOrg && styles.heroEnterprise,
            isCommunityOrg && styles.heroCommunity,
          ]}
        >
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.greeting,
                  !hasOrg && styles.heroGreetingExplorer,
                  isEnterpriseOrg && styles.heroGreetingEnterprise,
                  isCommunityOrg && styles.heroGreetingCommunity,
                ]}
              >
                {getGreeting()},
              </Text>
              <Text
                style={[
                  styles.name,
                  !hasOrg && styles.heroNameExplorer,
                  isEnterpriseOrg && styles.heroNameEnterprise,
                  isCommunityOrg && styles.heroNameCommunity,
                ]}
              >
                {firstName}
              </Text>
            </View>
            <TouchableOpacity style={styles.bellBtnHero} activeOpacity={0.75}>
              <Ionicons name="notifications-outline" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          {!hasOrg ? (
            <View style={styles.heroContextRow}>
              <View style={styles.heroContextLeft}>
                <View style={styles.heroBadgeIconWrap}>
                  <Ionicons name="compass-outline" size={20} color="#C2410C" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.heroContextTitle}>Independent explorer</Text>
                  <Text style={styles.heroContextHint} numberOfLines={2}>
                    Tap the info button for how workplace networks work.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.heroInfoBtn}
                onPress={showExplorerInfo}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="About independent commuting"
              >
                <Ionicons name="information-circle-outline" size={26} color="#9A3412" />
              </TouchableOpacity>
            </View>
          ) : isEnterpriseOrg ? (
            <View style={styles.heroContextRow}>
              <View style={styles.heroContextLeft}>
                <View style={styles.heroOrgLogoWrap}>
                  {orgLogoPublicUrl ? (
                    <Image source={{ uri: orgLogoPublicUrl }} style={styles.heroOrgLogo} />
                  ) : (
                    <View style={styles.heroOrgLogoPlaceholder}>
                      <Ionicons name="business" size={22} color={Colors.primaryDark} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.heroOrgNameEnterprise} numberOfLines={2}>
                    {org!.name}
                  </Text>
                  <Text style={styles.heroOrgSubEnterprise} numberOfLines={1}>
                    Workplace network
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.heroInfoBtn}
                onPress={showWorkplaceInfo}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Workplace details"
              >
                <Ionicons name="information-circle-outline" size={26} color={Colors.primaryDark} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.heroContextRow}>
              <View style={styles.heroContextLeft}>
                <View style={styles.heroOrgLogoWrap}>
                  {orgLogoPublicUrl ? (
                    <Image source={{ uri: orgLogoPublicUrl }} style={styles.heroOrgLogo} />
                  ) : (
                    <View style={[styles.heroOrgLogoPlaceholder, styles.heroOrgLogoPlaceholderCommunity]}>
                      <Ionicons name="people-outline" size={22} color={Colors.info} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.heroOrgNameCommunity} numberOfLines={2}>
                    {org!.name}
                  </Text>
                  <Text style={styles.heroOrgSubCommunity} numberOfLines={1}>
                    Community network
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.heroInfoBtn}
                onPress={showCommunityNetworkInfo}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Network details"
              >
                <Ionicons name="information-circle-outline" size={26} color={Colors.info} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Role badge + flexible mode toggle */}
        <View style={styles.roleWrap}>
          <View style={[styles.roleBadge, { backgroundColor: rolePalette.light, borderColor: rolePalette.border }]}>
            <Ionicons
              name={rolePalette.icon}
              size={16}
              color={rolePalette.primary}
            />
            <Text style={[styles.roleBadgeText, { color: rolePalette.text }]}>{roleBadgeLabel}</Text>
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
                Your Network
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
                Nearby Commuters
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats grid — value inline with icon, label below */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <View style={styles.statInlineRow}>
              <View style={[styles.statIcon, { backgroundColor: "#EFF6FF" }]}>
                <Ionicons name="star" size={20} color={Colors.info} />
              </View>
              <Text style={styles.statValue}>{profile?.points_balance ?? 0}</Text>
            </View>
            <Text style={styles.statLabel}>Points</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statInlineRow}>
              <View style={[styles.statIcon, { backgroundColor: Colors.accentLight }]}>
                <Ionicons name="flash" size={20} color={Colors.accent} />
              </View>
              <Text style={styles.statValue}>
                {profile?.flex_credits_balance ?? 3}
              </Text>
            </View>
            <Text style={styles.statLabel}>Flex Credits</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statInlineRow}>
              <View style={[styles.statIcon, { backgroundColor: Colors.primaryLight }]}>
                <Ionicons name="leaf" size={20} color={Colors.primary} />
              </View>
              <Text style={styles.statValue}>0</Text>
            </View>
            <Text style={styles.statLabel}>CO₂ saved (kg)</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statInlineRow}>
              <View style={[styles.statIcon, { backgroundColor: "#F3E8FF" }]}>
                <Ionicons name="car" size={20} color="#8B5CF6" />
              </View>
              <Text style={styles.statValue}>0</Text>
            </View>
            <Text style={styles.statLabel}>Total rides</Text>
          </View>
        </View>

        {/* Flexible mode toggle — only for 'both' role users */}
        {isFlexible && (
          <View style={[styles.modeToggleCard, { borderColor: rolePalette.border, backgroundColor: rolePalette.light }]}>
            <View style={styles.modeToggleHeader}>
              <Ionicons name="swap-horizontal" size={18} color={rolePalette.primary} />
              <Text style={[styles.modeToggleTitle, { color: rolePalette.text }]}>What are you doing today?</Text>
            </View>
            <View style={styles.modeToggleRow}>
              <TouchableOpacity
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor: activeMode === "driver"
                      ? RoleTheme.driver.primary
                      : Colors.surface,
                    borderColor: activeMode === "driver"
                      ? RoleTheme.driver.primary
                      : Colors.border,
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
                    backgroundColor: activeMode === "passenger"
                      ? RoleTheme.passenger.primary
                      : Colors.surface,
                    borderColor: activeMode === "passenger"
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
                Tap to declare your mode. Your commute matches will update instantly.
              </Text>
            )}
          </View>
        )}

        {/* Quick actions — hidden for Flexible until Driving or Riding is chosen */}
        {showQuickActions && (
          <>
            <Text style={styles.sectionTitle}>Quick actions</Text>
            <View style={styles.quickActions}>
              {quickDriver && (
                <TouchableOpacity
                  style={styles.actionCard}
                  activeOpacity={0.7}
                  onPress={() => router.push("/(tabs)/rides")}
                >
                  <View style={styles.actionTitleRow}>
                    <View style={[styles.actionIcon, { backgroundColor: Colors.primaryLight }]}>
                      <Ionicons name="add-circle" size={24} color={Colors.primary} />
                    </View>
                    <Text style={styles.actionTitle}>Offer a ride</Text>
                  </View>
                  <Text style={styles.actionDesc}>
                    Share your commute and earn points
                  </Text>
                </TouchableOpacity>
              )}
              {quickPassenger && (
                <TouchableOpacity
                  style={styles.actionCard}
                  activeOpacity={0.7}
                  onPress={() => router.push("/(tabs)/discover")}
                >
                  <View style={styles.actionTitleRow}>
                    <View style={[styles.actionIcon, { backgroundColor: "#EFF6FF" }]}>
                      <Ionicons name="search" size={24} color={Colors.info} />
                    </View>
                    <Text style={styles.actionTitle}>Find a ride</Text>
                  </View>
                  <Text style={styles.actionDesc}>
                    Match with a colleague nearby
                  </Text>
                </TouchableOpacity>
              )}
              {showPostRequest && (
                <TouchableOpacity
                  style={styles.actionCard}
                  activeOpacity={0.7}
                  onPress={() => router.push("/(tabs)/discover")}
                >
                  <View style={styles.actionTitleRow}>
                    <View style={[styles.actionIcon, { backgroundColor: "#F3E8FF" }]}>
                      <Ionicons name="megaphone-outline" size={24} color="#8B5CF6" />
                    </View>
                    <Text style={styles.actionTitle}>Post a request</Text>
                  </View>
                  <Text style={styles.actionDesc}>
                    Let drivers know you need a lift
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        {/* Profile completion */}
        <ProfileCompletion
          profile={profile}
          onEditProfile={() => router.push("/(tabs)/profile?edit=1")}
        />

        {org?.org_type === "community" && (
          <View style={[styles.shareLeaderCard, { borderColor: Colors.accent, backgroundColor: Colors.accentLight }]}>
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
            <TouchableOpacity style={styles.shareLeaderBtn} onPress={handleShareWithLeadership} activeOpacity={0.8}>
              <Ionicons name="share-social-outline" size={16} color="#FFFFFF" />
              <Text style={styles.shareLeaderBtnText}>Share with leadership</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Same demand/supply map as Discover — aggregate activity, not live GPS tracks */}
        <Text style={styles.sectionTitle}>Commute activity map</Text>
        <Text style={styles.mapSectionHint}>
          {effectiveRole === "driver" || (isFlexible && activeMode === "driver")
            ? "Green dots: drivers · Orange heat: riders looking for seats · Blue: route overlap"
            : effectiveRole === "passenger" || (isFlexible && activeMode === "passenger")
              ? "Orange heat: rider demand · Green: available drivers · Blue: shared corridors"
              : "Orange heat: rider demand · Green: drivers · Blue: route corridors — pick Driving or Riding above to tailor quick actions"}
        </Text>
        <DiscoverMapLayers
          demandGeoJson={demandPoints}
          supplyGeoJson={supplyPoints}
          routeGeoJson={routeLines}
          title="Network activity"
          mapHeight={200}
        />
        <TouchableOpacity
          style={styles.mapOpenDiscover}
          onPress={() => router.push("/(tabs)/discover")}
          activeOpacity={0.85}
        >
          <Text style={styles.mapOpenDiscoverText}>Open Discover for matches</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
        </TouchableOpacity>

        {/* How it works — only shown early */}
        <View style={styles.howItWorks}>
          <Text style={styles.howTitle}>How Poolyn works</Text>
          {[
            {
              icon: "location-outline" as const,
              text: "We match you with colleagues on similar routes",
            },
            {
              icon: "time-outline" as const,
              text: "Rides sync with your schedule automatically",
            },
            {
              icon: "shield-checkmark-outline" as const,
              text: "Only verified work emails. Your commute stays safe",
            },
            {
              icon: "flash-outline" as const,
              text: "Flex Credits mean no guilt when plans change",
            },
          ].map((item, i) => (
            <View key={i} style={styles.howRow}>
              <Ionicons name={item.icon} size={20} color={Colors.primary} />
              <Text style={styles.howText}>{item.text}</Text>
            </View>
          ))}
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
    paddingTop: Spacing.xs,
    paddingBottom: Spacing["5xl"],
  },
  heroHeader: {
    marginHorizontal: -Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    marginBottom: Spacing.lg,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
    borderWidth: 1,
    ...Shadow.sm,
  },
  heroExplorer: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FDBA74",
  },
  heroEnterprise: {
    backgroundColor: "#E8F5EE",
    borderColor: "#A7E3C7",
  },
  heroCommunity: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  greeting: { fontSize: FontSize.base, color: Colors.textSecondary },
  heroGreetingExplorer: { color: "#A16207" },
  heroGreetingEnterprise: { color: "#166534" },
  heroGreetingCommunity: { color: "#475569" },
  name: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  heroNameExplorer: { color: "#7C2D12" },
  heroNameEnterprise: { color: "#14532D" },
  heroNameCommunity: { color: "#0F172A" },
  bellBtnHero: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.92)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  heroContextRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  heroContextLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    minWidth: 0,
  },
  heroBadgeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFEDD5",
    borderWidth: 1,
    borderColor: "#FDBA74",
    justifyContent: "center",
    alignItems: "center",
  },
  heroContextTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: "#9A3412",
  },
  heroContextHint: {
    fontSize: FontSize.xs,
    color: "#A16207",
    marginTop: 2,
    lineHeight: 16,
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
  heroOrgNameEnterprise: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: "#14532D",
    letterSpacing: -0.2,
  },
  heroOrgSubEnterprise: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: "#166534",
    marginTop: 2,
  },
  heroOrgNameCommunity: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  heroOrgSubCommunity: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: "#2563EB",
    marginTop: 2,
  },
  heroInfoBtn: {
    padding: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  roleWrap: {
    marginBottom: Spacing.xl,
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
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  statCard: {
    width: "47%",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  statInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  statValue: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 16,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
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
  mapSectionHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
    marginTop: -Spacing.sm,
  },
  mapOpenDiscover: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  mapOpenDiscoverText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  howItWorks: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  howTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  howRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  howText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  // ── Flexible mode toggle ─────────────────────────────────
  modeToggleCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    padding: Spacing.base,
    marginBottom: Spacing.xl,
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
