import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { formatPoolynCreditsBalance } from "@/lib/poolynCreditsUi";

type Props = {
  balance: number;
};

/**
 * Profile hero for internal Poolyn Credits (earn driving, spend on rider share when riding).
 */
export function PoolynCreditsCard({ balance }: Props) {
  const router = useRouter();
  const formatted = formatPoolynCreditsBalance(balance);

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={() => router.push("/(tabs)/profile/poolyn-credits")}
      accessibilityRole="button"
      accessibilityLabel="Poolyn Credits balance and activity"
      style={styles.outer}
    >
      <LinearGradient
        colors={["#053222", "#0B8457", "#14A372"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.shine} pointerEvents="none" />
        <View style={styles.topRow}>
          <View style={styles.chip}>
            <Ionicons name="sparkles" size={15} color="#FDE68A" />
            <Text style={styles.chipText}>POOLYN CREDITS</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.9)" />
        </View>
        <Text style={styles.balance}>{formatted}</Text>
        <Text style={styles.caption}>Your balance</Text>
        <View style={styles.footer}>
          <View style={styles.footerItem}>
            <Ionicons name="car-sport" size={16} color="rgba(253,230,138,0.95)" />
            <Text style={styles.footerText}>Earn when you drive</Text>
          </View>
          <View style={styles.dot} />
          <View style={styles.footerItem}>
            <Ionicons name="swap-horizontal" size={16} color="rgba(253,230,138,0.95)" />
            <Text style={styles.footerText}>Use when you ride</Text>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignSelf: "stretch",
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.xl,
    ...Shadow.lg,
  },
  card: {
    borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  shine: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: "rgba(253,230,138,0.35)",
  },
  chipText: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.2,
    color: "#FEF9C3",
  },
  balance: {
    fontSize: FontSize["4xl"] + 6,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
    letterSpacing: -1,
  },
  caption: {
    marginTop: 2,
    fontSize: FontSize.sm,
    color: "rgba(255,255,255,0.75)",
    fontWeight: FontWeight.medium,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.lg,
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  footerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: "rgba(255,255,255,0.88)",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
});
