import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminOrgBilling } from "@/hooks/useAdminOrgBilling";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

/** Admin-only: grace countdown or inactive reactivation hint. */
export function AdminOrgStatusBanner() {
  const { profile } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.org_role === "admin" && !!profile?.org_id;
  const { billing, billingLoading } = useAdminOrgBilling(isAdmin);

  if (!isAdmin || billingLoading || !billing?.organisation_status) {
    return null;
  }

  if (billing.organisation_status === "grace") {
    const days =
      billing.days_remaining_in_grace != null ? billing.days_remaining_in_grace : "—";
    return (
      <View style={[styles.banner, styles.grace]}>
        <Text style={styles.bannerTitle}>Grace period</Text>
        <Text style={styles.bannerBody}>
          Your organization is in a grace period. Update payment to keep your network active.
        </Text>
        <Text style={styles.countdown}>
          {typeof days === "number"
            ? `${days} day${days === 1 ? "" : "s"} remaining before the network may be paused`
            : "Update billing soon"}
        </Text>
      </View>
    );
  }

  if (billing.organisation_status === "inactive" || billing.organisation_status === "dissolved") {
    return (
      <View style={[styles.banner, styles.inactive]}>
        <Text style={styles.bannerTitle}>Network not active</Text>
        <Text style={styles.bannerBody}>
          Your organization network is not active. Activate to unlock invites and private network
          features.
        </Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.push("/(admin)/org-paywall")}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Activate Network</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  grace: {
    backgroundColor: "#FFFBEB",
    borderColor: "#F59E0B",
  },
  inactive: {
    backgroundColor: "#F8FAFC",
    borderColor: Colors.borderLight,
  },
  bannerTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  bannerBody: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  countdown: {
    marginTop: Spacing.sm,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: "#B45309",
  },
  cta: {
    marginTop: Spacing.sm,
    alignSelf: "flex-start",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
  },
  ctaText: {
    color: Colors.surface,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
});
