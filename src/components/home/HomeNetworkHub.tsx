import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

/**
 * Network how-it-fits copy and trust note on Home (overlap counts removed; RPC often read as zero).
 */
export function HomeNetworkHub() {
  const { profile } = useAuth();

  return (
    <View style={styles.wrap}>
      <Text style={styles.hubEyebrow}>NETWORK SNAPSHOT</Text>
      <View style={styles.whyCard}>
        <Text style={styles.whyTitle}>How this fits together</Text>
        <Text style={styles.whyBody}>
          <Text style={styles.whyBold}>Offer a ride.</Text> Post your trip in{" "}
          <Text style={styles.whyBold}>My Rides</Text> with time and seats. You appear on the corridor map for
          people in your scope.
        </Text>
        <Text style={styles.whyBody}>
          <Text style={styles.whyBold}>Find a ride.</Text> Browse posted trips and reserve a seat in{" "}
          <Text style={styles.whyBold}>My Rides</Text> when a driver has listed spare seats.
        </Text>
        <Text style={styles.whyBody}>
          <Text style={styles.whyBold}>Post a pickup.</Text> Regular commute,{" "}
          <Text style={styles.whyBold}>Mingle Poolyn</Text>, riding mode: use the button at the bottom of that card.
          Nearby drivers on your corridor get a heads-up.
        </Text>
      </View>

      {profile?.visibility_mode === "nearby" && (
        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={Colors.primary} />
          <Text style={styles.trustText}>
            Any commuter includes people along your corridor, not only your org. Trust scores still apply when you
            interact in My Rides.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  hubEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  whyCard: {
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  whyTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  whyBody: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  whyBold: { fontWeight: FontWeight.semibold, color: Colors.text },
  trustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  trustText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    lineHeight: 18,
  },
});
