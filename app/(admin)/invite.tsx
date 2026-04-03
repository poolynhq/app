import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Share,
  Switch,
  RefreshControl,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { orgRequiresFullActivationPaywall, orgStatusIsGrace } from "@/lib/orgNetworkUi";
import { GraceNetworkBanner } from "@/components/GraceNetworkBanner";
import { Organisation } from "@/types/database";
import { OrgPaywallScreen } from "@/components/OrgPaywallScreen";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export default function InviteManagement() {
  const { profile, refreshProfile } = useAuth();
  const router = useRouter();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e: any) {
      setError(e.message ?? "Failed to load organisation");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.org_id]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchOrg();
  }, [fetchOrg]);

  const inviteCode = org?.invite_code ?? "";
  const inviteLink = `https://poolyn.app/join?code=${inviteCode}`;

  async function handleCopy() {
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    try {
      await Share.share({
        message: `Join our team on Poolyn! Use this link to sign up: ${inviteLink}`,
      });
    } catch {
      // user cancelled
    }
  }

  async function handleToggleActive(newValue: boolean) {
    if (!profile?.org_id) return;
    setToggling(true);
    try {
      const { error: err } = await supabase
        .from("organisations")
        .update({ invite_code_active: newValue })
        .eq("id", profile.org_id);

      if (err) throw err;
      setOrg((prev) => (prev ? { ...prev, invite_code_active: newValue } : prev));
    } catch (e: any) {
      showAlert("Error", e.message ?? "Failed to update invite status");
    } finally {
      setToggling(false);
    }
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

  if (org && orgRequiresFullActivationPaywall(org.status)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <OrgPaywallScreen
          organisationStatus={org.status}
          onActivateNetwork={() => {
            showAlert(
              "Activate network",
              "Stripe checkout is not wired in this build yet. When billing is live, this opens activation."
            );
          }}
          onContinueAsIndividual={async () => {
            await refreshProfile();
            router.replace("/(tabs)");
          }}
        />
      </SafeAreaView>
    );
  }

  const graceLocked = !!(org && orgStatusIsGrace(org.status));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
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
        <Text style={styles.heading}>Grow Your Network</Text>
        <Text style={styles.subtitle}>
          Share your invite code so colleagues can join your managed network.
        </Text>

        <GraceNetworkBanner orgStatus={org?.status} />

        {/* Invite Code Card */}
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>YOUR INVITE CODE</Text>
          <Text style={styles.codeValue}>
            {inviteCode || "No code available"}
          </Text>
          {!org?.invite_code_active && (
            <View style={styles.disabledBanner}>
              <Ionicons name="pause-circle" size={16} color={Colors.textTertiary} />
              <Text style={styles.disabledText}>Invites are currently paused</Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.copyBtn]}
            onPress={handleCopy}
            activeOpacity={0.7}
            disabled={graceLocked || !inviteCode}
          >
            <Ionicons
              name={copied ? "checkmark-circle" : "copy-outline"}
              size={20}
              color={Colors.textOnPrimary}
            />
            <Text style={styles.actionBtnText}>
              {copied ? "Copied!" : "Copy Invite Link"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.shareBtn]}
            onPress={handleShare}
            activeOpacity={0.7}
            disabled={graceLocked || !inviteCode}
          >
            <Ionicons name="share-outline" size={20} color={Colors.primary} />
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Toggle */}
        <View style={styles.toggleCard}>
          <View style={styles.toggleLeft}>
            <Ionicons
              name={org?.invite_code_active ? "checkmark-circle" : "pause-circle"}
              size={22}
              color={org?.invite_code_active ? Colors.success : Colors.textTertiary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Accept new members</Text>
              <Text style={styles.toggleDesc}>
                {org?.invite_code_active
                  ? "New members can join using the invite code"
                  : "Invite code is paused. No new members can join."}
              </Text>
            </View>
          </View>
          <Switch
            value={org?.invite_code_active ?? false}
            onValueChange={handleToggleActive}
            disabled={graceLocked || toggling}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={org?.invite_code_active ? Colors.primary : Colors.surface}
          />
        </View>

        {/* How it works */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>How invite links work</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoBullet}>
              <Text style={styles.infoBulletText}>1</Text>
            </View>
            <Text style={styles.infoText}>
              Share the invite link with your team members
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoBullet}>
              <Text style={styles.infoBulletText}>2</Text>
            </View>
            <Text style={styles.infoText}>
              They sign up with their work email and enter the code
            </Text>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoBullet}>
              <Text style={styles.infoBulletText}>3</Text>
            </View>
            <Text style={styles.infoText}>
              They&apos;re automatically added to your organisation
            </Text>
          </View>
        </View>

        {/* Regenerate note */}
        <View style={styles.noteCard}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={Colors.textSecondary}
          />
          <Text style={styles.noteText}>
            Need a new invite code? Contact support to regenerate your
            organisation&apos;s invite code.
          </Text>
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
  heading: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  codeCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    marginBottom: Spacing.base,
    ...Shadow.sm,
  },
  codeLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  codeValue: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    fontFamily: "monospace",
    letterSpacing: 4,
  },
  disabledBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    backgroundColor: Colors.borderLight,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  disabledText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    fontWeight: FontWeight.medium,
  },
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  copyBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
  },
  actionBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  shareBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shareBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  toggleCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
    ...Shadow.sm,
  },
  toggleLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginRight: Spacing.md,
  },
  toggleTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 2,
  },
  toggleDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  infoTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  infoBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  infoBulletText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  infoText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
  },
  noteText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
