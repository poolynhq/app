import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminOrgBilling } from "@/hooks/useAdminOrgBilling";
import type { OrganisationNetworkStatus } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

/** Phase 9: grace copy + optional countdown for org admins (RPC). */
export function GraceNetworkBanner({
  orgStatus,
}: {
  orgStatus: OrganisationNetworkStatus | null | undefined;
}) {
  const { profile } = useAuth();
  const isGrace = orgStatus === "grace";
  const fetchBilling = isGrace && profile?.org_role === "admin";
  const { billing } = useAdminOrgBilling(!!fetchBilling);

  if (!isGrace) return null;

  const days = billing?.days_remaining_in_grace;

  return (
    <View style={styles.banner}>
      <Text style={styles.line}>Your organization is in a grace period.</Text>
      <Text style={styles.line}>Update payment to keep your network active.</Text>
      {typeof days === "number" ? (
        <Text style={styles.meta}>
          {days} day{days === 1 ? "" : "s"} remaining in grace period.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#F59E0B",
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  line: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  meta: {
    marginTop: Spacing.sm,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: "#B45309",
  },
});
