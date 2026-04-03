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

export default function AccountTypeSelection() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Ionicons name="car-sport" size={40} color={Colors.textOnPrimary} />
        </View>
        <Text style={styles.appName}>Poolyn</Text>
        <Text style={styles.tagline}>Choose how you want to connect</Text>
      </View>

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
  },
  header: {
    alignItems: "center",
    paddingTop: 80,
    paddingBottom: Spacing["3xl"],
  },
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.base,
    ...Shadow.lg,
  },
  appName: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
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
