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
import { listTodaysCrewInboxRows, type CrewInboxRow } from "@/lib/crewMessaging";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { canViewerActAsDriver, canViewerActAsPassenger } from "@/lib/commuteMatching";

export default function MessagesInboxScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [threads, setThreads] = useState<RideMessageThread[]>([]);
  const [crewInbox, setCrewInbox] = useState<CrewInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canDrive = profile ? canViewerActAsDriver(profile) : false;
  const isPassengerRole = profile ? canViewerActAsPassenger(profile) : false;

  const load = useCallback(async () => {
    if (!profile?.id) {
      setThreads([]);
      setCrewInbox([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const [rows, crews] = await Promise.all([
      listRideMessageThreads(profile.id, { canDrive, isPassengerRole }),
      listTodaysCrewInboxRows(profile.id),
    ]);
    setThreads(rows);
    setCrewInbox(crews);
    setLoading(false);
    setRefreshing(false);
  }, [profile?.id, canDrive, isPassengerRole]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  if (loading && threads.length === 0 && crewInbox.length === 0) {
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
          <View style={styles.headerBlock}>
            {crewInbox.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Crew chats (today)</Text>
                {crewInbox.map((c) => (
                  <TouchableOpacity
                    key={c.tripInstanceId}
                    style={styles.threadCard}
                    activeOpacity={0.75}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/profile/crew-chat/[tripInstanceId]",
                        params: { tripInstanceId: c.tripInstanceId },
                      })
                    }
                  >
                    <View style={[styles.threadIcon, styles.crewIcon]}>
                      <Ionicons name="dice-outline" size={22} color="#7C3AED" />
                    </View>
                    <View style={styles.threadBody}>
                      <Text style={styles.threadTitle} numberOfLines={1}>
                        {c.crewName}
                      </Text>
                      <Text style={styles.threadSub} numberOfLines={2}>
                        {c.subtitle}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.manageCrews}
                  onPress={() => router.push("/(tabs)/profile/crews")}
                  hitSlop={8}
                >
                  <Text style={styles.manageCrewsText}>Manage Poolyn Crews</Text>
                </TouchableOpacity>
                <Text style={styles.sectionLabel}>Ride chats</Text>
              </>
            ) : null}
            <Text style={styles.hint}>
              Crew chats reset each day with a fresh thread; ride chats are tied to an active booking. Only people in
              the same crew or ride can read messages.
            </Text>
          </View>
        }
        ListEmptyComponent={
          threads.length === 0 && crewInbox.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={44} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyBody}>
                Start a Poolyn Crew from Profile, or book a ride — then chats show up here.
              </Text>
              <TouchableOpacity
                style={styles.cta}
                onPress={() => router.push("/(tabs)/profile/crews")}
                activeOpacity={0.85}
              >
                <Text style={styles.ctaText}>Poolyn Crews</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaSecondary} onPress={() => router.push("/(tabs)/rides")} activeOpacity={0.85}>
                <Text style={styles.ctaSecondaryText}>My Rides</Text>
              </TouchableOpacity>
            </View>
          ) : null
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
  headerBlock: { marginBottom: Spacing.xs },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.lg,
    marginTop: Spacing.sm,
  },
  crewIcon: { backgroundColor: "#EDE9FE" },
  manageCrews: { alignSelf: "flex-start", marginBottom: Spacing.md, paddingVertical: Spacing.xs },
  manageCrewsText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
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
  ctaSecondary: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  ctaSecondaryText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
});
