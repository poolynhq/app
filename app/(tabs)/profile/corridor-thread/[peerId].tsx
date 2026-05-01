import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

type MsgRow = { id: string; sender_id: string; body: string; created_at: string };

export default function CorridorThreadScreen() {
  const router = useRouter();
  const { peerId: peerIdParam } = useLocalSearchParams<{ peerId: string }>();
  const { profile } = useAuth();
  const [peerName, setPeerName] = useState("");
  const [rows, setRows] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const me = profile?.id;
  const peer =
    typeof peerIdParam === "string"
      ? peerIdParam
      : Array.isArray(peerIdParam)
        ? peerIdParam[0] ?? ""
        : "";

  const loadThread = useCallback(async () => {
    if (!me || !peer || peer === me) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: peerUser } = await supabase.from("users").select("full_name").eq("id", peer).maybeSingle();
      setPeerName(String(peerUser?.full_name ?? "").trim() || "Member");

      const t1 = await supabase
        .from("poolyn_corridor_dm_threads")
        .select("id")
        .eq("user_low", me)
        .eq("user_high", peer)
        .maybeSingle();
      const tid =
        t1.data?.id ??
        (
          await supabase
            .from("poolyn_corridor_dm_threads")
            .select("id")
            .eq("user_low", peer)
            .eq("user_high", me)
            .maybeSingle()
        ).data?.id ??
        null;

      if (!tid) {
        setRows([]);
        return;
      }

      const { data: msgs, error } = await supabase
        .from("poolyn_corridor_dm_messages")
        .select("id, sender_id, body, created_at")
        .eq("thread_id", tid)
        .order("created_at", { ascending: true });
      if (!error && msgs) setRows(msgs as MsgRow[]);
    } finally {
      setLoading(false);
    }
  }, [me, peer]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  async function send() {
    const t = body.trim();
    if (!t || !me || !peer) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("poolyn_send_corridor_dm_message", {
        p_to_user_id: peer,
        p_body: t,
      });
      const payload = data as { ok?: boolean; error?: string } | null;
      if (error || !payload?.ok) {
        if (payload?.error === "no_thread") {
          showAlert(
            "Not connected yet",
            "Ask them to accept your route intro in Activity first. Until then, only the first intro note is sent."
          );
        } else {
          showAlert("Could not send", error?.message ?? "Try again.");
        }
        return;
      }
      setBody("");
      void loadThread();
    } finally {
      setSending(false);
    }
  }

  if (!me) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Stack.Screen options={{ title: "Messages" }} />
        <View style={styles.center}>
          <Text style={styles.muted}>Sign in to view messages.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!peer || peer === me) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Stack.Screen options={{ title: "Messages" }} />
        <View style={styles.center}>
          <Text style={styles.muted}>Invalid conversation.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: peerName || "Messages" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={88}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="chatbubbles-outline" size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No thread yet</Text>
            <Text style={styles.emptyBody}>
              Messages appear here after a route intro is accepted. Send an intro from Who is on my route on Home.
            </Text>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={styles.backBtnText}>Go back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const mine = item.sender_id === me;
              return (
                <View style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
                      {item.body}
                    </Text>
                    <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
                      {new Date(item.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {!loading && rows.length > 0 ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={body}
              onChangeText={setBody}
              placeholder="Write a message..."
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={2000}
              editable={!sending}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
              disabled={!body.trim() || sending}
              onPress={() => void send()}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color={Colors.textOnPrimary} />
              ) : (
                <Ionicons name="send" size={20} color={Colors.textOnPrimary} />
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl, gap: Spacing.sm },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center" },
  listContent: { padding: Spacing.md, paddingBottom: Spacing["2xl"] },
  bubbleWrap: { marginBottom: Spacing.sm, maxWidth: "92%" },
  bubbleWrapMine: { alignSelf: "flex-end" },
  bubbleWrapTheirs: { alignSelf: "flex-start" },
  bubble: {
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  bubbleMine: { backgroundColor: Colors.primary },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  bubbleText: { fontSize: FontSize.sm, lineHeight: 20 },
  bubbleTextMine: { color: Colors.textOnPrimary },
  bubbleTextTheirs: { color: Colors.text },
  time: { fontSize: 10, marginTop: 4 },
  timeMine: { color: "rgba(255,255,255,0.85)" },
  timeTheirs: { color: Colors.textTertiary },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.45 },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text, marginTop: Spacing.sm },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginTop: Spacing.xs,
  },
  backBtn: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  backBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
});
