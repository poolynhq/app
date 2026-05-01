import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import {
  shortActivityCta,
  summarizeActivityNotification,
} from "@/lib/activityNotificationCopy";
import type { Notification } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

const ACTIVITY_DISMISSED_KEY = "poolyn_activity_dismissed_notification_ids";

function inviteCodeFromData(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const o = data as Record<string, unknown>;
  const raw = o.invite_code;
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase().slice(0, 8);
}

function jsonStringField(data: unknown, key: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const v = (data as Record<string, unknown>)[key];
  return typeof v === "string" ? v.trim() : "";
}

export default function ActivityScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ACTIVITY_DISMISSED_KEY).then((raw) => {
      try {
        const arr = JSON.parse(raw ?? "[]") as unknown;
        if (Array.isArray(arr)) {
          setDismissedIds(new Set(arr.filter((x): x is string => typeof x === "string")));
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  const visibleRows = useMemo(
    () => rows.filter((r) => !dismissedIds.has(r.id)),
    [rows, dismissedIds]
  );

  async function persistDismissedIds(next: Set<string>) {
    await AsyncStorage.setItem(ACTIVITY_DISMISSED_KEY, JSON.stringify([...next]));
  }

  async function dismissNotification(id: string) {
    setDismissedIds((prev) => {
      const n = new Set([...prev, id]);
      void persistDismissedIds(n);
      return n;
    });
  }

  function promptClearAll() {
    if (rows.length === 0) return;
    showAlert(
      "Clear all from Activity?",
      "Hides every notification in this list. New ones will still show up when they arrive.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: () => void clearAllNotifications(),
        },
      ]
    );
  }

  async function clearAllNotifications() {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    setDismissedIds((prev) => {
      const n = new Set([...prev, ...ids]);
      void persistDismissedIds(n);
      return n;
    });
    await supabase.from("notifications").update({ read: true }).in("id", ids);
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, read: true } : r)));
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) {
      setRows(data as Notification[]);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, read: true } : r)));
  }

  async function respondCorridorIntro(item: Notification, accept: boolean) {
    const rid = jsonStringField(item.data, "request_id");
    if (!rid) {
      showAlert("Error", "Missing request.");
      return;
    }
    setRespondingId(item.id);
    try {
      const { data, error } = await supabase.rpc("poolyn_respond_corridor_intro_request", {
        p_request_id: rid,
        p_accept: accept,
      });
      const payload = data as { ok?: boolean } | null;
      if (error || !payload?.ok) {
        showAlert("Could not update", error?.message ?? "Try again.");
        return;
      }
      await markRead(item.id);
      await load();
      if (accept) {
        const fromUid = jsonStringField(item.data, "from_user_id");
        if (fromUid) {
          router.push({
            pathname: "/(tabs)/profile/corridor-thread/[peerId]",
            params: { peerId: fromUid },
          });
        }
      }
    } finally {
      setRespondingId(null);
    }
  }

  function openJoinInvite(item: Notification) {
    void markRead(item.id);
    const code = inviteCodeFromData(item.data);
    if (code.length >= 8) {
      router.push({ pathname: "/(auth)/join-org", params: { code } });
      return;
    }
    router.push("/(auth)/join-org");
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={visibleRows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          rows.length > 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>List cleared</Text>
              <Text style={styles.emptyBody}>
                Pull down to refresh. New notifications will appear here when they arrive.
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptyBody}>
                Workplace invites and updates from Poolyn will show up here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          visibleRows.length > 0 ? (
            <TouchableOpacity
              style={styles.clearAllBtn}
              onPress={promptClearAll}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Clear all notifications from this list"
            >
              <Text style={styles.clearAllText}>Clear all from this list</Text>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          const isJoinInvite = item.type === "network_join_invite";
          const isRideRequest = item.type === "ride_request_pending";
          const isRideAccepted = item.type === "ride_request_accepted";
          const isCrewTripStarted = item.type === "crew_trip_driver_started";
          const isContributionUpdated = item.type === "ride_contribution_updated";
          const isAdhocSeatOrTrip =
            item.type === "adhoc_seat_request" ||
            item.type === "adhoc_seat_accepted" ||
            item.type === "adhoc_seat_declined" ||
            item.type === "adhoc_seat_cancelled" ||
            item.type === "adhoc_passenger_cancelled_seat" ||
            item.type === "adhoc_driver_removed_you" ||
            item.type === "adhoc_trip_cancelled_by_driver" ||
            item.type === "adhoc_you_cancelled_seat";
          const isCorridorIntroRequest = item.type === "corridor_intro_request";
          const isCorridorIntroAccepted = item.type === "corridor_intro_accepted";
          const isCorridorIntroDeclined = item.type === "corridor_intro_declined";
          const isCorridorDm = item.type === "corridor_dm_message";
          const summary = summarizeActivityNotification({
            type: item.type,
            title: item.title,
            body: item.body,
          });
          const cta = shortActivityCta({ type: item.type });
          const busy = respondingId === item.id;
          return (
            <View style={[styles.rowWrap, !item.read && styles.rowUnread]}>
              <View style={styles.rowInner}>
                {!item.read ? <View style={styles.unreadDot} /> : null}
                <TouchableOpacity
                  style={styles.rowTextCol}
                  accessibilityHint={
                    isCorridorIntroRequest ? "Use Accept or Decline below" : (cta ?? undefined)
                  }
                  onPress={() => {
                    if (isJoinInvite) {
                      openJoinInvite(item);
                      return;
                    }
                    if (isRideRequest) {
                      void markRead(item.id);
                      router.push("/(tabs)/rides?tab=open");
                      return;
                    }
                    if (isRideAccepted) {
                      void markRead(item.id);
                      router.push("/(tabs)/rides");
                      return;
                    }
                    if (isCrewTripStarted) {
                      void markRead(item.id);
                      router.push("/(tabs)/home");
                      return;
                    }
                    if (isContributionUpdated) {
                      void markRead(item.id);
                      router.push("/(tabs)/rides");
                      return;
                    }
                    if (isAdhocSeatOrTrip) {
                      void markRead(item.id);
                      router.push("/(tabs)/rides");
                      return;
                    }
                    if (isCorridorIntroRequest) {
                      void markRead(item.id);
                      return;
                    }
                    if (isCorridorIntroAccepted) {
                      void markRead(item.id);
                      const peer = jsonStringField(item.data, "peer_user_id");
                      if (peer) {
                        router.push({
                          pathname: "/(tabs)/profile/corridor-thread/[peerId]",
                          params: { peerId: peer },
                        });
                      }
                      return;
                    }
                    if (isCorridorDm) {
                      void markRead(item.id);
                      const peer = jsonStringField(item.data, "from_user_id");
                      if (peer) {
                        router.push({
                          pathname: "/(tabs)/profile/corridor-thread/[peerId]",
                          params: { peerId: peer },
                        });
                      }
                      return;
                    }
                    if (isCorridorIntroDeclined) {
                      void markRead(item.id);
                      return;
                    }
                    void markRead(item.id);
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.rowTitle}>{summary.title}</Text>
                  {summary.body ? (
                    <Text style={styles.rowBody} numberOfLines={4}>
                      {summary.body}
                    </Text>
                  ) : null}
                  <Text style={styles.rowMeta}>{new Date(item.created_at).toLocaleString()}</Text>
                  {cta ? <Text style={styles.rowCta}>{cta}</Text> : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dismissBtn}
                  onPress={() => void dismissNotification(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close-circle-outline" size={22} color={Colors.textTertiary} />
                </TouchableOpacity>
              </View>
              {isCorridorIntroRequest ? (
                <View style={styles.corridorActions}>
                  <TouchableOpacity
                    style={[styles.corridorBtn, styles.corridorAccept]}
                    disabled={busy}
                    onPress={() => void respondCorridorIntro(item, true)}
                    activeOpacity={0.85}
                  >
                    {busy ? (
                      <ActivityIndicator color={Colors.textOnPrimary} />
                    ) : (
                      <Text style={[styles.corridorBtnText, styles.corridorAcceptText]}>Accept</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.corridorBtn, styles.corridorDecline]}
                    disabled={busy}
                    onPress={() => void respondCorridorIntro(item, false)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.corridorBtnText, styles.corridorDeclineText]}>Decline</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContent: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  rowWrap: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  rowInner: { flexDirection: "row", alignItems: "flex-start" },
  rowUnread: { borderColor: Colors.primary },
  rowTextCol: { flex: 1, minWidth: 0 },
  dismissBtn: { paddingTop: 2, marginLeft: Spacing.xs },
  rowTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  rowBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  rowMeta: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.sm },
  rowCta: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.primary,
    marginTop: Spacing.sm,
  },
  corridorActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  corridorBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  corridorAccept: { backgroundColor: Colors.primary },
  corridorDecline: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  corridorBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  corridorAcceptText: { color: Colors.textOnPrimary },
  corridorDeclineText: { color: Colors.textSecondary },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginTop: 6,
    marginLeft: Spacing.sm,
  },
  empty: { alignItems: "center", paddingVertical: Spacing["3xl"], gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
    lineHeight: 20,
  },
  clearAllBtn: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  clearAllText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
});
