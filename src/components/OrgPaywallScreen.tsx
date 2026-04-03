import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { OrganisationNetworkStatus } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export type OrgPaywallScreenProps = {
  /** When set, copy reflects grace (payment issue) vs not-yet-activated. */
  organisationStatus?: OrganisationNetworkStatus | null;
  onActivateNetwork: () => void;
  onContinueAsIndividual: () => void;
};

/**
 * Phase 9A: inactive / dissolved activation paywall. Grace variant if user lands here with `grace` (e.g. deep link).
 */
export function OrgPaywallScreen({
  organisationStatus,
  onActivateNetwork,
  onContinueAsIndividual,
}: OrgPaywallScreenProps) {
  const isGrace = organisationStatus === "grace";

  const title = isGrace
    ? "Update your organization billing"
    : "Activate your organization network";

  const bodyPrimary = isGrace
    ? "Your organization is in a grace period. Update payment to keep your network active."
    : "To unlock your private Poolyn network, activate your organization.";

  const bodySecondary = isGrace
    ? "Invites and some network actions stay paused until billing is current. Your team can still use Poolyn individually."
    : "Your team can continue using Poolyn individually, but network features require activation.";

  const ctaLabel = isGrace ? "Update payment" : "Activate Network";

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{bodyPrimary}</Text>
      <Text style={styles.body}>{bodySecondary}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onActivateNetwork} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>{ctaLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={onContinueAsIndividual}
        activeOpacity={0.85}
      >
        <Text style={styles.secondaryText}>Continue as individual</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: Spacing.xl,
    justifyContent: "center",
    backgroundColor: Colors.background,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  body: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    marginTop: Spacing.lg,
    ...Shadow.sm,
  },
  primaryBtnText: {
    color: Colors.surface,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  secondaryBtn: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  secondaryText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: FontWeight.medium,
  },
});
