import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { AuthBrandingHero } from "@/components/auth/AuthBrandingHero";

/** Unauthenticated entry for “Start a network” / “Join or explore” (URL: /start). */
export default function AccountTypeSelection() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <AuthBrandingHero
        kicker="Choose how you connect"
        subline="Start a managed workplace network, or join as an individual and explore your route."
      />

      <View style={styles.cards}>
        <Link href="/(auth)/business-sign-up" asChild>
          <TouchableOpacity style={styles.card} activeOpacity={0.7}>
            <View style={styles.cardIconContainer}>
              <Ionicons
                name="business-outline"
                size={32}
                color={Colors.primary}
              />
            </View>
            <Text style={styles.cardTitle}>Start a Network</Text>
            <Text style={styles.cardSubtitle}>
              For companies and universities. Create a managed network with
              analytics, controls, and priority matching.
            </Text>
            <View style={styles.cardArrow}>
              <Ionicons
                name="arrow-forward"
                size={20}
                color={Colors.primary}
              />
            </View>
          </TouchableOpacity>
        </Link>

        <Link href="/(auth)/sign-up" asChild>
          <TouchableOpacity style={styles.card} activeOpacity={0.7}>
            <View style={styles.cardIconContainer}>
              <Ionicons
                name="people-outline"
                size={32}
                color={Colors.primary}
              />
            </View>
            <Text style={styles.cardTitle}>Join or Explore</Text>
            <Text style={styles.cardSubtitle}>
              Find people near your commute and keep moving. Join your workplace
              network later if available.
            </Text>
            <View style={styles.cardArrow}>
              <Ionicons
                name="arrow-forward"
                size={20}
                color={Colors.primary}
              />
            </View>
          </TouchableOpacity>
        </Link>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account? </Text>
        <Link href="/(auth)/sign-in" asChild>
          <TouchableOpacity>
            <Text style={styles.footerLink}>Sign in</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
  },
  cards: {
    gap: Spacing.base,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.md,
  },
  cardIconContainer: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.base,
  },
  cardTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  cardSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  cardArrow: {
    position: "absolute",
    top: Spacing.xl,
    right: Spacing.xl,
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing["3xl"],
    paddingBottom: Spacing["3xl"],
  },
  footerText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
  },
  footerLink: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
});
