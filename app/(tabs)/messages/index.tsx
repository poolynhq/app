import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { listRideMessageThreads, type RideMessageThread } from "@/lib/rideMessaging";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export default function MessagesInboxScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [threads, setThreads] = useState<RideMessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canDrive = profile?.role === "driver" || profile?.role === "both";
  const isPassengerRole = profile?.role === "passenger" || profile?.role === "both";

  const load = useCallback(async () => {
    if (!profile?.id) {
      setThreads([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const rows = await listRideMessageThreads(profile.id, { canDrive, isPassengerRole });
    setThreads(rows);
    setLoading(false);
    setRefreshing(false);
  }, [profile?.id, canDrive, isPassengerRole]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  if (loading && threads.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <FlatList
        data={threads}
        keyExtractor={(item) => item.rideId}
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
        ListHeaderComponent={
          <Text style={styles.hint}>
            Group chat for each active ride. Only you and your driver or passengers on that trip can read and send
            messages.
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={44} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No active ride chats</Text>
            <Text style={styles.emptyBody}>
              When you have a scheduled or in-progress ride, it appears here so you can coordinate pickup details.
            </Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.push("/(tabs)/rides")} activeOpacity={0.85}>
              <Text style={styles.ctaText}>Go to My Rides</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.threadCard}
            activeOpacity={0.75}
            onPress={() => router.push(`/(tabs)/messages/${item.rideId}`)}
          >
            <View style={styles.threadIcon}>
              <Ionicons name="car-outline" size={22} color={Colors.primary} />
            </View>
            <View style={styles.threadBody}>
              <Text style={styles.threadTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.threadSub} numberOfLines={2}>
                {item.subtitle}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing["3xl"] },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.lg,
    marginTop: Spacing.sm,
  },
  threadCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  threadIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  threadBody: { flex: 1, minWidth: 0 },
  threadTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  threadSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  empty: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.lg,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  cta: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  ctaText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
});
