import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Link, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export default function SignupClosedScreen() {
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
        <Text style={styles.tagline}>Smarter commutes with your colleagues</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.iconRow}>
          <Ionicons name="hourglass-outline" size={36} color={Colors.primary} />
        </View>
        <Text style={styles.title}>New accounts are paused</Text>
        <Text style={styles.body}>
          We&apos;re rolling out in phases. Right now you can join the public waitlist on the
          website — we&apos;ll email you ahead of wider access (including mid Q2 2026 for our
          first release wave).
        </Text>
        <Text style={styles.body}>
          Already have an account? Sign in below.
        </Text>

        <Link href="/(auth)/sign-in" asChild>
          <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.88}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </Link>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.replace("/")}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryBtnText}>
            {Platform.OS === "web" ? "Back to home & waitlist" : "Back to home"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 48,
    paddingBottom: Spacing["3xl"],
  },
  header: { alignItems: "center", marginBottom: Spacing["2xl"] },
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
    textAlign: "center",
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.md,
  },
  iconRow: { alignItems: "center", marginBottom: Spacing.md },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  body: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  primaryBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  secondaryBtn: {
    marginTop: Spacing.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
});
