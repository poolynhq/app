import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import {
  createCrew,
  createCrewInvitations,
  getOrCreateTripInstance,
  setCrewDesignatedDriver,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { showAlert } from "@/lib/platformAlert";
import type { User } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const FIRST_OPEN_KEY = "poolyn_crew_formation_intro_v1";

type Peer = { id: string; full_name: string | null };

type Props = {
  visible: boolean;
  onClose: () => void;
  profile: User;
  orgId: string | null;
  onCreated?: () => void;
};

export function CrewFormationModal({ visible, onClose, profile, orgId, onCreated }: Props) {
  const [introSeen, setIntroSeen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [detourMins, setDetourMins] = useState(
    Math.min(30, Math.max(5, profile.detour_tolerance_mins ?? 12))
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [crewName, setCrewName] = useState("My commute crew");
  const [maxPick, setMaxPick] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [inviteNote, setInviteNote] = useState("");

  const loadPeers = useCallback(async () => {
    if (!orgId || !profile.id) {
      setPeers([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("poolyn_org_crew_route_candidates", {
        p_detour_mins: detourMins,
      });
      if (error) throw error;
      setPeers((data as Peer[]) ?? []);
    } catch {
      setPeers([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, profile.id, detourMins]);

  const loadSeatsCap = useCallback(async () => {
    if (!profile.id) return;
    const { data } = await supabase
      .from("vehicles")
      .select("seats")
      .eq("user_id", profile.id)
      .eq("active", true)
      .order("seats", { ascending: false })
      .limit(1)
      .maybeSingle();
    const s = typeof data?.seats === "number" ? data.seats : 4;
    setMaxPick(Math.max(1, Math.min(6, s - 1)));
  }, [profile.id]);

  useEffect(() => {
    if (!visible) return;
    void AsyncStorage.getItem(FIRST_OPEN_KEY).then((v) => {
      setIntroSeen(v === "1");
    });
    void loadSeatsCap();
    setSelected(new Set());
    setInviteNote("");
    setDetourMins(Math.min(30, Math.max(5, profile.detour_tolerance_mins ?? 12)));
  }, [visible, loadSeatsCap, profile.detour_tolerance_mins]);

  useEffect(() => {
    if (!visible || !orgId || !profile.id) return;
    const t = setTimeout(() => {
      void loadPeers();
    }, 280);
    return () => clearTimeout(t);
  }, [visible, orgId, profile.id, detourMins, loadPeers]);

  async function persistDetour() {
    await supabase.from("users").update({ detour_tolerance_mins: detourMins }).eq("id", profile.id);
  }

  function togglePeer(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxPick) next.add(id);
      return next;
    });
  }

  async function markIntroSeen() {
    await AsyncStorage.setItem(FIRST_OPEN_KEY, "1");
    setIntroSeen(true);
  }

  async function handleCreate() {
    const name = crewName.trim() || "My commute crew";
    setSubmitting(true);
    try {
      await persistDetour();
      const created = await createCrew({
        name,
        userId: profile.id,
        orgId,
      });
      if (!created.ok) {
        showAlert("Could not create crew", created.reason);
        return;
      }
      const trip = await getOrCreateTripInstance(created.crewId, localDateKey());
      if (!trip.ok) {
        showAlert("Crew created", "Trip day could not be initialised. Open Profile → Crews to continue.");
        onClose();
        onCreated?.();
        return;
      }
      const driverSet = await setCrewDesignatedDriver(trip.row.id, profile.id);
      if (!driverSet.ok) {
        showAlert("Crew created", "Set yourself as driver from today’s crew chat if needed.");
      }
      const inviteIds = [...selected];
      let inviteOk = true;
      if (inviteIds.length) {
        const inv = await createCrewInvitations({
          crewId: created.crewId,
          invitedByUserId: profile.id,
          inviteeUserIds: inviteIds,
          message: inviteNote.trim() || null,
        });
        inviteOk = inv.ok;
      }
      const { data: codeRow } = await supabase
        .from("crews")
        .select("invite_code")
        .eq("id", created.crewId)
        .maybeSingle();
      const code = (codeRow?.invite_code as string | undefined)?.trim() ?? "—";
      const picked = peers.filter((p) => selected.has(p.id)).map((p) => p.full_name || "Teammate");
      const inviteLine =
        inviteIds.length === 0
          ? ""
          : inviteOk
            ? ` In-app invites were sent to ${inviteIds.length} teammate(s); they can accept or decline from Home (Routine Poolyn) or Profile → Crews.`
            : ` We could not send all in-app invites — share code ${code} as a fallback.`;
      showAlert(
        "Crew ready",
        `You’re today’s driver.${inviteLine} Invite code: ${code}${
          picked.length && !inviteIds.length
            ? ` — you can still share it with ${picked.join(", ")}.`
            : ""
        }\n\nDetour saved: ${detourMins} min.`
      );
      await markIntroSeen();
      onClose();
      onCreated?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (!orgId) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Form your Crew</Text>
            <Text style={styles.body}>
              Crew Poolyn needs a workplace on your profile. Join or create an organisation first.
            </Text>
            <Pressable style={styles.primary} onPress={onClose}>
              <Text style={styles.primaryText}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheetLarge}>
          <View style={styles.sheetGrab}>
            <View style={styles.grabBar} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={styles.title}>Form your Crew</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!introSeen ? (
              <View style={styles.callout}>
                <Ionicons name="people-circle-outline" size={22} color={Colors.primary} />
                <Text style={styles.calloutText}>
                  Pick coworkers whose home sits near your home→work line and whose workplace is in the
                  same metro area. Increase detour minutes to widen the corridor buffer along that line.
                </Text>
                <Pressable onPress={markIntroSeen}>
                  <Text style={styles.calloutDismiss}>Got it</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.label}>Crew name</Text>
            <TextInput
              value={crewName}
              onChangeText={setCrewName}
              placeholder="e.g. North route crew"
              style={styles.input}
              placeholderTextColor={Colors.textTertiary}
            />

            <Text style={styles.label}>Detour you&apos;ll accept (minutes)</Text>
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setDetourMins((m) => Math.max(5, m - 1))}
                accessibilityLabel="Decrease detour"
              >
                <Ionicons name="remove" size={22} color={Colors.primary} />
              </Pressable>
              <Text style={styles.stepValue}>{detourMins} min</Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setDetourMins((m) => Math.min(35, m + 1))}
                accessibilityLabel="Increase detour"
              >
                <Ionicons name="add" size={22} color={Colors.primary} />
              </Pressable>
              <Pressable
                style={styles.refreshBtn}
                onPress={() => {
                  void persistDetour();
                  void loadPeers();
                }}
              >
                <Ionicons name="refresh" size={18} color={Colors.primary} />
                <Text style={styles.refreshText}>Refresh list</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {peers.length} {peers.length === 1 ? "person matches" : "people match"} your route at{" "}
              {detourMins} min detour. Select up to {maxPick} — they get an in-app invite to accept or decline.
            </Text>

            <View style={styles.peerHead}>
              <Text style={styles.label}>People on your commute corridor</Text>
              {loading ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
            </View>
            {peers.length === 0 && !loading ? (
              <Text style={styles.empty}>
                No one in your org matches this corridor yet. Confirm home and work pins in Profile, widen
                detour, or tap Refresh after updating locations.
              </Text>
            ) : (
              peers.map((p) => {
                const on = selected.has(p.id);
                const disabled = !on && selected.size >= maxPick;
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.peerRow, disabled && styles.peerRowDisabled]}
                    onPress={() => !disabled && togglePeer(p.id)}
                    disabled={disabled && !on}
                  >
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                    </View>
                    <Text style={styles.peerName}>{p.full_name?.trim() || "Poolyn member"}</Text>
                  </Pressable>
                );
              })
            )}

            <Text style={styles.label}>Optional note with invite</Text>
            <TextInput
              value={inviteNote}
              onChangeText={setInviteNote}
              placeholder="e.g. North route, leaving ~7:15"
              placeholderTextColor={Colors.textTertiary}
              style={styles.inviteNoteInput}
              multiline
              maxLength={280}
            />

            <Text style={styles.footerNote}>
              You start as today&apos;s driver. Open group chat to roll dice or assign driver. Others can still
              join with the invite code if they miss the in-app invite.
            </Text>
          </ScrollView>

          <Pressable
            style={[styles.primary, submitting && styles.primaryDisabled]}
            onPress={() => void handleCreate()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Create crew &amp; send invites</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    ...Shadow.lg,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.45)",
  },
  sheetLarge: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "88%",
    paddingBottom: Spacing.xl,
    ...Shadow.lg,
  },
  sheetGrab: { alignItems: "center", paddingTop: Spacing.sm },
  grabBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  scroll: { maxHeight: 420 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    flex: 1,
  },
  body: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 21, marginBottom: Spacing.md },
  callout: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  calloutText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  calloutDismiss: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  inviteNoteInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: FontSize.sm,
    color: Colors.text,
    backgroundColor: Colors.background,
    minHeight: 72,
    textAlignVertical: "top",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.xs,
    flexWrap: "wrap",
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  stepValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    minWidth: 72,
    textAlign: "center",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
  },
  refreshText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  peerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.lg,
  },
  empty: { fontSize: FontSize.sm, color: Colors.textTertiary, fontStyle: "italic", marginTop: Spacing.sm },
  peerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  peerRowDisabled: { opacity: 0.45 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  peerName: { fontSize: FontSize.base, color: Colors.text, flex: 1 },
  footerNote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.lg,
    lineHeight: 18,
  },
  primary: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
    alignItems: "center",
    ...Shadow.sm,
  },
  primaryDisabled: { opacity: 0.7 },
  primaryText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
});
