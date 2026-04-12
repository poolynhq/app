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
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import {
  fetchRideMessagesWithContext,
  sendRideMessage,
  type RideMessageRow,
} from "@/lib/rideMessaging";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";
import type { RealtimeChannel } from "@supabase/supabase-js";

export default function RideChatScreen() {
  const { rideId: rideIdParam } = useLocalSearchParams<{ rideId: string | string[] }>();
  const rideId = Array.isArray(rideIdParam) ? rideIdParam[0] : rideIdParam;
  const navigation = useNavigation();
  const { profile } = useAuth();
  const headerHeight = useHeaderHeight();
  const [messages, setMessages] = useState<RideMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<RideMessageRow>>(null);
  const didInitialLoadForRideRef = useRef<string | null>(null);

  const loadThread = useCallback(async () => {
    if (!rideId || !profile?.id) return;
    const rows = await fetchRideMessagesWithContext(rideId, profile.id);
    setMessages(rows);
  }, [rideId, profile?.id]);

  useLayoutEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("rides")
        .select("adhoc_trip_title, poolyn_context")
        .eq("id", rideId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        navigation.setOptions({ title: "Ride chat" });
        return;
      }
      const titled = data.poolyn_context === "adhoc" ? data.adhoc_trip_title?.trim() : "";
      navigation.setOptions({ title: titled || "Ride chat" });
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, navigation]);

  useEffect(() => {
    didInitialLoadForRideRef.current = null;
  }, [rideId]);

  useFocusEffect(
    useCallback(() => {
      if (!rideId || !profile?.id) return;
      const firstForThisRide = didInitialLoadForRideRef.current !== rideId;
      if (firstForThisRide) {
        setLoading(true);
      }
      void (async () => {
        try {
          await loadThread();
          didInitialLoadForRideRef.current = rideId;
        } finally {
          if (firstForThisRide) setLoading(false);
        }
      })();
    }, [rideId, profile?.id, loadThread])
  );

  useEffect(() => {
    if (!rideId || !profile?.id) return;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void loadThread();
      }, 200);
    };

    const channel: RealtimeChannel = supabase
      .channel(`ride-messages:${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `ride_id=eq.${rideId}`,
        },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [rideId, profile?.id, loadThread]);

  async function onSend() {
    if (!rideId || !profile?.id || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const res = await sendRideMessage(rideId, profile.id, text);
    setSending(false);
    if (!res.ok) {
      if (res.reason === "empty") return;
      showAlert("Could not send", res.reason === "too_long" ? "Message is too long." : res.reason);
      return;
    }
    setDraft("");
    await loadThread();
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }

  if (!rideId) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Missing ride.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        ref={listRef}
        data={messages}
        extraData={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyThread}>
            <Text style={styles.emptyThreadText}>No messages yet. Say hi and confirm your pickup spot.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.sender_id === profile?.id;
          const label = mine ? "You" : (item.sender_name ?? "").trim() || "Co-commuter";
          return (
            <View style={[styles.bubbleWrap, mine && styles.bubbleWrapMine]}>
              <Text style={styles.bubbleMeta}>{label}</Text>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.body}</Text>
              </View>
              <Text style={styles.bubbleTime}>
                {new Date(item.sent_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message your carpool…"
          placeholderTextColor={Colors.textTertiary}
          multiline
          maxLength={2000}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
          onPress={() => void onSend()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
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
  fallback: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.background },
  fallbackText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  emptyThread: { paddingVertical: Spacing["2xl"], paddingHorizontal: Spacing.md },
  emptyThreadText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  bubbleWrap: { alignSelf: "flex-start", maxWidth: "88%", marginBottom: Spacing.md },
  bubbleWrapMine: { alignSelf: "flex-end" },
  bubbleMeta: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    marginBottom: 4,
    marginLeft: 2,
  },
  bubble: {
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  bubbleTheirs: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleMine: {
    backgroundColor: Colors.primary,
  },
  bubbleText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  bubbleTextMine: { color: Colors.textOnPrimary },
  bubbleTime: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: FontSize.sm,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.45 },
});
