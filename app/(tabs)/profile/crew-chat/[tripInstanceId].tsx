import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Ionicons } from "@expo/vector-icons";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import {
  fetchCrewMessages,
  fetchCrewName,
  fetchCrewRoster,
  fetchCrewTripInstance,
  rollCrewDriverDice,
  setCrewDesignatedDriver,
  sendCrewUserMessage,
  type CrewMessageRow,
  type CrewRosterMember,
  type CrewTripInstanceRow,
} from "@/lib/crewMessaging";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

function rollErrorMessage(raw: string): string {
  const m: Record<string, string> = {
    not_in_crew: "You are not a member of this crew.",
    trip_not_found: "This chat is no longer available.",
    no_members: "Add members before rolling.",
    no_eligible_members: "No one in your pool is in this crew. Tap names below to fix the pool.",
  };
  return m[raw] ?? raw;
}

export default function CrewTripChatScreen() {
  const { tripInstanceId: tripParam } = useLocalSearchParams<{ tripInstanceId: string | string[] }>();
  const tripInstanceId = Array.isArray(tripParam) ? tripParam[0] : tripParam;
  const { profile } = useAuth();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const [crewName, setCrewName] = useState<string | null>(null);
  const [tripRow, setTripRow] = useState<CrewTripInstanceRow | null>(null);
  const [messages, setMessages] = useState<CrewMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [roster, setRoster] = useState<CrewRosterMember[]>([]);
  const [eligibleIds, setEligibleIds] = useState<Set<string>>(new Set());
  const listRef = useRef<FlatList<CrewMessageRow>>(null);

  const reload = useCallback(async () => {
    if (!tripInstanceId) return;
    const row = await fetchCrewTripInstance(tripInstanceId);
    setTripRow(row);
    if (row?.crew_id) {
      setCrewName(await fetchCrewName(row.crew_id));
    }
    setMessages(await fetchCrewMessages(tripInstanceId));
    setLoading(false);
  }, [tripInstanceId]);

  useEffect(() => {
    if (!tripInstanceId) return;
    setLoading(true);
    void reload();
  }, [tripInstanceId, reload]);

  useEffect(() => {
    if (!tripRow?.crew_id) return;
    void fetchCrewRoster(tripRow.crew_id).then((r) => {
      setRoster(r);
      setEligibleIds(new Set(r.map((x) => x.userId)));
    });
  }, [tripRow?.crew_id]);

  useLayoutEffect(() => {
    const t = crewName?.trim() ? `${crewName} · today` : "Crew chat";
    navigation.setOptions({ title: t });
  }, [navigation, crewName]);

  useEffect(() => {
    if (!tripInstanceId) return;

    const onInsert = (row: CrewMessageRow) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, row];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    };

    const channel: RealtimeChannel = supabase
      .channel(`crew-messages:${tripInstanceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crew_messages",
          filter: `crew_trip_instance_id=eq.${tripInstanceId}`,
        },
        (payload) => {
          const r = payload.new as {
            id: string;
            sender_id: string | null;
            body: string;
            kind: string;
            meta: unknown;
            sent_at: string;
          };
          void (async () => {
            let sender_name: string | null = null;
            if (r.sender_id) {
              const { data: u } = await supabase
                .from("users")
                .select("full_name")
                .eq("id", r.sender_id)
                .maybeSingle();
              sender_name = (u?.full_name as string | null) ?? null;
            }
            onInsert({
              id: r.id,
              sender_id: r.sender_id,
              body: r.body,
              kind: r.kind,
              meta: (r.meta as CrewMessageRow["meta"]) ?? {},
              sent_at: r.sent_at,
              sender_name,
            });
            if (r.kind === "system" || r.kind === "dice") {
              void reload();
            }
          })();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tripInstanceId, reload]);

  async function onSend() {
    if (!tripInstanceId || !profile?.id || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const res = await sendCrewUserMessage(tripInstanceId, profile.id, text);
    setSending(false);
    if (!res.ok) {
      if (res.reason === "empty") return;
      showAlert("Could not send", res.reason === "too_long" ? "Message is too long." : res.reason);
      return;
    }
    setDraft("");
    void reload();
  }

  function togglePoolMember(userId: string) {
    setEligibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        if (next.size <= 1) return prev;
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  function selectAllInPool() {
    setEligibleIds(new Set(roster.map((r) => r.userId)));
  }

  async function onRollDice() {
    if (!tripInstanceId || rolling) return;
    const pool = [...eligibleIds];
    if (pool.length < 1) {
      showAlert("Dice pool", "Select at least one person who might drive today.");
      return;
    }
    setRolling(true);
    const res = await rollCrewDriverDice(tripInstanceId, pool);
    setRolling(false);
    if (!res.ok) {
      showAlert("Dice roll", rollErrorMessage(res.reason));
      return;
    }
    void reload();
  }

  async function onClaimDriver() {
    if (!tripInstanceId || !profile?.id || claiming) return;
    setClaiming(true);
    const res = await setCrewDesignatedDriver(tripInstanceId, profile.id);
    setClaiming(false);
    if (!res.ok) {
      showAlert("Could not set driver", res.reason.replace(/_/g, " "));
      return;
    }
    void reload();
  }

  const designatedId = tripRow?.designated_driver_user_id ?? null;
  const iAmDriver = !!(profile?.id && designatedId && profile.id === designatedId);

  if (!tripInstanceId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Missing chat.</Text>
      </View>
    );
  }

  if (loading && !tripRow) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {iAmDriver ? (
        <View style={styles.driverBanner}>
          <Ionicons name="star" size={18} color="#B45309" />
          <Text style={styles.driverBannerText}>You&apos;re today&apos;s driver — lead timing in this chat.</Text>
        </View>
      ) : designatedId ? (
        <View style={styles.driverHint}>
          <Text style={styles.driverHintText}>
            Today&apos;s driver is chosen — they coordinate pickup order and departure.
          </Text>
        </View>
      ) : (
        <View style={styles.driverHint}>
          <Text style={styles.driverHintText}>Roll the dice to pick today&apos;s driver.</Text>
        </View>
      )}

      {roster.length > 0 ? (
        <View style={styles.poolSection}>
          <View style={styles.poolHeader}>
            <Text style={styles.poolTitle}>Today&apos;s driver pool</Text>
            <TouchableOpacity onPress={selectAllInPool} hitSlop={8}>
              <Text style={styles.poolSelectAll}>Select all</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.poolHint}>
            Tap people who are in for driving today. The dice picks one at random from this list.
          </Text>
          <View style={styles.poolChips}>
            {roster.map((m) => {
              const on = eligibleIds.has(m.userId);
              return (
                <TouchableOpacity
                  key={m.userId}
                  style={[styles.poolChip, on && styles.poolChipOn]}
                  onPress={() => togglePoolMember(m.userId)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={on ? Colors.textOnPrimary : Colors.textSecondary}
                  />
                  <Text style={[styles.poolChipText, on && styles.poolChipTextOn]} numberOfLines={1}>
                    {(m.fullName || "Member").trim()}
                    {m.userId === profile?.id ? " (you)" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.diceBtn}
        onPress={() => void onRollDice()}
        disabled={rolling}
        activeOpacity={0.85}
      >
        {rolling ? (
          <ActivityIndicator color={Colors.textOnPrimary} />
        ) : (
          <>
            <Ionicons name="dice-outline" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.diceBtnText}>Roll dice for today&apos;s driver</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.claimBtn}
        onPress={() => void onClaimDriver()}
        disabled={claiming || iAmDriver}
        activeOpacity={0.85}
      >
        {claiming ? (
          <ActivityIndicator color={Colors.primary} />
        ) : (
          <>
            <Ionicons name="car-outline" size={20} color={Colors.primary} />
            <Text style={styles.claimBtnText}>
              {iAmDriver ? "You’re marked as today’s driver" : "I’m driving today (publish)"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) => {
          if (m.kind === "system" || m.kind === "dice") {
            return (
              <View style={styles.systemWrap}>
                <View style={m.kind === "dice" ? styles.diceBubble : styles.systemBubble}>
                  <Text style={styles.systemText}>{m.body}</Text>
                </View>
              </View>
            );
          }
          const mine = m.sender_id === profile?.id;
          return (
            <View style={[styles.msgRow, mine && styles.msgRowMine]}>
              <View style={[styles.msgBubble, mine ? styles.msgBubbleMine : styles.msgBubbleTheirs]}>
                {!mine && m.sender_name ? (
                  <Text style={styles.senderLabel}>{m.sender_name}</Text>
                ) : null}
                <Text style={[styles.msgText, mine && styles.msgTextMine]}>{m.body}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message your crew…"
          placeholderTextColor={Colors.textTertiary}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
          onPress={() => void onSend()}
          disabled={!draft.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator color={Colors.textOnPrimary} size="small" />
          ) : (
            <Ionicons name="send" size={20} color={Colors.textOnPrimary} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  muted: { color: Colors.textSecondary },
  driverBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  driverBannerText: { flex: 1, fontSize: FontSize.sm, color: "#92400E", fontWeight: FontWeight.medium },
  driverHint: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  driverHintText: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
  poolSection: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  poolHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  poolTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.text },
  poolSelectAll: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.primary },
  poolHint: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 17, marginBottom: Spacing.sm },
  poolChips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  poolChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    maxWidth: "100%",
  },
  poolChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  poolChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.text, maxWidth: 200 },
  poolChipTextOn: { color: Colors.textOnPrimary },
  diceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: "#7C3AED",
  },
  diceBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
  },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  claimBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  listContent: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  systemWrap: { alignItems: "center", marginVertical: Spacing.xs },
  systemBubble: {
    maxWidth: "92%",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.borderLight,
  },
  diceBubble: {
    maxWidth: "92%",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: "#EDE9FE",
    borderWidth: 1,
    borderColor: "#C4B5FD",
  },
  systemText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  msgRow: { alignItems: "flex-start", marginVertical: 4 },
  msgRowMine: { alignItems: "flex-end" },
  msgBubble: {
    maxWidth: "85%",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  msgBubbleMine: { backgroundColor: Colors.primary },
  msgBubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  senderLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  msgText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  msgTextMine: { color: Colors.textOnPrimary },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnOff: { opacity: 0.45 },
});
