import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { showAlert } from "@/lib/platformAlert";
import {
  createCrew,
  joinCrewByCode,
  listMyCrews,
  getOrCreateTripInstance,
  deleteCrewAsOwner,
  isCrewOwner,
  MAX_CREWS_PER_USER,
  type CrewListRow,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export default function PoolynCrewsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [rows, setRows] = useState<CrewListRow[]>([]);
  const [ownerByCrewId, setOwnerByCrewId] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [deletingCrewId, setDeletingCrewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const loaded = await listMyCrews(userId);
    setRows(loaded);
    if (loaded.length > 0) {
      const pairs = await Promise.all(
        loaded.map(async (c) => [c.id, await isCrewOwner(c.id, userId)] as const)
      );
      setOwnerByCrewId(Object.fromEntries(pairs));
    } else {
      setOwnerByCrewId({});
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openTodaysChat(crewId: string) {
    const today = localDateKey();
    const inst = await getOrCreateTripInstance(crewId, today);
    if (!inst.ok) {
      showAlert("Could not open chat", inst.reason);
      return;
    }
    router.push({
      pathname: "/(tabs)/profile/crew-chat/[tripInstanceId]",
      params: { tripInstanceId: inst.row.id },
    });
  }

  async function onCreate() {
    if (!userId) return;
    const name = newName.trim();
    if (!name) {
      showAlert("Name required", "Give your crew a short name.");
      return;
    }
    setSaving(true);
    const res = await createCrew({
      name,
      userId,
      orgId: profile?.org_id ?? null,
    });
    setSaving(false);
    if (!res.ok) {
      showAlert("Could not create", res.reason);
      return;
    }
    setNewName("");
    setCreateOpen(false);
    await load();
    await openTodaysChat(res.crewId);
  }

  async function onJoin() {
    const code = joinCode.trim();
    if (!code) {
      showAlert("Code required", "Enter the invite code from your crew organiser.");
      return;
    }
    setSaving(true);
    const res = await joinCrewByCode(code);
    setSaving(false);
    if (!res.ok) {
      showAlert("Could not join", res.reason);
      return;
    }
    setJoinCode("");
    setJoinOpen(false);
    await load();
    showAlert("Joined", "Open today’s chat from this list or Messages.");
  }

  function confirmDeleteCrew(c: CrewListRow) {
    showAlert(
      `Delete “${c.name}”?`,
      "Everyone loses access. Members, day chat threads, and pending invites are removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "default",
          onPress: () => {
            showAlert(
              "Delete crew permanently?",
              "You are about to delete this crew for all members. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete crew",
                  style: "destructive",
                  onPress: () => void runDeleteCrew(c.id),
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function runDeleteCrew(crewId: string) {
    setDeletingCrewId(crewId);
    const r = await deleteCrewAsOwner(crewId);
    setDeletingCrewId(null);
    if (!r.ok) {
      showAlert("Could not delete crew", r.reason);
      return;
    }
    await load();
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Poolyn Crews</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, rows.length >= MAX_CREWS_PER_USER && styles.actionBtnDisabled]}
          onPress={() => {
            if (rows.length >= MAX_CREWS_PER_USER) {
              showAlert(
                "Crew limit",
                `You can be in up to ${MAX_CREWS_PER_USER} crews. Delete or leave one here before creating another.`
              );
              return;
            }
            setCreateOpen(true);
          }}
          activeOpacity={0.85}
        >
          <Ionicons
            name="add-circle-outline"
            size={20}
            color={rows.length >= MAX_CREWS_PER_USER ? Colors.textTertiary : Colors.primary}
          />
          <Text
            style={[styles.actionBtnText, rows.length >= MAX_CREWS_PER_USER && styles.actionBtnTextDisabled]}
          >
            New crew
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setJoinOpen(true)} activeOpacity={0.85}>
          <Ionicons name="enter-outline" size={20} color={Colors.primary} />
          <Text style={styles.actionBtnText}>Join with code</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Tap a crew for settings (members, invite). The chat icon opens today&apos;s thread. Each calendar day has its
        own chat thread — roll the dice in chat to pick today&apos;s driver; they lead coordination for the day.
      </Text>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={44} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No crews yet</Text>
              <Text style={styles.emptyBody}>Create one for your carpool cluster or join with an invite code.</Text>
            </View>
          ) : (
            rows.map((c) => (
              <View key={c.id} style={styles.card}>
                <TouchableOpacity
                  style={styles.cardMain}
                  onPress={() => router.push(`/(tabs)/profile/crew-settings/${c.id}`)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}, crew settings`}
                >
                  <View style={styles.cardIcon}>
                    <Ionicons name="people" size={22} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.cardSub}>Settings · invite {c.invite_code}</Text>
                  </View>
                </TouchableOpacity>
                <Pressable
                  style={styles.cardChat}
                  onPress={() => void openTodaysChat(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open today’s chat for ${c.name}`}
                  hitSlop={10}
                >
                  <Ionicons name="chatbubbles-outline" size={22} color={Colors.primary} />
                </Pressable>
                {ownerByCrewId[c.id] ? (
                  <Pressable
                    style={styles.cardDelete}
                    onPress={() => confirmDeleteCrew(c)}
                    disabled={deletingCrewId !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Delete crew"
                    hitSlop={10}
                  >
                    {deletingCrewId === c.id ? (
                      <ActivityIndicator color={Colors.error} size="small" />
                    ) : (
                      <Ionicons name="trash-outline" size={22} color={Colors.error} />
                    )}
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !saving && setCreateOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>New crew</Text>
            <TextInput
              style={styles.input}
              placeholder="Crew name"
              placeholderTextColor={Colors.textTertiary}
              value={newName}
              onChangeText={setNewName}
              editable={!saving}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreateOpen(false)} disabled={saving}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={() => void onCreate()} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={Colors.textOnPrimary} />
                ) : (
                  <Text style={styles.modalOkText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={joinOpen} transparent animationType="fade" onRequestClose={() => setJoinOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !saving && setJoinOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Join crew</Text>
            <TextInput
              style={styles.input}
              placeholder="Invite code"
              placeholderTextColor={Colors.textTertiary}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="none"
              editable={!saving}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setJoinOpen(false)} disabled={saving}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={() => void onJoin()} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={Colors.textOnPrimary} />
                ) : (
                  <Text style={styles.modalOkText}>Join</Text>
                )}
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
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: { padding: Spacing.xs },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  actionBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
  },
  actionBtnDisabled: { opacity: 0.65, borderColor: Colors.border },
  actionBtnTextDisabled: { color: Colors.textTertiary },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  list: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing["3xl"] },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    minWidth: 0,
    paddingVertical: Spacing.xs,
  },
  cardChat: {
    padding: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  cardDelete: {
    padding: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  cardSub: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: Spacing["2xl"] },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.md,
  },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  modalRow: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.sm },
  modalCancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  modalCancelText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  modalOk: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    minWidth: 100,
    alignItems: "center",
  },
  modalOkText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
});
