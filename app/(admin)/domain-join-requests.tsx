import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OrgPaywallScreen } from "@/components/OrgPaywallScreen";
import { supabase } from "@/lib/supabase";
import { orgRequiresFullActivationPaywall, orgStatusIsGrace } from "@/lib/orgNetworkUi";
import { GraceNetworkBanner } from "@/components/GraceNetworkBanner";
import { resolveAvatarDisplayUrl } from "@/lib/avatarStorage";
import { useAuth } from "@/contexts/AuthContext";
import { showAlert } from "@/lib/platformAlert";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import type { Organisation } from "@/types/database";

type ExplorerRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
};

export default function DomainJoinRequestsScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orgRow, setOrgRow] = useState<Organisation | null>(null);
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.org_id) {
      setRows([]);
      setOrgRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: orgData } = await supabase
      .from("organisations")
      .select("*")
      .eq("id", profile.org_id)
      .single();
    setOrgRow(orgData as Organisation | null);

    const { data, error } = await supabase.rpc("admin_list_domain_explorers");
    if (error) {
      setRows([]);
      showAlert("Could not load list", error.message);
    } else {
      setRows((data ?? []) as ExplorerRow[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile?.org_id]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendInvite(target: ExplorerRow) {
    if (orgRequiresFullActivationPaywall(orgRow?.status) || orgStatusIsGrace(orgRow?.status)) {
      return;
    }
    setSendingId(target.user_id);
    const { data, error } = await supabase.rpc("admin_send_network_join_invite", {
      p_target_user_id: target.user_id,
    });
    setSendingId(null);
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("invite_code_unavailable")) {
        showAlert(
          "Invite code needed",
          "Turn on your organisation invite code on the Invite tab, then try again."
        );
        return;
      }
      showAlert("Could not send", msg || "Please try again.");
      return;
    }
    const payload = data as { deduped?: boolean } | null;
    if (payload?.deduped) {
      showAlert(
        "Already sent",
        "A join request was sent to this person in the last 7 days."
      );
      return;
    }
    showAlert(
      "Join request sent",
      `${target.full_name?.trim() || target.email} will see this in Activity with your invite code.`
    );
    await refreshProfile();
  }

  const graceLocked = Boolean(
    !loading && profile?.org_id && orgRow && orgStatusIsGrace(orgRow.status)
  );
  const paywallLocked = Boolean(!loading && profile?.org_id && orgRequiresFullActivationPaywall(orgRow?.status));

  if (!loading && profile?.org_id && paywallLocked) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <OrgPaywallScreen
          organisationStatus={orgRow?.status}
          onActivateNetwork={() => {
            showAlert(
              "Activate network",
              "Stripe checkout is not wired in this build yet. When billing is live, this opens activation."
            );
          }}
          onContinueAsIndividual={async () => {
            await refreshProfile();
            router.replace("/(tabs)/home");
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Domain join requests</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={Colors.primary}
          />
        }
      >
        <Text style={styles.sub}>
          People on @{profile?.email?.split("@")[1] ?? "your domain"} who are not in your workplace
          network yet. We only send when your network is active and at least one org admin exists for
          this domain. They get an in-app message with your invite code.
        </Text>

        <GraceNetworkBanner orgStatus={orgRow?.status} />

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xl }} />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="mail-outline" size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No explorers to invite</Text>
            <Text style={styles.emptyBody}>
              When colleagues sign up with your company email before joining the network, they appear
              here.
            </Text>
          </View>
        ) : (
          rows.map((r) => {
            const uri = resolveAvatarDisplayUrl(r.avatar_url);
            const busy = sendingId === r.user_id;
            return (
              <View key={r.user_id} style={[styles.row, graceLocked && styles.rowDisabled]}>
                {uri ? (
                  <Image source={{ uri }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitial}>
                      {(r.full_name ?? r.email).slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.name}>{r.full_name?.trim() || "Name not set"}</Text>
                  <Text style={styles.email}>{r.email}</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.sendBtn,
                    (graceLocked || busy) && styles.sendBtnDisabled,
                  ]}
                  onPress={() => void sendInvite(r)}
                  disabled={graceLocked || busy}
                  activeOpacity={0.85}
                >
                  {busy ? (
                    <ActivityIndicator color={Colors.textOnPrimary} size="small" />
                  ) : (
                    <Text style={styles.sendBtnText}>Send request</Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )}

        <TouchableOpacity
          style={styles.secondaryLink}
          onPress={() => router.push("/(admin)/claim-explorers")}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryLinkText}>Add people to the network now (claim)</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.lg },
  rowDisabled: { opacity: 0.45 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.borderLight },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitial: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  email: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  sendBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    minWidth: 108,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  empty: { alignItems: "center", paddingVertical: Spacing["2xl"], gap: Spacing.md },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text },
  emptyBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  secondaryLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  secondaryLinkText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: FontWeight.medium },
});
