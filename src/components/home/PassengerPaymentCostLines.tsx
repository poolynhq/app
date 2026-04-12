import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { showAlert } from "@/lib/platformAlert";
import {
  computeClientNetworkFeePreview,
  PASSENGER_PAYMENT_EXPLAINER_TITLE,
  buildPassengerPaymentExplainerMessage,
} from "@/lib/passengerPaymentPreview";
import {
  poolynExplorerCashFeeFraction,
  type PoolynTripFeeContext,
} from "@/lib/poolynPricingConfig";
import { Colors, FontSize } from "@/constants/theme";

export function openPassengerPaymentExplainer(opts: {
  hasWorkplaceNetworkOnProfile: boolean;
  context: "mingle" | "crew" | "profile_estimate";
}): void {
  showAlert(
    PASSENGER_PAYMENT_EXPLAINER_TITLE,
    buildPassengerPaymentExplainerMessage({
      hasWorkplaceNetworkOnProfile: opts.hasWorkplaceNetworkOnProfile,
      context: opts.context,
    })
  );
}

type Props = {
  contributionCents: number;
  /** Paying passenger’s workplace org on profile; server confirms active network at booking. */
  passengerHasWorkplaceOrgOnProfile: boolean;
  context: "mingle" | "crew" | "profile_estimate";
  /** Full first line (e.g. crew rider share). Default: trip share + stop fee. */
  primaryLine?: string;
  /** Smaller line under the main amount (e.g. pool split hint). */
  poolHint?: string | null;
  /** Typography: meta (small secondary) vs cost (emphasized). */
  textStyle?: "meta" | "cost";
  containerStyle?: StyleProp<ViewStyle>;
};

export function PassengerPaymentCostLines({
  contributionCents,
  passengerHasWorkplaceOrgOnProfile,
  context,
  primaryLine,
  poolHint,
  textStyle = "cost",
  containerStyle,
}: Props) {
  const poolynContext: PoolynTripFeeContext = context === "crew" ? "crew" : "mingle";
  const preview = computeClientNetworkFeePreview({
    totalContributionCents: contributionCents,
    hasWorkplaceOrgOnProfile: passengerHasWorkplaceOrgOnProfile,
    poolynContext,
  });
  const feePct = Math.round(poolynExplorerCashFeeFraction(poolynContext) * 100);
  const cashFeeLabel =
    context === "crew" ? "Crew admin fee" : "Mingle service fee";
  const contribDollars = (Math.max(0, contributionCents) / 100).toFixed(2);
  const line =
    primaryLine ?? `Trip share $${contribDollars} (incl. $1 stop fee)`;
  const baseStyle = textStyle === "meta" ? styles.meta : styles.cost;

  return (
    <View style={[styles.wrap, containerStyle]}>
      <View style={styles.firstRow}>
        <Text style={baseStyle}>{line}</Text>
        <TouchableOpacity
          onPress={() =>
            openPassengerPaymentExplainer({
              hasWorkplaceNetworkOnProfile: passengerHasWorkplaceOrgOnProfile,
              context,
            })
          }
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="What this payment covers"
        >
          <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      {poolHint ? <Text style={styles.poolHint}>{poolHint}</Text> : null}
      {!passengerHasWorkplaceOrgOnProfile && preview.networkFeeCents > 0 ? (
        <Text style={styles.feeLine}>
          {`+ ${cashFeeLabel} (${feePct}% on cash) $${(preview.networkFeeCents / 100).toFixed(2)} · Total cash ~$${(preview.finalChargeCents / 100).toFixed(2)}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 2 },
  firstRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    flexWrap: "wrap",
  },
  meta: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  cost: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: "600",
    color: Colors.text,
    lineHeight: 20,
  },
  poolHint: {
    marginTop: 2,
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    lineHeight: 18,
  },
  feeLine: {
    marginTop: 4,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
