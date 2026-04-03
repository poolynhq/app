import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
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

export default function ClaimExplorersScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [orgRow, setOrgRow] = useState<Organisation | null>(null);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

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
      const init: Record<string, boolean> = {};
      (data as ExplorerRow[] | null)?.forEach((r) => {
        init[r.user_id] = true;
      });
      setSelected(init);
    }
    setLoading(false);
  }, [profile?.org_id]);

  useEffect(() => {
    load();
  }, [load]);

  const allIds = rows.map((r) => r.user_id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected[id]);
  const anySelected = allIds.some((id) => selected[id]);

  function toggleAll() {
    const on = !allSelected;
    const next: Record<string, boolean> = {};
    allIds.forEach((id) => {
      next[id] = on;
    });
    setSelected(next);
  }

  async function submitClaim() {
    const ids = allIds.filter((id) => selected[id]);
    if (ids.length === 0) {
      showAlert("Nobody selected", "Select at least one colleague or skip for now.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("admin_claim_explorers", {
      p_user_ids: ids,
    });
    setSaving(false);
    if (error) {
      showAlert("Claim failed", error.message);
      return;
    }
    const claimed = (data as { claimed?: number })?.claimed ?? 0;
    await refreshProfile();
    showAlert("Done", `${claimed} colleague${claimed === 1 ? "" : "s"} added to your network.`);
    router.replace("/(admin)/");
  }

  function skip() {
    router.replace("/(admin)/");
  }

  if (!loading && profile?.org_id && orgRequiresFullActivationPaywall(orgRow?.status)) {
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
            router.replace("/(tabs)");
          }}
        />
      </SafeAreaView>
    );
  }

  const graceLocked = Boolean(
    !loading && profile?.org_id && orgRow && orgStatusIsGrace(orgRow.status)
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Colleagues on your domain</Text>
        <Text style={styles.sub}>
          These accounts signed up with the same email domain but are not in your organisation yet.
          Select who should join your network, or skip and invite them later.
        </Text>

        <GraceNetworkBanner orgStatus={orgRow?.status} />

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xl }} />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No explorers to add</Text>
            <Text style={styles.emptyBody}>
              When teammates create individual accounts with @{profile?.email?.split("@")[1] ?? "your-domain"} before
              your network existed, they will appear here after you create the organisation.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={skip} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Continue to dashboard</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.selectAllRow, graceLocked && styles.rowDisabled]}
              onPress={() => {
                if (!graceLocked) toggleAll();
              }}
              activeOpacity={0.7}
              disabled={graceLocked}
            >
              <View style={[styles.checkbox, allSelected && styles.checkboxOn]}>
                {allSelected ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
              </View>
              <Text style={styles.selectAllText}>{allSelected ? "Deselect all" : "Select all"}</Text>
              <Text style={styles.count}>{rows.filter((r) => selected[r.user_id]).length} selected</Text>
            </TouchableOpacity>

            {rows.map((r) => {
              const uri = resolveAvatarDisplayUrl(r.avatar_url);
              const on = !!selected[r.user_id];
              return (
                <TouchableOpacity
                  key={r.user_id}
                  style={[styles.row, graceLocked && styles.rowDisabled]}
                  onPress={() => {
                    if (!graceLocked) setSelected((s) => ({ ...s, [r.user_id]: !on }));
                  }}
                  activeOpacity={0.75}
                  disabled={graceLocked}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
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
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (!anySelected || saving || graceLocked) && styles.btnDisabled,
              ]}
              onPress={submitClaim}
              disabled={!anySelected || saving || graceLocked}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>Add selected to network</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipBtn} onPress={skip} disabled={saving}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.xl },
  rowDisabled: { opacity: 0.45 },
  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  selectAllText: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  count: { fontSize: FontSize.sm, color: Colors.textSecondary },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.surface,
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
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
  rowText: { flex: 1 },
  name: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  email: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  primaryBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  skipBtn: { marginTop: Spacing.md, padding: Spacing.md, alignItems: "center" },
  skipText: { fontSize: FontSize.base, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  empty: { alignItems: "center", paddingVertical: Spacing["2xl"], gap: Spacing.md },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text },
  emptyBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
});
