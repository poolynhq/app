import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminCommuterSwitch } from "@/hooks/useAdminCommuterSwitch";
import { supabase } from "@/lib/supabase";
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

export default function AdminSettings() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const goCommuter = useAdminCommuterSwitch();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoAssign, setAutoAssign] = useState(false);
  const [allowCrossOrg, setAllowCrossOrg] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const fetchOrg = useCallback(async () => {
    if (!profile?.org_id) return;
    try {
      setError(null);
      const { data, error: err } = await supabase
        .from("organisations")
        .select("*")
        .eq("id", profile.org_id)
        .single();

      if (err) throw err;
      setOrg(data);
      const settings = (data?.settings ?? {}) as Record<string, unknown>;
      setAutoAssign(Boolean(settings.auto_assign_driver));
      setAllowCrossOrg(data?.allow_cross_org === true);
    } catch (e: any) {
      setError(e.message ?? "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [profile?.org_id]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  function handleSignOut() {
    showAlert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
        },
      },
    ]);
  }

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
          <TouchableOpacity style={styles.retryBtn} onPress={fetchOrg}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const planLabel = PLAN_LABELS[org?.plan ?? "free"] ?? "Free";

  async function handleAutoAssignToggle(value: boolean) {
    if (!org?.id) return;
    setAutoAssign(value);
    const existingSettings = (org.settings ?? {}) as Record<string, unknown>;
    const nextSettings = { ...existingSettings, auto_assign_driver: value };
    const { error: updateError } = await supabase
      .from("organisations")
      .update({ settings: nextSettings })
      .eq("id", org.id);
    if (!updateError) {
      setOrg((prev) => (prev ? { ...prev, settings: nextSettings } : prev));
    }
  }

  async function handleAllowCrossOrgToggle(value: boolean) {
    if (!org?.id || profile?.org_role !== "admin") return;
    setAllowCrossOrg(value);
    const { error: updateError } = await supabase
      .from("organisations")
      .update({ allow_cross_org: value })
      .eq("id", org.id);
    if (!updateError) {
      setOrg((prev) => (prev ? { ...prev, allow_cross_org: value } : prev));
    } else {
      setAllowCrossOrg(!value);
      showAlert("Could not update", updateError.message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Settings</Text>

        {/* Organisation Info */}
        <Text style={styles.sectionTitle}>ORGANISATION</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="business" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Organisation Name</Text>
              <Text style={styles.infoValue}>
                {org?.name ?? "Unknown"}
              </Text>
            </View>
          </View>

          <View style={styles.infoDivider} />

          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="globe-outline" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Domain</Text>
              <Text style={styles.infoValue}>
                {org?.domain ?? "None"}
              </Text>
            </View>
          </View>

          <View style={styles.infoDivider} />

          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="diamond-outline" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Current Plan</Text>
              <Text style={styles.infoValue}>{planLabel}</Text>
            </View>
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>{planLabel}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>ADMIN</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="shield-checkmark" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Your role</Text>
              <Text style={styles.infoValue}>
                {profile?.org_role === "admin" ? "Network admin" : "Member"}
              </Text>
            </View>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <View style={styles.infoIconWrap}>
              <Ionicons name="mail-outline" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Signed in as</Text>
              <Text style={styles.infoValue}>{profile?.email ?? "None"}</Text>
            </View>
          </View>
          <View style={styles.infoDivider} />
          <TouchableOpacity
            style={styles.adminMenuItem}
            activeOpacity={0.6}
            onPress={goCommuter}
          >
            <Ionicons name="swap-horizontal" size={22} color={Colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Switch to commuter view</Text>
              <Text style={styles.menuSubLabel}>
                {!profile?.onboarding_completed
                  ? "You will complete commuter onboarding first (vehicle, route, schedule), or finish later in Profile."
                  : "Same account. Use the member app and pools."}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
          {profile?.org_role === "admin" ? (
            <>
              <View style={styles.infoDivider} />
              <TouchableOpacity
                style={styles.adminMenuItem}
                activeOpacity={0.6}
                onPress={() => router.push("/(admin)/transfer-admin")}
              >
                <Ionicons name="arrow-redo-outline" size={22} color={Colors.text} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>Transfer admin</Text>
                  <Text style={styles.menuSubLabel}>
                    Choose another member from your network list
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>MATCHING</Text>
        <View style={styles.menuCard}>
          {profile?.org_role === "admin" ? (
            <>
              <View style={styles.menuItem}>
                <Ionicons name="git-network-outline" size={22} color={Colors.text} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>Allow cross-network commuting</Text>
                  <Text style={styles.menuSubLabel}>
                    When off, members only match carpools within your organisation (stricter safety). When on,
                    drivers may opt in to see compatible commuters outside the network if they enable it on Home.
                  </Text>
                </View>
                <Switch
                  value={allowCrossOrg}
                  onValueChange={(v) => void handleAllowCrossOrgToggle(v)}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={allowCrossOrg ? Colors.primary : Colors.surface}
                />
              </View>
              <View style={styles.menuDivider} />
            </>
          ) : null}
          <View style={styles.menuItem}>
            <Ionicons name="shuffle-outline" size={22} color={Colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={styles.menuLabel}>Enable auto-assign driver</Text>
              <Text style={styles.menuSubLabel}>
                Uses reliability and participation for fair rotation
              </Text>
            </View>
            <Switch
              value={autoAssign}
              onValueChange={handleAutoAssignToggle}
              trackColor={{ false: Colors.border, true: Colors.primaryLight }}
              thumbColor={autoAssign ? Colors.primary : Colors.surface}
            />
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={[styles.signOutBtn, signingOut && { opacity: 0.6 }]}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={22} color={Colors.error} />
          <Text style={styles.signOutText}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </TouchableOpacity>

        {/* Version */}
        <Text style={styles.version}>Poolyn v0.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.base,
    paddingBottom: Spacing["4xl"],
  },
  heading: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.base,
    gap: Spacing.md,
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: Colors.text,
    marginTop: 1,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginHorizontal: Spacing.base,
  },
  planBadge: {
    backgroundColor: Colors.accentLight,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  planBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.accent,
  },
  menuCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.base,
    gap: Spacing.md,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginHorizontal: Spacing.base,
  },
  adminMenuItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    gap: Spacing.md,
  },
  menuLabel: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  menuSubLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.base,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.errorLight,
    backgroundColor: Colors.errorLight,
  },
  signOutText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.error,
  },
  version: {
    textAlign: "center",
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xl,
  },
});
