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

export default function ActivityScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

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

  async function dismissNotification(id: string) {
    setDismissedIds((prev) => new Set([...prev, id]));
    let arr: string[] = [];
    try {
      const raw = await AsyncStorage.getItem(ACTIVITY_DISMISSED_KEY);
      const parsed = JSON.parse(raw ?? "[]");
      arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      arr = [];
    }
    if (!arr.includes(id)) arr.push(id);
    await AsyncStorage.setItem(ACTIVITY_DISMISSED_KEY, JSON.stringify(arr));
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
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>
              Workplace invites and updates from Poolyn will show up here.
            </Text>
          </View>
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
          return (
            <View style={[styles.row, !item.read && styles.rowUnread]}>
              {!item.read ? <View style={styles.unreadDot} /> : null}
              <TouchableOpacity
                style={styles.rowTextCol}
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
                  void markRead(item.id);
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.rowTitle}>{item.title}</Text>
                {item.body ? <Text style={styles.rowBody}>{item.body}</Text> : null}
                <Text style={styles.rowMeta}>{new Date(item.created_at).toLocaleString()}</Text>
                {isJoinInvite ? (
                  <Text style={styles.rowCta}>Tap to join with invite code →</Text>
                ) : null}
                {isRideRequest ? (
                  <Text style={styles.rowCta}>Tap to open Respond on My Rides →</Text>
                ) : null}
                {isCrewTripStarted ? (
                  <Text style={styles.rowCta}>Tap to open Home and confirm pickup readiness</Text>
                ) : null}
                {isContributionUpdated ? (
                  <Text style={styles.rowCta}>Tap to open My Rides for pricing details →</Text>
                ) : null}
                {isAdhocSeatOrTrip ? (
                  <Text style={styles.rowCta}>Tap to open My Rides →</Text>
                ) : null}
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
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
  },
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
});
