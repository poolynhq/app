import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { OrgRole, OrganisationNetworkStatus, UserRole } from "@/types/database";
import { orgRequiresFullActivationPaywall, orgStatusIsGrace } from "@/lib/orgNetworkUi";
import { SortSelectDropdown } from "@/components/admin/SortSelectDropdown";
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
  created_at: string;
}

type MembersSortKey = "name_asc" | "name_desc" | "created_asc" | "created_desc";
type MembersRoleFilter = "all" | "driver" | "passenger" | "both" | "verified";

const MEMBER_FILTER_CHIPS: { key: MembersRoleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "driver", label: "Drivers" },
  { key: "passenger", label: "Passengers" },
  { key: "both", label: "Both" },
  { key: "verified", label: "Verified" },
];

const MEMBER_SORT_OPTIONS: { key: MembersSortKey; label: string }[] = [
  { key: "name_asc", label: "Name A–Z" },
  { key: "name_desc", label: "Name Z–A" },
  { key: "created_asc", label: "Oldest join first" },
  { key: "created_desc", label: "Newest join first" },
];

interface FlexGrantRow {
  id: string;
  user_id: string;
  delta: number;
  created_at: string;
  description: string | null;
}

const ROLE_CONFIG: Record<UserRole, { label: string; bg: string; fg: string }> = {
  driver: { label: "Driver", bg: "#EFF6FF", fg: Colors.info },
  passenger: { label: "Passenger", bg: Colors.primaryLight, fg: Colors.primaryDark },
  both: { label: "Both", bg: "#F3E8FF", fg: "#8B5CF6" },
};

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

function MemberItem({
  item,
  viewerId,
  onToggleVerified,
  onGrantFlex,
  onRemoveFromNetwork,
}: {
  item: MemberRow;
  viewerId: string;
  onToggleVerified: (member: MemberRow) => void;
  onGrantFlex: (member: MemberRow) => void;
  onRemoveFromNetwork?: (member: MemberRow) => void;
}) {
  const initials = getInitials(item.full_name, item.email);
  const roleConfig = ROLE_CONFIG[item.role];
  const canRemove =
    Boolean(onRemoveFromNetwork) &&
    item.id !== viewerId &&
    item.org_role !== "admin";

  return (
    <View style={styles.memberRow}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: item.active ? Colors.success : Colors.textTertiary },
          ]}
        />
      </View>

      <View style={styles.memberInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.memberName} numberOfLines={1}>
            {item.full_name || "Unnamed"}
          </Text>
          {item.org_role === "admin" && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          )}
        </View>
        <Text style={styles.memberEmail} numberOfLines={1}>
          {item.email}
        </Text>
        <View style={styles.tagsRow}>
          <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
            <Text style={[styles.roleBadgeText, { color: roleConfig.fg }]}>
              {roleConfig.label}
            </Text>
          </View>
          {!item.onboarding_completed && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>Pending</Text>
            </View>
          )}
          {item.org_member_verified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedBadgeText}>Verified Member</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.memberActions}>
        <TouchableOpacity
          style={styles.verifyBtn}
          onPress={() => onToggleVerified(item)}
          activeOpacity={0.7}
        >
          <Text style={styles.verifyBtnText}>
            {item.org_member_verified ? "Unverify" : "Verify"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.creditBtn}
          onPress={() => onGrantFlex(item)}
          activeOpacity={0.7}
        >
          <Text style={styles.creditBtnText}>+1 Flex</Text>
        </TouchableOpacity>
        {canRemove ? (
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => onRemoveFromNetwork?.(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export default function Members() {
  const { profile } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentGrants, setRecentGrants] = useState<FlexGrantRow[]>([]);
  const [domainPendingCount, setDomainPendingCount] = useState(0);
  const [orgNetworkStatus, setOrgNetworkStatus] = useState<OrganisationNetworkStatus | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<MembersRoleFilter>("all");
  const [sortKey, setSortKey] = useState<MembersSortKey>("name_asc");

  const fetchMembers = useCallback(async () => {
    if (!profile?.org_id) return;
    try {
      setError(null);

      const { data: orgSnap } = await supabase
        .from("organisations")
        .select("status")
        .eq("id", profile.org_id)
        .single();
      setOrgNetworkStatus((orgSnap?.status as OrganisationNetworkStatus) ?? null);

      const { data, error: err } = await supabase
        .from("users")
        .select(
          "id, full_name, email, role, org_role, active, onboarding_completed, org_member_verified, created_at"
        )
        .eq("org_id", profile.org_id)
        .order("full_name");

      if (err) throw err;
      const membersData = (data as MemberRow[]) ?? [];
      setMembers(membersData);

      const memberIds = membersData.map((m) => m.id);
      if (memberIds.length > 0) {
        const { data: grants } = await supabase
          .from("flex_credits_ledger")
          .select("id, user_id, delta, created_at, description")
          .in("user_id", memberIds)
          .eq("txn_type", "employer_grant")
          .order("created_at", { ascending: false })
          .limit(6);
        setRecentGrants((grants as FlexGrantRow[]) ?? []);
      } else {
        setRecentGrants([]);
      }

      if (profile?.org_role === "admin") {
        const { data: pendingRows, error: pendErr } = await supabase.rpc(
          "admin_list_domain_explorers"
        );
        if (!pendErr && Array.isArray(pendingRows)) {
          setDomainPendingCount(pendingRows.length);
        } else {
          setDomainPendingCount(0);
        }
      } else {
        setDomainPendingCount(0);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load members");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.org_id, profile?.org_role]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function handleToggleVerified(member: MemberRow) {
    const { error } = await supabase
      .from("users")
      .update({ org_member_verified: !member.org_member_verified })
      .eq("id", member.id);
    if (!error) {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === member.id
            ? { ...m, org_member_verified: !m.org_member_verified }
            : m
        )
      );
    }
  }

  async function handleGrantFlex(member: MemberRow) {
    await supabase.rpc("grant_org_flex_credits", {
      target_user_id: member.id,
      amount: 1,
      reason: "Admin campaign reward",
    });
  }

  function handleRemoveMember(member: MemberRow) {
    const label = member.full_name?.trim() || member.email;
    showAlert(
      "Remove from workplace network",
      `${label} will immediately become an independent Explorer. They will get an in-app notification. Their points and credits stay on their account.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          onPress: () =>
            showAlert(
              "Confirm removal",
              "This cannot be undone from here without inviting them back to the organisation.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Remove from network",
                  style: "destructive",
                  onPress: () => void runRemoveMember(member.id),
                },
              ]
            ),
        },
      ]
    );
  }

  async function runRemoveMember(targetId: string) {
    const { error } = await supabase.rpc("poolyn_admin_remove_org_member", {
      p_target_user_id: targetId,
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("cannot_remove_admin")) {
        showAlert(
          "Cannot remove this member",
          "Transfer admin away from them first, or ask them to leave if they are the only admin."
        );
        return;
      }
      showAlert("Could not remove member", msg || "Please try again.");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== targetId));
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMembers();
  }, [fetchMembers]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = members.filter((m) => {
      if (roleFilter === "verified" && !m.org_member_verified) return false;
      if (roleFilter === "driver" && m.role !== "driver") return false;
      if (roleFilter === "passenger" && m.role !== "passenger") return false;
      if (roleFilter === "both" && m.role !== "both") return false;
      if (!q) return true;
      const name = (m.full_name ?? "").toLowerCase();
      return name.includes(q) || m.email.toLowerCase().includes(q);
    });
    rows = [...rows].sort((a, b) => {
      if (sortKey === "created_asc" || sortKey === "created_desc") {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return sortKey === "created_asc" ? ta - tb : tb - ta;
      }
      const an = (a.full_name ?? a.email).toLowerCase();
      const bn = (b.full_name ?? b.email).toLowerCase();
      const cmp = an.localeCompare(bn);
      return sortKey === "name_desc" ? -cmp : cmp;
    });
    return rows;
  }, [members, query, roleFilter, sortKey]);

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
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.heading}>Members</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{members.length}</Text>
        </View>
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          Active users: {members.filter((m) => m.active).length}
        </Text>
        <Text style={styles.summaryText}>
          Verified: {members.filter((m) => m.org_member_verified).length}
        </Text>
      </View>

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

      <Text style={styles.controlsLabel}>Filter</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {MEMBER_FILTER_CHIPS.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, roleFilter === c.key && styles.chipOn]}
            onPress={() => setRoleFilter(c.key)}
          >
            <Text style={[styles.chipText, roleFilter === c.key && styles.chipTextOn]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.filterHint}>
        Verified: admin-marked in Poolyn. Role filters match commuter role (driver / passenger /
        both).
      </Text>

      <Text style={styles.controlsLabel}>Sort</Text>
      <SortSelectDropdown
        value={sortKey}
        options={MEMBER_SORT_OPTIONS}
        onChange={setSortKey}
        accessibilityLabel="Sort members"
      />

      {members.length > 0 && filteredMembers.length !== members.length ? (
        <Text style={styles.showingText}>
          Showing {filteredMembers.length} of {members.length}
        </Text>
      ) : null}

      <FlatList
        data={filteredMembers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MemberItem
            item={item}
            viewerId={profile?.id ?? ""}
            onToggleVerified={handleToggleVerified}
            onGrantFlex={handleGrantFlex}
            onRemoveFromNetwork={
              profile?.org_role === "admin" ? handleRemoveMember : undefined
            }
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        ListHeaderComponent={
          domainPendingCount > 0 ? (
            <View style={styles.pendingBanner}>
              <Ionicons name="mail-outline" size={22} color={Colors.primary} />
              <View style={{ flex: 1, marginHorizontal: Spacing.sm }}>
                <Text style={styles.pendingTitle}>Domain explorers — join requests</Text>
                <Text style={styles.pendingBody}>
                  {domainPendingCount} account{domainPendingCount === 1 ? "" : "s"} share your
                  company email but are not on the workplace network. Send each person an in-app join
                  request (with your invite code), or add them directly.
                  {orgStatusIsGrace(orgNetworkStatus)
                    ? "\n\nRequests and claiming are paused while your organisation is in a grace period."
                    : ""}
                </Text>
                <View style={styles.pendingBtnRow}>
                  <TouchableOpacity
                    style={[
                      styles.pendingBtn,
                      styles.pendingBtnPrimary,
                      orgStatusIsGrace(orgNetworkStatus) && styles.pendingBtnDisabled,
                    ]}
                    onPress={() => {
                      if (orgRequiresFullActivationPaywall(orgNetworkStatus)) {
                        router.push("/(admin)/org-paywall");
                        return;
                      }
                      if (!orgStatusIsGrace(orgNetworkStatus)) {
                        router.push("/(admin)/domain-join-requests");
                      }
                    }}
                    activeOpacity={0.85}
                    disabled={orgStatusIsGrace(orgNetworkStatus)}
                  >
                    <Text style={styles.pendingBtnText}>
                      {orgRequiresFullActivationPaywall(orgNetworkStatus) ? "Activate" : "Send requests"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.pendingBtn,
                      styles.pendingBtnSecondary,
                      orgStatusIsGrace(orgNetworkStatus) && styles.pendingBtnDisabled,
                    ]}
                    onPress={() => {
                      if (orgRequiresFullActivationPaywall(orgNetworkStatus)) {
                        router.push("/(admin)/org-paywall");
                        return;
                      }
                      if (!orgStatusIsGrace(orgNetworkStatus)) {
                        router.push("/(admin)/claim-explorers");
                      }
                    }}
                    activeOpacity={0.85}
                    disabled={orgStatusIsGrace(orgNetworkStatus)}
                  >
                    <Text style={styles.pendingBtnSecondaryText}>Add now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          members.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name="people-outline"
                size={48}
                color={Colors.textTertiary}
              />
              <Text style={styles.emptyTitle}>No members yet</Text>
              <Text style={styles.emptyBody}>
                Share your invite link to grow your team.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="filter-outline" size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyBody}>
                Try a different search or filter, or clear filters to see everyone.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          recentGrants.length > 0 ? (
            <View style={styles.historyCard}>
              <Text style={styles.historyTitle}>Recent Flex campaigns</Text>
              {recentGrants.map((g) => (
                <Text key={g.id} style={styles.historyItem}>
                  +{g.delta} Flex · {new Date(g.created_at).toLocaleDateString()} ·{" "}
                  {g.description ?? "Employer grant"}
                </Text>
              ))}
            </View>
          ) : null
        }
      />
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
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
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
  controlsLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginLeft: Spacing.xl,
    marginBottom: Spacing.xs,
  },
  chipScroll: {
    flexGrow: 0,
    maxHeight: 44,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 2,
    marginBottom: Spacing.sm,
  },
  chip: {
    flexShrink: 0,
    paddingVertical: 8,
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
  chipText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  chipTextOn: { color: Colors.textOnPrimary },
  filterHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 17,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  showingText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
    fontWeight: FontWeight.medium,
  },
  summaryText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  heading: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  countBadge: {
    backgroundColor: Colors.primaryLight,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  countText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["5xl"],
  },
  pendingBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  pendingTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: 4,
  },
  pendingBody: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  pendingBtnRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  pendingBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  pendingBtnPrimary: {
    backgroundColor: Colors.primary,
  },
  pendingBtnSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  pendingBtnDisabled: {
    opacity: 0.45,
  },
  pendingBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  pendingBtnSecondaryText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  memberActions: {
    alignSelf: "stretch",
    justifyContent: "center",
    gap: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  verifyBtn: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  verifyBtnText: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
  },
  creditBtn: {
    alignSelf: "stretch",
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
  },
  creditBtnText: {
    fontSize: FontSize.xs,
    color: Colors.textOnPrimary,
    fontWeight: FontWeight.semibold,
  },
  removeBtn: {
    alignSelf: "stretch",
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.errorLight,
    backgroundColor: Colors.errorLight,
    alignItems: "center",
  },
  removeBtnText: {
    fontSize: FontSize.xs,
    color: Colors.error,
    fontWeight: FontWeight.semibold,
  },
  avatarWrap: {
    position: "relative",
    marginRight: Spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.secondary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
  },
  statusDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  memberInfo: {
    flex: 1,
    justifyContent: "center",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 2,
  },
  memberName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    flexShrink: 1,
  },
  adminBadge: {
    backgroundColor: Colors.accentLight,
    paddingVertical: 1,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  adminBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.accent,
  },
  memberEmail: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  tagsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  roleBadge: {
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  roleBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
  pendingBadge: {
    backgroundColor: Colors.borderLight,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  pendingBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textTertiary,
  },
  verifiedBadge: {
    backgroundColor: Colors.primaryLight,
    paddingVertical: 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  verifiedBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.primaryDark,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing["2xl"],
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
    marginTop: Spacing.xl,
  },
  emptyTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginTop: Spacing.sm,
    ...Shadow.sm,
  },
  historyTitle: {
    fontSize: FontSize.base,
    color: Colors.text,
    fontWeight: FontWeight.semibold,
    marginBottom: Spacing.xs,
  },
  historyItem: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
