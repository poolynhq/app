import { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchCrewPoolynDriverLedgerRows,
  fetchCrewPoolynRiderLedgerRows,
  fetchDriverTransactions,
  fetchRiderTransactions,
  explorerFeePercentLabel,
  filterByPaymentStatus,
  formatMoneyFromCents,
  groupDriverTransactionsForDisplay,
  paymentStatusLabel,
  sortDriverHistoryEntries,
  sortTransactions,
  type DriverHistoryEntry,
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
import { useAuth } from "@/contexts/AuthContext";

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
    return new Date(iso).toLocaleString(undefined, {
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
  if (ctx === "crew") return "Crew Poolyn (balance)";
  if (ctx === "adhoc") return "Listed trip";
  return "Commute";
}

function feeRateKey(item: RiderTransaction | DriverTransaction): "crew_settlement" | "mingle" {
  if (item.tx_source === "crew_pool" || item.poolyn_context === "crew") {
    return "crew_settlement";
  }
  return "mingle";
}

export default function PaymentHistoryScreen() {
  const { profile } = useAuth();
  const [mode, setMode] = useState<Mode>("rider");
  const [sort, setSort] = useState<TransactionSortKey>("date_desc");
  const [statusFilter, setStatusFilter] = useState<TransactionStatusFilter>("all");
  /** `all` or counterparty user id */
  const [counterpartyFilter, setCounterpartyFilter] = useState<string>("all");
  const [riderRows, setRiderRows] = useState<RiderTransaction[]>([]);
  const [driverRows, setDriverRows] = useState<DriverTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [crewRiderBreakdownOpen, setCrewRiderBreakdownOpen] = useState<Record<string, boolean>>(
    {}
  );
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const driverGrouped = useMemo(
    () => groupDriverTransactionsForDisplay(driverRows),
    [driverRows]
  );

  const load = useCallback(async () => {
    const [r, d, cr, cd] = await Promise.all([
      fetchRiderTransactions(),
      fetchDriverTransactions(),
      fetchCrewPoolynRiderLedgerRows(),
      fetchCrewPoolynDriverLedgerRows(),
    ]);
    setRiderRows([...r, ...cr]);
    setDriverRows([...d, ...cd]);
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

  useEffect(() => {
    setCounterpartyFilter("all");
  }, [mode]);

  const personFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of riderRows) {
      const id = r.counterparty_user_id;
      if (id) map.set(id, r.counterparty_name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [riderRows]);

  type HistoryRow = RiderTransaction | DriverHistoryEntry;

  const displayed = useMemo((): HistoryRow[] => {
    if (mode === "rider") {
      const raw = riderRows;
      const byStatus = filterByPaymentStatus(raw, statusFilter);
      const byPerson =
        counterpartyFilter === "all"
          ? byStatus
          : byStatus.filter((r) => r.counterparty_user_id === counterpartyFilter);
      return sortTransactions(byPerson, sort);
    }
    const byStatus = driverGrouped.filter((e) => {
      if (e.entryKind === "single")
        return filterByPaymentStatus([e.tx], statusFilter).length > 0;
      return filterByPaymentStatus(e.riders, statusFilter).length > 0;
    });
    return sortDriverHistoryEntries(byStatus, sort);
  }, [mode, riderRows, driverGrouped, sort, statusFilter, counterpartyFilter]);

  function renderRider({ item }: { item: RiderTransaction }) {
    const total = item.cash_to_charge_cents ?? 0;
    const share = item.expected_contribution_cents ?? 0;
    const fee = item.network_fee_cents ?? 0;
    const pk = item.pickup_stop_fee_cents;
    const pv = item.pool_variable_cents;
    const hasSplit = pk != null && pv != null;
    const rateKey = feeRateKey(item);
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
        {item.crew_name ? (
          <Text style={styles.crewSub}>{item.crew_name}</Text>
        ) : null}
        <Text style={styles.context}>
          {tripKindLabel(item.poolyn_context)} · Total charged {formatMoneyFromCents(total, profile)}
        </Text>
        <View style={styles.breakdown}>
          <Text style={styles.breakMuted}>Trip share (before network fee)</Text>
          {hasSplit ? (
            <>
              <Text style={styles.breakLine}>Pickup / stop fee {formatMoneyFromCents(pk, profile)}</Text>
              <Text style={styles.breakLine}>Pool (shared corridor) {formatMoneyFromCents(pv, profile)}</Text>
            </>
          ) : (
            <Text style={styles.breakLine}>Trip share {formatMoneyFromCents(share, profile)}</Text>
          )}
          <Text style={styles.breakTotal}>Subtotal trip share {formatMoneyFromCents(share, profile)}</Text>
          {fee > 0 ? (
            <Text style={styles.breakLine}>
              Explorer / network fee ({explorerFeePercentLabel(rateKey)}) {formatMoneyFromCents(fee, profile)}
            </Text>
          ) : null}
          <Text style={styles.breakTotal}>Total {formatMoneyFromCents(total, profile)}</Text>
          {item.crew_no_day_confirmation ? (
            <Text style={styles.disputeNote}>
              Flag: no pooling-day confirmation before the run (charged per crew rules).
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  function renderDriverShareBody(item: DriverTransaction) {
    const total = item.cash_to_charge_cents ?? 0;
    const share = item.expected_contribution_cents ?? 0;
    const fee = item.network_fee_cents ?? 0;
    const pk = item.pickup_stop_fee_cents;
    const pv = item.pool_variable_cents;
    const det = item.detour_only_cents ?? 0;
    const hasSplit = pk != null && pv != null;
    const rateKey = feeRateKey(item);
    return (
      <View style={styles.breakdown}>
        <Text style={styles.breakMuted}>Trip share credited to you (before network fee)</Text>
        {hasSplit ? (
          <>
            <Text style={styles.breakLine}>Pickup / stop (shared) {formatMoneyFromCents(pk, profile)}</Text>
            <Text style={styles.breakLine}>Pool (shared corridor) {formatMoneyFromCents(pv, profile)}</Text>
            {det > 0 ? (
              <Text style={styles.breakLine}>Off-corridor pickup (yours) {formatMoneyFromCents(det, profile)}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.breakLine}>Trip share (to you) {formatMoneyFromCents(share, profile)}</Text>
        )}
        <Text style={styles.breakTotal}>Subtotal to you {formatMoneyFromCents(share, profile)}</Text>
        {fee > 0 ? (
          <Text style={styles.breakLine}>
            Explorer / network fee ({explorerFeePercentLabel(rateKey)}) {formatMoneyFromCents(fee, profile)} (not
            paid to you)
          </Text>
        ) : null}
        <Text style={styles.breakTotal}>Total from rider {formatMoneyFromCents(total, profile)}</Text>
      </View>
    );
  }

  function renderDriver({ item }: { item: DriverTransaction }) {
    const total = item.cash_to_charge_cents ?? 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.date}>{formatWhen(item.trip_depart_at)}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{paymentStatusLabel(item.payment_status)}</Text>
          </View>
        </View>
        <Text style={styles.whoLine}>Received from {item.counterparty_name}</Text>
        {item.crew_name ? (
          <Text style={styles.crewSub}>{item.crew_name}</Text>
        ) : null}
        <Text style={styles.context}>
          {tripKindLabel(item.poolyn_context)} · Rider paid {formatMoneyFromCents(total, profile)} (incl. fees)
        </Text>
        {renderDriverShareBody(item)}
      </View>
    );
  }

  function renderCrewTripGroup(
    group: Extract<DriverHistoryEntry, { entryKind: "crew_trip" }>
  ) {
    const totalCredited = group.riders.reduce(
      (s, r) => s + (r.expected_contribution_cents ?? 0),
      0
    );
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.date}>{formatWhen(group.trip_depart_at)}</Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>Paid</Text>
          </View>
        </View>
        <Text style={styles.whoLine}>Crew Poolyn</Text>
        {group.crew_name ? <Text style={styles.crewSub}>{group.crew_name}</Text> : null}
        <Text style={styles.context}>
          Total credited to you {formatMoneyFromCents(totalCredited, profile)} · {group.riders.length} rider
          {group.riders.length === 1 ? "" : "s"}
        </Text>
        <View style={styles.crewRiderList}>
          {group.riders.map((rider, ix) => {
            const share = rider.expected_contribution_cents ?? 0;
            const ek = `${group.groupKey}:${rider.id}`;
            const open = !!crewRiderBreakdownOpen[ek];
            return (
              <View
                key={rider.id}
                style={ix > 0 ? styles.crewRiderBlockSeparator : undefined}
              >
                <View style={styles.crewRiderRow}>
                  <View style={styles.crewRiderNameCol}>
                    <Text style={styles.crewRiderName} numberOfLines={2}>
                      {rider.counterparty_name}
                    </Text>
                    <Text style={styles.crewRiderAmount}>
                      Subtotal to you {formatMoneyFromCents(share, profile)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      setCrewRiderBreakdownOpen((p) => ({ ...p, [ek]: !p[ek] }))
                    }
                    style={styles.crewInfoBtn}
                    accessibilityLabel={open ? "Hide fee breakdown" : "Show fee breakdown"}
                  >
                    <Ionicons
                      name={open ? "information-circle" : "information-circle-outline"}
                      size={22}
                      color={Colors.primary}
                    />
                  </TouchableOpacity>
                </View>
                {open ? (
                  <View style={styles.crewRiderExpand}>{renderDriverShareBody(rider)}</View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.intro}>
        <Text style={styles.introText}>
          Symbols follow your device region (not your network). Listed trips bill the card; Crew Poolyn uses balance.
          Crew trips show one card per run; expand a rider for the fee lines.
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

      <View style={styles.filterSection}>
        <TouchableOpacity
          style={styles.filterSummary}
          onPress={() => setFiltersExpanded((v) => !v)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={filtersExpanded ? "Hide filters" : "Show filters"}
        >
          <View style={styles.filterSummaryTextCol}>
            <Text style={styles.filterSummaryTitle}>Filters</Text>
            <Text style={styles.filterSummarySub} numberOfLines={2}>
              {STATUS_FILTERS.find((f) => f.key === statusFilter)?.label ?? "All"} ·{" "}
              {SORT_OPTIONS.find((s) => s.key === sort)?.label ?? "Newest trip"}
            </Text>
          </View>
          <Ionicons
            name={filtersExpanded ? "chevron-up" : "chevron-down"}
            size={22}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>

        {filtersExpanded ? (
          <View style={styles.filterExpanded}>
            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Status</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {STATUS_FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.chip, statusFilter === f.key && styles.chipOn]}
                    onPress={() => setStatusFilter(f.key)}
                  >
                    <Text style={[styles.chipText, statusFilter === f.key && styles.chipTextOn]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Sort</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
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

            {mode === "rider" && personFilterOptions.length > 0 ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Driver</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  <TouchableOpacity
                    style={[styles.chip, counterpartyFilter === "all" && styles.chipOn]}
                    onPress={() => setCounterpartyFilter("all")}
                  >
                    <Text
                      style={[styles.chipText, counterpartyFilter === "all" && styles.chipTextOn]}
                    >
                      All
                    </Text>
                  </TouchableOpacity>
                  {personFilterOptions.map(([id, name]) => (
                    <TouchableOpacity
                      key={id}
                      style={[styles.chip, counterpartyFilter === id && styles.chipOn]}
                      onPress={() => setCounterpartyFilter(id)}
                    >
                      <Text style={[styles.chipText, counterpartyFilter === id && styles.chipTextOn]}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList<HistoryRow>
          data={displayed}
          keyExtractor={(item) => {
            if (mode === "rider") return `r-${(item as RiderTransaction).id}`;
            const d = item as DriverHistoryEntry;
            if (d.entryKind === "single") return `d-${d.tx.id}`;
            return `cg-${d.groupKey}`;
          }}
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
                  : "When passengers pay on trips you drive, each payment appears here. Crew trips group all riders in one card."}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (mode === "rider") return renderRider({ item: item as RiderTransaction });
            const d = item as DriverHistoryEntry;
            if (d.entryKind === "single") return renderDriver({ item: d.tx });
            return renderCrewTripGroup(d);
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
  filterSection: {
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  filterSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
  },
  filterSummaryTextCol: { flex: 1, minWidth: 0 },
  filterSummaryTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  filterSummarySub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  filterExpanded: { marginTop: Spacing.sm },
  crewSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
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
  filterBlock: { marginBottom: Spacing.sm },
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
  breakTotal: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: 2,
  },
  breakMuted: { fontSize: FontSize.xs, color: Colors.textTertiary },
  disputeNote: {
    fontSize: FontSize.xs,
    color: Colors.warning,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  crewRiderList: { marginTop: Spacing.sm },
  crewRiderBlockSeparator: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  crewRiderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  crewRiderNameCol: { flex: 1, minWidth: 0 },
  crewRiderName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  crewRiderAmount: { fontSize: FontSize.sm, color: Colors.text, marginTop: 4 },
  crewInfoBtn: { padding: 4, marginTop: -4 },
  crewRiderExpand: { marginTop: Spacing.sm, paddingLeft: Spacing.xs },
});
