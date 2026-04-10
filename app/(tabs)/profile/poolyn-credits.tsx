import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { CommuteCreditsLedgerEntry } from "@/types/database";
import { formatPoolynCreditsBalance } from "@/lib/poolynCreditsUi";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

function txnTitle(t: CommuteCreditsLedgerEntry["txn_type"]): string {
  switch (t) {
    case "credit_earned":
      return "Trip earnings";
    case "credit_used":
      return "Applied to trip share";
    case "credit_adjustment":
      return "Balance update";
    default:
      return "Activity";
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function PoolynCreditsActivityScreen() {
  const { profile, refreshProfile } = useAuth();
  const [rows, setRows] = useState<CommuteCreditsLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("commute_credits_ledger")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!error && data) setRows(data as CommuteCreditsLedgerEntry[]);
    else setRows([]);
    setLoading(false);
    setRefreshing(false);
  }, [profile?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
      void refreshProfile();
    }, [load, refreshProfile])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
    void refreshProfile();
  }, [load, refreshProfile]);

  const balance = profile?.commute_credits_balance ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.header}>
        <Text style={styles.balance}>{formatPoolynCreditsBalance(balance)}</Text>
        <Text style={styles.sub}>Current balance</Text>
        <Text style={styles.hint}>
          Credits add up when you drive for others. When you ride, they can cover your trip share — any
          separate cash service fee still applies unless your workplace network includes it.
        </Text>
      </View>
      <Text style={styles.sectionTitle}>Recent activity</Text>
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="wallet-outline" size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptyBody}>
                Complete a trip as a driver to start building your balance.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const up = item.delta > 0;
            return (
              <View style={styles.row}>
                <View
                  style={[styles.deltaBadge, up ? styles.deltaBadgeUp : styles.deltaBadgeDown]}
                >
                  <Ionicons
                    name={up ? "arrow-up" : "arrow-down"}
                    size={14}
                    color={up ? Colors.primaryDark : Colors.warning}
                  />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{txnTitle(item.txn_type)}</Text>
                  <Text style={styles.rowMeta}>{formatWhen(item.created_at)}</Text>
                  {item.description ? (
                    <Text style={styles.rowDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.deltaText, up ? styles.deltaTextUp : styles.deltaTextDown]}>
                  {item.delta > 0 ? "+" : item.delta < 0 ? "−" : ""}
                  {formatPoolynCreditsBalance(Math.abs(item.delta))}
                </Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  balance: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  sub: {
    marginTop: 4,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  hint: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    lineHeight: 20,
    color: Colors.textTertiary,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing["4xl"],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
  },
  deltaBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  deltaBadgeUp: { backgroundColor: Colors.primaryLight },
  deltaBadgeDown: { backgroundColor: Colors.accentLight },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  rowMeta: {
    marginTop: 2,
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
  rowDesc: {
    marginTop: 4,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  deltaText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  deltaTextUp: { color: Colors.primaryDark },
  deltaTextDown: { color: Colors.warning },
  empty: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    marginTop: Spacing.md,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  emptyBody: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
});
