import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

/** Default: last selectable day is today + 30 days (inclusive). */
const DEFAULT_MAX_DAYS_AHEAD = 30;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Props = {
  /** Controlled: calendar day at local midnight */
  value: Date;
  onChange: (next: Date) => void;
  /** Last selectable day is today + this many days (inclusive). Defaults to 30. */
  maxDaysAhead?: number;
};

export function AdhocMonthCalendar({ value, onChange, maxDaysAhead = DEFAULT_MAX_DAYS_AHEAD }: Props) {
  const minDate = startOfDay(new Date());
  const maxDate = startOfDay(addDays(minDate, maxDaysAhead));

  const [view, setView] = useState(() => {
    const v = startOfDay(value);
    return new Date(v.getFullYear(), v.getMonth(), 1);
  });

  useEffect(() => {
    const v = startOfDay(value);
    setView((prev) => {
      if (prev.getFullYear() === v.getFullYear() && prev.getMonth() === v.getMonth()) return prev;
      return new Date(v.getFullYear(), v.getMonth(), 1);
    });
  }, [value]);

  const year = view.getFullYear();
  const month = view.getMonth();

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const viewMonthStart = new Date(year, month, 1);
  const minMonthStart = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const maxMonthStart = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  const canPrev = viewMonthStart > minMonthStart;
  const canNext = viewMonthStart < maxMonthStart;

  const cells: ({ kind: "blank" } | { kind: "day"; day: number })[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ kind: "blank" });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ kind: "day", day: d });

  const monthLabel = view.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
          disabled={!canPrev}
          onPress={() => setView(new Date(year, month - 1, 1))}
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={22} color={canPrev ? Colors.primary : Colors.border} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{monthLabel}</Text>
        <TouchableOpacity
          style={[styles.navBtn, !canNext && styles.navBtnDisabled]}
          disabled={!canNext}
          onPress={() => setView(new Date(year, month + 1, 1))}
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={22} color={canNext ? Colors.primary : Colors.border} />
        </TouchableOpacity>
      </View>

      <View style={styles.dowRow}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <Text key={d} style={styles.dow}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((c, idx) => {
          if (c.kind === "blank") {
            return <View key={`b-${idx}`} style={styles.cell} />;
          }
          const date = new Date(year, month, c.day);
          const inRange = date >= minDate && date <= maxDate;
          const selected = sameDay(date, value);
          return (
            <TouchableOpacity
              key={`d-${c.day}`}
              style={[styles.cell, styles.dayCell, selected && styles.daySelected, !inRange && styles.dayDisabled]}
              disabled={!inRange}
              onPress={() => onChange(startOfDay(date))}
              accessibilityState={{ selected }}
              accessibilityLabel={date.toDateString()}
            >
              <Text
                style={[styles.dayText, selected && styles.dayTextSelected, !inRange && styles.dayTextDisabled]}
              >
                {c.day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.rangeHint}>
        You can pick any day from today through {maxDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  navBtn: { padding: Spacing.xs },
  navBtnDisabled: { opacity: 0.4 },
  monthTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  dowRow: { flexDirection: "row", marginBottom: Spacing.xs },
  dow: {
    flex: 1,
    textAlign: "center",
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: "14.28%",
    minHeight: 36,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCell: {
    borderRadius: BorderRadius.sm,
  },
  daySelected: { backgroundColor: Colors.primary },
  dayDisabled: { opacity: 0.35 },
  dayText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: FontWeight.medium },
  dayTextSelected: { color: Colors.textOnPrimary },
  dayTextDisabled: { color: Colors.textTertiary },
  rangeHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 16,
  },
});
