import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  Pressable,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import type { OrgRouteGroup } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type GroupRow = Pick<OrgRouteGroup, "id" | "name" | "description" | "created_by"> & {
  member_count: number;
};

export default function OrgRouteGroupsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [myGroupIds, setMyGroupIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, { id: string; full_name: string | null }[]>>(
    {}
  );
  const [loadingMembers, setLoadingMembers] = useState<string | null>(null);

  const orgId = profile?.org_id;
  const userId = profile?.id;

  const load = useCallback(async () => {
    if (!orgId || !userId) {
      setGroups([]);
      setMyGroupIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    const [gRes, mRes] = await Promise.all([
      supabase
        .from("org_route_groups")
        .select("id, name, description, created_by, org_route_group_members(count)")
        .eq("org_id", orgId)
        .eq("archived", false)
        .order("name"),
      supabase.from("org_route_group_members").select("group_id").eq("user_id", userId),
    ]);

    if (gRes.error) {
      if (__DEV__) console.warn("[route-groups] list:", gRes.error.message);
      showAlert("Could not load groups", gRes.error.message);
      setGroups([]);
    } else {
      const rows = (gRes.data ?? []) as unknown as Array<
        OrgRouteGroup & { org_route_group_members?: { count: number }[] }
      >;
      setGroups(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          created_by: r.created_by,
          member_count: r.org_route_group_members?.[0]?.count ?? 0,
        }))
      );
    }

    if (!mRes.error && mRes.data) {
      setMyGroupIds(new Set(mRes.data.map((x) => x.group_id as string)));
    } else {
      setMyGroupIds(new Set());
    }
    setLoading(false);
  }, [orgId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function loadMembersForGroup(groupId: string) {
    setLoadingMembers(groupId);
    const { data: mem, error } = await supabase
      .from("org_route_group_members")
      .select("user_id")
      .eq("group_id", groupId);
    if (error || !mem?.length) {
      setMemberNames((prev) => ({ ...prev, [groupId]: [] }));
      setLoadingMembers(null);
      return;
    }
    const ids = [...new Set(mem.map((m) => m.user_id as string))];
    const { data: users, error: uErr } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", ids)
      .order("full_name");
    if (uErr) {
      setMemberNames((prev) => ({ ...prev, [groupId]: [] }));
    } else {
      setMemberNames((prev) => ({
        ...prev,
        [groupId]: (users ?? []) as { id: string; full_name: string | null }[],
      }));
    }
    setLoadingMembers(null);
  }

  function toggleExpand(g: GroupRow) {
    if (expandedId === g.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(g.id);
    void loadMembersForGroup(g.id);
  }

  async function createGroup() {
    const name = newName.trim();
    if (!name || !orgId || !userId) {
      showAlert("Name required", "Give your route group a short name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("org_route_groups").insert({
      org_id: orgId,
      name,
      description: newDesc.trim() || null,
      created_by: userId,
    });
    setSaving(false);
    if (error) {
      showAlert("Could not create", error.message);
      return;
    }
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    await load();
    showAlert("Created", "Others in your organisation can join this route group.");
  }

  async function joinGroup(groupId: string) {
    if (!userId) return;
    const { error } = await supabase.from("org_route_group_members").insert({
      group_id: groupId,
      user_id: userId,
    });
    if (error) {
      showAlert("Could not join", error.message);
      return;
    }
    setMyGroupIds((s) => new Set(s).add(groupId));
    await load();
  }

  async function leaveGroup(groupId: string) {
    if (!userId) return;
    const { error } = await supabase
      .from("org_route_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);
    if (error) {
      showAlert("Could not leave", error.message);
      return;
    }
    setMyGroupIds((s) => {
      const n = new Set(s);
      n.delete(groupId);
      return n;
    });
    await load();
    setMemberNames((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }

  if (!orgId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
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
          <Text style={styles.title}>Route groups</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.bodyMuted}>
            Route groups are for workplace networks. Join an organisation to create or join corridor
            groups for planning.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
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
        <Text style={styles.title}>Route groups</Text>
        <TouchableOpacity
          onPress={() => setCreateOpen(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Create route group"
        >
          <Ionicons name="add-circle-outline" size={26} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Organise commuters by corridor or neighbourhood (like lines on a transit map). Your org admin
          can see member counts to understand coverage.
        </Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.primary} />
        ) : groups.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="git-network-outline" size={32} color={Colors.textSecondary} />
            <Text style={styles.emptyTitle}>No route groups yet</Text>
            <Text style={styles.bodyMuted}>
              Create one for your area (for example “Northside loop” or “Clayton feeder”). Colleagues
              can join to show demand along that corridor.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setCreateOpen(true)}>
              <Text style={styles.primaryBtnText}>Create a route group</Text>
            </TouchableOpacity>
          </View>
        ) : (
          groups.map((g) => {
            const joined = myGroupIds.has(g.id);
            const expanded = expandedId === g.id;
            const members = memberNames[g.id];
            return (
              <View key={g.id} style={styles.card}>
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() => toggleExpand(g)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardTitleRow}>
                    <Ionicons name="map-outline" size={20} color={Colors.primary} />
                    <Text style={styles.cardTitle}>{g.name}</Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {g.member_count} member{g.member_count === 1 ? "" : "s"}
                  </Text>
                  {g.description ? <Text style={styles.cardDesc}>{g.description}</Text> : null}
                </TouchableOpacity>
                <View style={styles.cardActions}>
                  {joined ? (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => leaveGroup(g.id)}>
                      <Text style={styles.secondaryBtnText}>Leave</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.primaryBtnSmall} onPress={() => joinGroup(g.id)}>
                      <Text style={styles.primaryBtnTextSmall}>Join</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => toggleExpand(g)} style={styles.expandHint}>
                    <Text style={styles.expandHintText}>{expanded ? "Hide members" : "Members"}</Text>
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={Colors.primary}
                    />
                  </TouchableOpacity>
                </View>
                {expanded ? (
                  <View style={styles.memberList}>
                    {loadingMembers === g.id ? (
                      <ActivityIndicator color={Colors.primary} />
                    ) : members && members.length > 0 ? (
                      members.map((u) => (
                        <Text key={u.id} style={styles.memberLine}>
                          {u.full_name?.trim() || "Member"}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.bodyMuted}>No members yet.</Text>
                    )}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => !saving && setCreateOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>New route group</Text>
            <Text style={styles.modalLabel}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Eastern corridor"
              placeholderTextColor={Colors.textSecondary}
              value={newName}
              onChangeText={setNewName}
              editable={!saving}
            />
            <Text style={styles.modalLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Where people are coming from, typical direction…"
              placeholderTextColor={Colors.textSecondary}
              value={newDesc}
              onChangeText={setNewDesc}
              multiline
              editable={!saving}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => !saving && setCreateOpen(false)}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtnSmall, saving && { opacity: 0.6 }]}
                onPress={() => void createGroup()}
                disabled={saving}
              >
                <Text style={styles.primaryBtnTextSmall}>{saving ? "Saving…" : "Create"}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerBack: { width: 36, height: 36, justifyContent: "center" },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing["4xl"] },
  lead: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  center: { flex: 1, justifyContent: "center", padding: Spacing.xl },
  bodyMuted: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  emptyCard: {
    alignItems: "center",
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    ...Shadow.sm,
  },
  emptyTitle: {
    marginTop: Spacing.md,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  cardHeader: { marginBottom: Spacing.sm },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  cardTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text, flex: 1 },
  cardMeta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },
  cardDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 20 },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  primaryBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  primaryBtnSmall: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  primaryBtnTextSmall: {
    color: Colors.textOnPrimary,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.sm,
  },
  secondaryBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryBtnText: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  expandHint: { flexDirection: "row", alignItems: "center", gap: 4 },
  expandHintText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: FontWeight.medium },
  memberList: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  memberLine: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadow.md,
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text, marginBottom: Spacing.md },
  modalLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 4, marginTop: Spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
});
