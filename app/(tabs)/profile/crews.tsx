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
  listMyCrews,
  getOrCreateTripInstance,
  deleteCrewAsOwner,
  isCrewOwner,
  type CrewListRow,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { JoinCrewByCodeModal } from "@/components/home/JoinCrewByCodeModal";
import {
  CrewPoolynCrewActionButtons,
  CrewPoolynCrewHintText,
  CrewPoolynCrewListRows,
} from "@/components/home/CrewPoolynCrewPicker";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
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

      <View style={styles.topPad}>
        <CrewPoolynCrewActionButtons
          crewCount={rows.length}
          onNewCrew={() => setCreateOpen(true)}
          onJoinWithCode={() => setJoinOpen(true)}
        />
        <CrewPoolynCrewHintText variant="profile" />
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <CrewPoolynCrewListRows
            mode="profile"
            crews={rows}
            ownerByCrewId={ownerByCrewId}
            deletingCrewId={deletingCrewId}
            onCrewMainPress={(c) => router.push(`/(tabs)/profile/crew-settings/${c.id}`)}
            onOpenChat={(crewId) => void openTodaysChat(crewId)}
            onDeleteOwner={(c) => confirmDeleteCrew(c)}
          />
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

      <JoinCrewByCodeModal visible={joinOpen} onClose={() => setJoinOpen(false)} onJoined={() => load()} />
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
  topPad: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  list: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing["3xl"] },
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
