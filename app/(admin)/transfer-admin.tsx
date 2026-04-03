import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { OrgRole, UserRole } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

interface MemberRow {
  id: string;
  full_name: string | null;
  email: string;
  role: UserRole;
  org_role: OrgRole;
  active: boolean;
  onboarding_completed: boolean;
  org_member_verified: boolean;
}

type SortKey = "name_asc" | "name_desc" | "email_asc";
type FilterKey = "all" | "verified" | "pending_onboarding";

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0]?.toUpperCase() ?? "?";
}

const ROLE_LABELS: Record<UserRole, string> = {
  driver: "Driver",
  passenger: "Passenger",
  both: "Both",
};

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "pending_onboarding", label: "Onboarding" },
];

const SORT_CHIPS: { key: SortKey; label: string }[] = [
  { key: "name_asc", label: "Name A–Z" },
  { key: "name_desc", label: "Name Z–A" },
  { key: "email_asc", label: "Email" },
];

export default function TransferAdminScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("name_asc");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile?.org_id) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select(
        "id, full_name, email, role, org_role, active, onboarding_completed, org_member_verified"
      )
      .eq("org_id", profile.org_id)
      .order("full_name");

    if (error) {
      showAlert("Could not load members", error.message);
      setMembers([]);
    } else {
      setMembers(((data as MemberRow[]) ?? []).filter((m) => m.id !== profile.id));
    }
    setLoading(false);
  }, [profile?.org_id, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = members.filter((m) => {
      if (filter === "verified" && !m.org_member_verified) return false;
      if (filter === "pending_onboarding" && m.onboarding_completed) return false;
      if (!q) return true;
      const name = (m.full_name ?? "").toLowerCase();
      return name.includes(q) || m.email.toLowerCase().includes(q);
    });

    rows = [...rows].sort((a, b) => {
      if (sort === "email_asc") {
        return a.email.localeCompare(b.email);
      }
      const an = (a.full_name ?? a.email).toLowerCase();
      const bn = (b.full_name ?? b.email).toLowerCase();
      const cmp = an.localeCompare(bn);
      return sort === "name_desc" ? -cmp : cmp;
    });
    return rows;
  }, [members, query, filter, sort]);

  function confirmTransfer(m: MemberRow) {
    const label = m.full_name?.trim() || m.email;
    showAlert(
      "Transfer admin",
      `Make ${label} the organisation admin? You will become a normal member and keep full commuter access.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Transfer",
          style: "destructive",
          onPress: () => void runTransfer(m.id),
        },
      ]
    );
  }

  async function runTransfer(newAdminId: string) {
    setBusyId(newAdminId);
    const { error } = await supabase.rpc("transfer_org_admin", {
      p_new_admin_id: newAdminId,
    });
    setBusyId(null);
    if (error) {
      showAlert("Could not transfer", error.message);
      return;
    }
    await refreshProfile();
    showAlert(
      "Admin transferred",
      "They are now the organisation admin. Use the commuter app from the tabs, or sign in again if you need the admin console later."
    );
    router.replace("/(tabs)/");
  }

  function renderItem({ item }: { item: MemberRow }) {
    const initials = getInitials(item.full_name, item.email);
    const disabled = !item.active || busyId !== null;
    return (
      <TouchableOpacity
        style={[styles.row, disabled && { opacity: 0.55 }]}
        onPress={() => !disabled && confirmTransfer(item)}
        disabled={disabled}
        activeOpacity={0.75}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.rowBody}>
          <View style={styles.nameLine}>
            <Text style={styles.name} numberOfLines={1}>
              {item.full_name?.trim() || "Unnamed"}
            </Text>
            {item.org_role === "admin" && (
              <View style={styles.adminPill}>
                <Text style={styles.adminPillText}>Admin</Text>
              </View>
            )}
          </View>
          <Text style={styles.email} numberOfLines={1}>
            {item.email}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{ROLE_LABELS[item.role]}</Text>
            {!item.onboarding_completed && (
              <Text style={styles.metaWarn}>Onboarding</Text>
            )}
            {item.org_member_verified && <Text style={styles.metaOk}>Verified</Text>}
            {!item.active && <Text style={styles.metaWarn}>Inactive</Text>}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
      </TouchableOpacity>
    );
  }

  if (profile?.org_role !== "admin") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.muted}>Only the organisation admin can transfer admin rights.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBack}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Transfer admin</Text>
        <View style={{ width: 36 }} />
      </View>
      <Text style={styles.subtitle}>
        Choose an active colleague in your network. You stay as a member with commuter access.
      </Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name or email"
          placeholderTextColor={Colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.chipLabel}>Filter</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {FILTER_CHIPS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, filter === c.key && styles.chipOn]}
            onPress={() => setFilter(c.key)}
          >
            <Text style={[styles.chipText, filter === c.key && styles.chipTextOn]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.chipLabel}>Sort</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {SORT_CHIPS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, sort === c.key && styles.chipOn]}
            onPress={() => setSort(c.key)}
          >
            <Text style={[styles.chipText, sort === c.key && styles.chipTextOn]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.empty}>No members match your filters.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center" },
  backBtn: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  backBtnText: { color: Colors.textOnPrimary, fontWeight: FontWeight.semibold },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerBack: { width: 36, height: 36, justifyContent: "center", alignItems: "flex-start" },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
    paddingVertical: 4,
  },
  chipLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginLeft: Spacing.xl,
    marginBottom: Spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  chip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipOn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  chipTextOn: { color: Colors.textOnPrimary },
  listContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing["3xl"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.primaryDark },
  rowBody: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  adminPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.accentLight,
  },
  adminPillText: { fontSize: 10, fontWeight: FontWeight.semibold, color: Colors.accent },
  email: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: 6 },
  meta: { fontSize: 11, color: Colors.textTertiary },
  metaOk: { fontSize: 11, color: Colors.success, fontWeight: FontWeight.medium },
  metaWarn: { fontSize: 11, color: Colors.warning, fontWeight: FontWeight.medium },
  empty: { textAlign: "center", color: Colors.textSecondary, marginTop: Spacing.xl },
});
