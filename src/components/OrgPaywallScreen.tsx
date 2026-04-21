import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from "react-native";
import type { OrganisationNetworkStatus } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const POOLYN_PLAN_SUPPORT_EMAIL =
  "mailto:hello@poolyn.com?subject=Poolyn%20organization%20plans";

/** Tiers shown in upgrade mode (Scout / free is not sold here; DB `free` maps below first tier). */
const UPGRADE_DISPLAY_ORDER = ["starter", "business", "enterprise"] as const;
export type OrgUpgradePlanId = (typeof UPGRADE_DISPLAY_ORDER)[number];

const ORG_PLAN_TIERS: {
  id: OrgUpgradePlanId;
  name: string;
  priceLine: string;
  detail: string;
}[] = [
  {
    id: "starter",
    name: "MergeLane",
    priceLine: "$49 / month",
    detail: "20 active members included; $2 per extra member.",
  },
  {
    id: "business",
    name: "Convoy Run",
    priceLine: "$99 / month",
    detail: "100 active members, admin corridor tools; $1.50 per extra member.",
  },
  {
    id: "enterprise",
    name: "Orbit Enterprise",
    priceLine: "Custom pricing",
    detail: "Custom member counts, SLA, and integrations.",
  },
];

/** Rank for upgrade UI only; `free` sits below the first listed tier. */
function upgradeTierRank(plan: string | undefined): number {
  const p = (plan ?? "free").toLowerCase();
  if (p === "free") return -1;
  const i = UPGRADE_DISPLAY_ORDER.indexOf(p as OrgUpgradePlanId);
  return i >= 0 ? i : UPGRADE_DISPLAY_ORDER.length;
}

export type OrgPaywallScreenProps = {
  /**
   * activation: network not yet active (legacy paywall).
   * upgrade: self-serve higher tiers; downgrades are not self-serve (contact support).
   */
  mode?: "activation" | "upgrade";
  /** Current `organisations.plan` when `mode` is `upgrade`. */
  currentOrgPlan?: string;
  /** When set, copy reflects grace (payment issue) vs not-yet-activated (activation mode only). */
  organisationStatus?: OrganisationNetworkStatus | null;
  onActivateNetwork: () => void;
  /** Shown in upgrade mode when the member picks a higher tier (Stripe wiring lands here). */
  onSelectUpgradePlan?: (planId: OrgUpgradePlanId) => void;
  onContinueAsIndividual: () => void;
};

/**
 * Organization activation paywall, or plan comparison for upgrades (same route, `?intent=upgrade`).
 */
export function OrgPaywallScreen({
  mode = "activation",
  currentOrgPlan = "free",
  organisationStatus,
  onActivateNetwork,
  onSelectUpgradePlan,
  onContinueAsIndividual,
}: OrgPaywallScreenProps) {
  const isGrace = organisationStatus === "grace";
  const cur = upgradeTierRank(currentOrgPlan);

  if (mode === "upgrade") {
    const onPick = onSelectUpgradePlan ?? (() => {});

    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.upgradeScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {isGrace ? (
          <View style={styles.graceBanner}>
            <Text style={styles.graceTitle}>Billing in grace period</Text>
            <Text style={styles.graceBody}>
              Update payment to avoid pausing invites. You can still review upgrade options below.
            </Text>
            <TouchableOpacity style={styles.graceBtn} onPress={onActivateNetwork} activeOpacity={0.85}>
              <Text style={styles.graceBtnText}>Update payment</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.title}>Organization plans</Text>
        <Text style={styles.body}>
          Higher tiers include more active members and tools. Checkout runs here once Stripe billing is connected.
        </Text>

        {ORG_PLAN_TIERS.map((tier) => {
          const normalized = (currentOrgPlan ?? "free").toLowerCase();
          const isCurrent = tier.id === normalized;
          const isHigher = upgradeTierRank(tier.id) > cur;

          return (
            <View key={tier.id} style={styles.tierCard}>
              <View style={styles.tierHeader}>
                <Text style={styles.tierName}>{tier.name}</Text>
                {isCurrent ? (
                  <View style={styles.currentPill}>
                    <Text style={styles.currentPillText}>Current</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.tierPrice}>{tier.priceLine}</Text>
              <Text style={styles.tierDetail}>{tier.detail}</Text>
              {isHigher ? (
                <TouchableOpacity
                  style={styles.upgradeTierBtn}
                  onPress={() => onPick(tier.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.upgradeTierBtnText}>
                    {tier.id === "enterprise" ? "Contact for Enterprise" : "Upgrade to this plan"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        <Text style={styles.supportFooter}>Contact support for plan-related queries.</Text>
        <TouchableOpacity onPress={() => void Linking.openURL(POOLYN_PLAN_SUPPORT_EMAIL)} activeOpacity={0.7}>
          <Text style={styles.supportLink}>hello@poolyn.com</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

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
  scroll: { flex: 1, backgroundColor: Colors.background },
  upgradeScrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing["5xl"],
  },
  graceBanner: {
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  graceTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  graceBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  graceBtn: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  graceBtnText: {
    color: Colors.surface,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.sm,
  },
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
  tierCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  tierHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  tierName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    flex: 1,
  },
  currentPill: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  currentPillText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  tierPrice: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  tierDetail: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  upgradeTierBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  upgradeTierBtnText: {
    color: Colors.surface,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  supportFooter: {
    marginTop: Spacing.lg,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  supportLink: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
    textAlign: "center",
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
