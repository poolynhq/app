import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import type { CompletedCrewTripHistoryRow } from "@/lib/crewMessaging";
import { formatPoolynCreditsBalance } from "@/lib/poolynCreditsUi";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

function formatCalendarDate(isoDate: string) {
  try {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function formatFinishedAt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CrewTripHistoryCard({ row }: { row: CompletedCrewTripHistoryRow }) {
  const { profile } = useAuth();
  const uid = profile?.id;
  const s = row.settlementSummary;
  const routeBits: string[] = [];
  if (s?.route_label) routeBits.push(s.route_label);
  if (s?.distance_km != null) routeBits.push(`${s.distance_km} km`);
  if (s?.duration_mins != null) routeBits.push(`~${s.duration_mins} min`);

  const driverId = s?.driver_user_id;
  const earned = s?.driver_credits_earned ?? 0;
  const adminTotal = s?.total_crew_admin_credits_from_explorers ?? 0;

  let youLine: string | null = null;
  if (uid && driverId && uid === driverId) {
    youLine = `You received ${formatPoolynCreditsBalance(earned)} as today’s driver.`;
  } else if (uid && s?.riders?.length) {
    const line = s.riders.find((r) => r.user_id === uid);
    if (line && typeof line.credits_total_debited === "number") {
      youLine = `You paid ${formatPoolynCreditsBalance(line.credits_total_debited)} (share ${formatPoolynCreditsBalance(
        line.credits_contribution ?? 0
      )}${
        (line.credits_crew_admin_fee ?? 0) > 0
          ? ` + crew admin ${formatPoolynCreditsBalance(line.credits_crew_admin_fee ?? 0)}`
          : ""
      }).`;
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Crew Poolyn · {row.crewName}</Text>
      <Text style={styles.meta}>
        {formatCalendarDate(row.tripDate)} · Finished {formatFinishedAt(row.tripFinishedAt)}
      </Text>
      {routeBits.length > 0 ? <Text style={styles.route}>{routeBits.join(" · ")}</Text> : null}

      {s?.riders && s.riders.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Rider credits</Text>
          {s.riders.map((r) => (
            <Text key={r.user_id} style={styles.line}>
              {(r.full_name || "Rider").trim()}: −{formatPoolynCreditsBalance(r.credits_total_debited ?? 0)} total
              {(r.credits_crew_admin_fee ?? 0) > 0
                ? ` (share ${formatPoolynCreditsBalance(r.credits_contribution ?? 0)} + admin ${formatPoolynCreditsBalance(
                    r.credits_crew_admin_fee ?? 0
                  )})`
                : ` (share ${formatPoolynCreditsBalance(r.credits_contribution ?? 0)})`}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>No rider credit movement for this day.</Text>
      )}

      {driverId ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Driver</Text>
          <Text style={styles.line}>
            {(s?.driver_full_name || "Driver").trim()}: +{formatPoolynCreditsBalance(earned)} Poolyn Credits
          </Text>
        </View>
      ) : null}

      {adminTotal > 0 ? (
        <Text style={styles.adminLine}>
          Crew explorer admin (credits from riders not on a workplace network):{" "}
          {formatPoolynCreditsBalance(adminTotal)} total
        </Text>
      ) : null}

      {youLine ? <Text style={styles.youLine}>{youLine}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  title: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  meta: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 17,
  },
  route: {
    fontSize: FontSize.sm,
    color: Colors.text,
    marginTop: Spacing.sm,
    fontWeight: FontWeight.medium,
  },
  block: { marginTop: Spacing.md },
  blockTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  line: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
    marginBottom: 4,
  },
  muted: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  adminLine: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  youLine: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
    marginTop: Spacing.md,
    lineHeight: 20,
  },
});
