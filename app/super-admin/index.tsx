import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
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

type DirectoryRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  commute_role: string;
  org_role: string;
  org_id: string | null;
  org_name: string | null;
  org_domain: string | null;
  org_type: string | null;
  registration_type: string;
  onboarding_completed: boolean;
  active: boolean;
  created_at: string;
};

type OrgOverviewRow = {
  org_id: string;
  org_name: string;
  org_domain: string;
  org_type: string;
  plan: string;
  member_count: number;
  admin_count: number;
  active_member_count: number;
};

type FilterKey = "all" | "with_org" | "no_org" | "org_admins";

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { isPlatformSuperAdmin, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [directory, setDirectory] = useState<DirectoryRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOverviewRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [showOrgs, setShowOrgs] = useState(true);

  const load = useCallback(async () => {
    const [dirRes, orgRes] = await Promise.all([
      supabase.rpc("super_admin_list_directory"),
      supabase.rpc("super_admin_org_overview"),
    ]);
    if (dirRes.error) {
      const msg = dirRes.error.message ?? "Could not load users.";
      showAlert("Directory", msg);
      setDirectory([]);
    } else {
      setDirectory((dirRes.data ?? []) as DirectoryRow[]);
    }
    if (orgRes.error) {
      setOrgs([]);
    } else {
      setOrgs((orgRes.data ?? []) as OrgOverviewRow[]);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    if (!isPlatformSuperAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, isPlatformSuperAdmin, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtered = useMemo(() => {
    let rows = directory;
    if (filter === "with_org") rows = rows.filter((r) => r.org_id != null);
    else if (filter === "no_org") rows = rows.filter((r) => r.org_id == null);
    else if (filter === "org_admins") rows = rows.filter((r) => r.org_role === "admin");
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        (r.full_name?.toLowerCase().includes(q) ?? false) ||
        (r.org_domain?.toLowerCase().includes(q) ?? false) ||
        (r.org_name?.toLowerCase().includes(q) ?? false)
    );
  }, [directory, filter, query]);

  const stats = useMemo(() => {
    const withOrg = directory.filter((r) => r.org_id != null).length;
    const noOrg = directory.filter((r) => r.org_id == null).length;
    const orgAdmins = directory.filter((r) => r.org_role === "admin").length;
    return { total: directory.length, withOrg, noOrg, orgAdmins };
  }, [directory]);

  if (!session) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.muted}>Sign in to continue.</Text>
      </SafeAreaView>
    );
  }

  if (!isPlatformSuperAdmin) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={40} color={Colors.textTertiary} />
        <Text style={styles.deniedTitle}>Access denied</Text>
        <Text style={styles.muted}>
          Your account is not in platform_super_admins. See docs/SUPER_ADMIN.md for setup.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.muted}>Loading directory…</Text>
      </SafeAreaView>
    );
  }

  const chips: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "with_org", label: "With org" },
    { key: "no_org", label: "No org" },
    { key: "org_admins", label: "Org admins" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        <Text style={styles.lead}>
          All registered profiles (public.users). Org network admins are org_role = admin; commute mode is role
          (driver/passenger/both).
        </Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{stats.total}</Text>
            <Text style={styles.statLbl}>Users</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{stats.withOrg}</Text>
            <Text style={styles.statLbl}>Linked to org</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{stats.noOrg}</Text>
            <Text style={styles.statLbl}>No org_id</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statVal}>{stats.orgAdmins}</Text>
            <Text style={styles.statLbl}>Org admins</Text>
          </View>
        </View>

        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search email, name, org…"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
          <View style={styles.chips}>
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setFilter(c.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <Text style={styles.sectionTitle}>Users ({filtered.length})</Text>
        {filtered.map((row) => (
          <View key={row.user_id} style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardEmail}>{row.email}</Text>
              {row.org_role === "admin" ? (
                <View style={styles.badgeAdmin}>
                  <Text style={styles.badgeAdminText}>Org admin</Text>
                </View>
              ) : (
                <View style={styles.badgeMember}>
                  <Text style={styles.badgeMemberText}>Member</Text>
                </View>
              )}
            </View>
            {row.full_name ? <Text style={styles.cardName}>{row.full_name}</Text> : null}
            <Text style={styles.cardMeta}>
              Commute: <Text style={styles.cardMetaStrong}>{row.commute_role}</Text>
              {" · "}
              Reg: {row.registration_type}
              {row.onboarding_completed ? "" : " · onboarding open"}
              {!row.active ? " · inactive" : ""}
            </Text>
            {row.org_id ? (
              <Text style={styles.cardOrg}>
                Org: {row.org_name ?? "None"} ({row.org_domain}) · {row.org_type}
              </Text>
            ) : (
              <Text style={styles.cardNoOrg}>No organisation link (org_id is null)</Text>
            )}
            <Text style={styles.cardId}>id {row.user_id}</Text>
          </View>
        ))}

        <TouchableOpacity
          style={styles.orgToggle}
          onPress={() => setShowOrgs((s) => !s)}
          activeOpacity={0.7}
        >
          <Ionicons name={showOrgs ? "chevron-down" : "chevron-forward"} size={20} color={Colors.primary} />
          <Text style={styles.orgToggleText}>
            Organisations ({orgs.length}) {showOrgs ? "" : "(tap to expand)"}
          </Text>
        </TouchableOpacity>

        {showOrgs &&
          orgs.map((o) => (
            <View key={o.org_id} style={styles.orgCard}>
              <Text style={styles.orgTitle}>{o.org_name}</Text>
              <Text style={styles.orgDomain}>{o.org_domain}</Text>
              <Text style={styles.orgMeta}>
                {o.org_type} · plan {o.plan} · members {o.member_count} (admins {o.admin_count}, active{" "}
                {o.active_member_count})
              </Text>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing["5xl"] },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
    backgroundColor: Colors.background,
    gap: Spacing.md,
  },
  lead: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.lg },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: {
    width: "47%",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  statVal: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.text },
  statLbl: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  search: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 44,
    fontSize: FontSize.base,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  chipsScroll: { marginBottom: Spacing.lg },
  chips: { flexDirection: "row", gap: Spacing.sm, paddingRight: Spacing.xl },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipOn: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  chipTextOn: { color: Colors.primaryDark },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Spacing.sm },
  cardEmail: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  cardName: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  cardMeta: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.sm, lineHeight: 18 },
  cardMetaStrong: { fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  cardOrg: { fontSize: FontSize.xs, color: Colors.primaryDark, marginTop: Spacing.xs, lineHeight: 18 },
  cardNoOrg: { fontSize: FontSize.xs, color: "#B45309", marginTop: Spacing.xs, fontWeight: FontWeight.medium },
  cardId: { fontSize: 10, color: Colors.textTertiary, marginTop: Spacing.sm, fontFamily: "monospace" },
  badgeAdmin: {
    backgroundColor: "#EDE9FE",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeAdminText: { fontSize: 10, fontWeight: FontWeight.bold, color: "#5B21B6" },
  badgeMember: {
    backgroundColor: Colors.borderLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeMemberText: { fontSize: 10, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  orgToggle: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.lg, marginBottom: Spacing.md },
  orgToggleText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.primary },
  orgCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orgTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  orgDomain: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  orgMeta: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.sm, lineHeight: 18 },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  deniedTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.text },
  backBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  backBtnText: { color: Colors.textOnPrimary, fontWeight: FontWeight.semibold },
});
