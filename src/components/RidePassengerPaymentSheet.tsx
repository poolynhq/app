import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useStripe } from "@stripe/stripe-react-native";
import { Colors } from "@/constants/theme";
import {
  createRidePaymentIntentForPassenger,
  fetchRidePassengerPricingQuote,
  finalizeRidePassengerConfirmation,
} from "@/lib/ridePassengerPayment";
import { STRIPE_PUBLISHABLE_KEY } from "@/lib/stripePublishableKey";

type Props = {
  ridePassengerId: string;
  onPaid?: () => void;
  onError?: (message: string) => void;
};

/**
 * iOS/Android: PaymentSheet flow. (Web uses RidePassengerPaymentSheet.web.tsx.)
 */
export function RidePassengerPaymentSheet(props: Props) {
  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <View style={styles.box}>
        <Text style={styles.hint}>Stripe publishable key is not configured for this build.</Text>
      </View>
    );
  }

  return <RidePassengerPaymentSheetInner {...props} />;
}

function RidePassengerPaymentSheetInner({ ridePassengerId, onPaid, onError }: Props) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [loading, setLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<string | null>(null);

  const loadQuote = useCallback(async () => {
    const q = await fetchRidePassengerPricingQuote(ridePassengerId);
    if (!q.ok) {
      setBreakdown(null);
      onError?.(q.error);
      return;
    }
    const lines = [
      `Trip share: ${formatMoney(q.gross_trip_amount_cents)}`,
      q.platform_fee_cents > 0
        ? `${labelForFee(q.platform_fee_label)}: ${formatMoney(q.platform_fee_cents)}`
        : "Platform fee: none",
      `Total: ${formatMoney(q.total_payable_cents)}`,
      `Estimated to driver: ${formatMoney(q.net_payout_estimate_cents)}`,
    ];
    setBreakdown(lines.join("\n"));
  }, [ridePassengerId, onError]);

  const pay = useCallback(async () => {
    setLoading(true);
    try {
      const quote = await fetchRidePassengerPricingQuote(ridePassengerId);
      if (!quote.ok) {
        onError?.(quote.error);
        return;
      }

      const pi = await createRidePaymentIntentForPassenger(ridePassengerId);
      if (!pi.ok) {
        onError?.(pi.error);
        return;
      }

      if (pi.zero_amount_marked_paid) {
        const fin = await finalizeRidePassengerConfirmation(ridePassengerId);
        if (!fin.ok) {
          onError?.(fin.error ?? "confirmation_failed");
          return;
        }
        onPaid?.();
        return;
      }

      if (!pi.client_secret) {
        onError?.("missing_client_secret");
        return;
      }

      const init = await initPaymentSheet({
        paymentIntentClientSecret: pi.client_secret,
        merchantDisplayName: "Poolyn",
        allowsDelayedPaymentMethods: false,
      });
      if (init.error) {
        onError?.(init.error.message);
        return;
      }

      const result = await presentPaymentSheet();
      if (result.error) {
        onError?.(result.error.message);
        return;
      }

      const fin = await finalizeRidePassengerConfirmation(ridePassengerId);
      if (!fin.ok) {
        onError?.(fin.error ?? "confirmation_failed");
        return;
      }
      onPaid?.();
    } finally {
      setLoading(false);
    }
  }, [ridePassengerId, initPaymentSheet, presentPaymentSheet, onPaid, onError]);

  return (
    <View style={styles.box}>
      <Pressable style={styles.secondaryBtn} onPress={loadQuote} disabled={loading}>
        <Text style={styles.secondaryTxt}>Load booking summary</Text>
      </Pressable>
      {breakdown ? <Text style={styles.breakdown}>{breakdown}</Text> : null}
      <Pressable style={styles.primaryBtn} onPress={pay} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryTxt}>Pay with card</Text>
        )}
      </Pressable>
    </View>
  );
}

function formatMoney(cents: number): string {
  const n = cents / 100;
  return n.toLocaleString(undefined, { style: "currency", currency: "AUD" });
}

function labelForFee(raw: string): string {
  if (raw === "coordination fee") return "Coordination fee";
  if (raw === "network fee") return "Network fee";
  return "Platform fee";
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  hint: { color: Colors.textSecondary, fontSize: 14 },
  breakdown: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    fontFamily: "System",
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryTxt: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryTxt: { color: Colors.primary, fontSize: 15, fontWeight: "600" },
});
