import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchDriverTransactions,
  fetchRiderTransactions,
  filterByPaymentStatus,
  formatAudFromCents,
  paymentStatusLabel,
  sortTransactions,
  type DriverTransaction,
  type RiderTransaction,
  type TransactionSortKey,
  type TransactionStatusFilter,
} from "@/lib/paymentHistory";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

type Mode = "rider" | "driver";

const SORT_OPTIONS: { key: TransactionSortKey; label: string }[] = [
  { key: "date_desc", label: "Newest trip" },
  { key: "date_asc", label: "Oldest trip" },
  { key: "amount_desc", label: "Highest amount" },
  { key: "amount_asc", label: "Lowest amount" },
];

const STATUS_FILTERS: { key: TransactionStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
  { key: "refunded", label: "Refunded" },
];

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-AU", {
      weekday: "short",
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

function tripKindLabel(ctx: string | null | undefined): string {
  if (ctx === "crew") return "Group (crew)";
  if (ctx === "adhoc") return "Listed trip";
  return "Commute";
}

export default function PaymentHistoryScreen() {
  const [mode, setMode] = useState<Mode>("rider");
  const [sort, setSort] = useState<TransactionSortKey>("date_desc");
  const [statusFilter, setStatusFilter] = useState<TransactionStatusFilter>("all");
  const [riderRows, setRiderRows] = useState<RiderTransaction[]>([]);
  const [driverRows, setDriverRows] = useState<DriverTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [r, d] = await Promise.all([fetchRiderTransactions(), fetchDriverTransactions()]);
    setRiderRows(r);
    setDriverRows(d);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const displayed = useMemo(() => {
    const raw = mode === "rider" ? riderRows : driverRows;
    const filtered = filterByPaymentStatus(raw, statusFilter);
    return sortTransactions(filtered, sort);
  }, [mode, riderRows, driverRows, sort, statusFilter]);

  function renderRider({ item }: { item: RiderTransaction }) {
    const total = item.cash_to_charge_cents ?? 0;
    const share = item.expected_contribution_cents ?? 0;
    const fee = item.network_fee_cents ?? 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.date}>{formatWhen(item.trip_depart_at)}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{paymentStatusLabel(item.payment_status)}</Text>
          </View>
        </View>
        <Text style={styles.whoLine}>
          You paid · Driver {item.counterparty_name}
        </Text>
        <Text style={styles.context}>
          {tripKindLabel(item.poolyn_context)} · Total {formatAudFromCents(total)}
        </Text>
        <View style={styles.breakdown}>
          <Text style={styles.breakLine}>Trip share {formatAudFromCents(share)}</Text>
          {fee > 0 ? (
            <Text style={styles.breakLine}>Fees {formatAudFromCents(fee)}</Text>
          ) : (
            <Text style={styles.breakMuted}>No separate fee (org-covered or none)</Text>
          )}
        </View>
      </View>
    );
  }

  function renderDriver({ item }: { item: DriverTransaction }) {
    const total = item.cash_to_charge_cents ?? 0;
    const share = item.expected_contribution_cents ?? 0;
    const fee = item.network_fee_cents ?? 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.date}>{formatWhen(item.trip_depart_at)}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{paymentStatusLabel(item.payment_status)}</Text>
          </View>
        </View>
        <Text style={styles.whoLine}>Received from {item.counterparty_name}</Text>
        <Text style={styles.context}>
          {tripKindLabel(item.poolyn_context)} · Rider charged {formatAudFromCents(total)}
        </Text>
        <View style={styles.breakdown}>
          <Text style={styles.breakLine}>Trip share (to you) {formatAudFromCents(share)}</Text>
          {fee > 0 ? (
            <Text style={styles.breakLine}>Platform fee on leg {formatAudFromCents(fee)}</Text>
          ) : (
            <Text style={styles.breakMuted}>No platform fee on this leg</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.intro}>
        <Text style={styles.introText}>
          Dollar amounts for trips (card or covered). Use Paid as rider to see what you paid and to whom. Use
          Received as driver to see each passenger payment on your trips.
        </Text>
      </View>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === "rider" && styles.modeBtnOn]}
          onPress={() => setMode("rider")}
          activeOpacity={0.85}
        >
          <Text style={[styles.modeBtnText, mode === "rider" && styles.modeBtnTextOn]}>Paid as rider</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === "driver" && styles.modeBtnOn]}
          onPress={() => setMode("driver")}
          activeOpacity={0.85}
        >
          <Text style={[styles.modeBtnText, mode === "driver" && styles.modeBtnTextOn]}>
            Received as driver
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterBlock}>
        <Text style={styles.filterLabel}>Status</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {STATUS_FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, statusFilter === f.key && styles.chipOn]}
              onPress={() => setStatusFilter(f.key)}
            >
              <Text style={[styles.chipText, statusFilter === f.key && styles.chipTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.filterBlock}>
        <Text style={styles.filterLabel}>Sort</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {SORT_OPTIONS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={[styles.chip, sort === s.key && styles.chipOn]}
              onPress={() => setSort(s.key)}
            >
              <Text style={[styles.chipText, sort === s.key && styles.chipTextOn]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          contentContainerStyle={displayed.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={40} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptySub}>
                {mode === "rider"
                  ? "When you pay for a trip as a passenger, it will list with the driver’s name and date."
                  : "When passengers pay on trips you drive, each payment appears here with their name."}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === "rider") return renderRider({ item });
            return renderDriver({ item });
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  intro: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  introText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  modeRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  modeBtnOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  modeBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  modeBtnTextOn: { color: Colors.primaryDark },
  filterBlock: { marginBottom: Spacing.sm, paddingHorizontal: Spacing.xl },
  filterLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipRow: { flexDirection: "row", gap: Spacing.sm, paddingBottom: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.text },
  chipTextOn: { color: Colors.primaryDark, fontWeight: FontWeight.semibold },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  listContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing["3xl"] },
  emptyContainer: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl, gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: Spacing.xs },
  date: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text, flex: 1 },
  whoLine: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text, marginBottom: 4 },
  statusPill: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  context: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.sm },
  breakdown: { gap: 4 },
  breakLine: { fontSize: FontSize.sm, color: Colors.text },
  breakMuted: { fontSize: FontSize.xs, color: Colors.textTertiary },
});
