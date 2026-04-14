/**
 * FUTURE USE: Full Poolyn Credits activity screen (commute_credits_ledger list, balance header).
 * Replaced with this placeholder while Stripe card payments are primary. Restore from git history if needed.
 */
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

export default function PoolynCreditsPlaceholderScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.card}>
        <Ionicons name="sparkles-outline" size={36} color={Colors.textTertiary} />
        <Text style={styles.title}>Poolyn Credits</Text>
        <Text style={styles.body}>
          This balance and ledger are not shown in the app right now. Payments use card checkout instead.
        </Text>
        <Text style={styles.body}>
          For money you paid as a passenger, open Transaction history on your profile.
        </Text>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.push("/(tabs)/profile/payment-history")}
          activeOpacity={0.85}
        >
          <Ionicons name="receipt-outline" size={20} color={Colors.textOnPrimary} />
          <Text style={styles.btnText}>Transaction history</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  card: {
    margin: Spacing.xl,
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    gap: Spacing.md,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    textAlign: "center",
  },
  body: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
    textAlign: "center",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  btnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
});
