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

function humanizeTripPaymentError(message: string, hint?: string): string {
  const m = message.toLowerCase();
  if (m.includes("driver_payouts_not_ready") || m.includes("payouts_not_ready")) {
    return (
      hint ??
      "The driver has not finished bank setup for hosted trips yet. They can connect their bank under Profile."
    );
  }
  if (hint) return `${message} ${hint}`;
  return message;
}

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
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof fetchRidePassengerPricingQuote>> | null>(null);

  const loadQuote = useCallback(async () => {
    const q = await fetchRidePassengerPricingQuote(ridePassengerId);
    if (!q.ok) {
      setQuote(null);
      onError?.(humanizeTripPaymentError(q.error));
      return;
    }
    setQuote(q);
  }, [ridePassengerId, onError]);

  const pay = useCallback(async () => {
    setLoading(true);
    try {
      const q = await fetchRidePassengerPricingQuote(ridePassengerId);
      if (!q.ok) {
        onError?.(humanizeTripPaymentError(q.error));
        return;
      }
      setQuote(q);

      const pi = await createRidePaymentIntentForPassenger(ridePassengerId);
      if (!pi.ok) {
        onError?.(humanizeTripPaymentError(pi.error, pi.hint));
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
      <Text style={styles.title}>{"You're contributing to shared travel costs"}</Text>
      <Text style={styles.subtitle}>Includes distance, detours, and any additional trip costs</Text>

      <Pressable style={styles.secondaryBtn} onPress={loadQuote} disabled={loading}>
        <Text style={styles.secondaryTxt}>Show cost breakdown</Text>
      </Pressable>

      {quote && quote.ok ? (
        <View style={styles.breakdownBox}>
          <BreakdownLine label="Your distance share" cents={quote.distance_share_cents} />
          {quote.detour_share_cents > 0 ? (
            <BreakdownLine label="Detour cost" cents={quote.detour_share_cents} />
          ) : null}
          {quote.pickup_share_cents > 0 ? (
            <BreakdownLine label="Pickup cost" cents={quote.pickup_share_cents} />
          ) : null}
          {quote.tolls_share_cents > 0 ? <BreakdownLine label="Tolls" cents={quote.tolls_share_cents} /> : null}
          {quote.parking_share_cents > 0 ? (
            <BreakdownLine label="Parking" cents={quote.parking_share_cents} />
          ) : null}
          {quote.platform_fee_cents > 0 ? (
            <BreakdownLine label={labelForFee(quote.platform_fee_label)} cents={quote.platform_fee_cents} />
          ) : null}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Your share of this trip</Text>
            <Text style={styles.totalValue}>{formatMoney(quote.total_payable_cents)}</Text>
          </View>
          <Text style={styles.finePrint}>Some costs are provided by the driver</Text>
          <Text style={styles.disclaimer}>Costs are based on route and trip details</Text>
        </View>
      ) : null}

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

function BreakdownLine({ label, cents }: { label: string; cents: number }) {
  return (
    <View style={styles.lineRow}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{formatMoney(cents)}</Text>
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
  return "Service fee";
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  hint: { color: Colors.textSecondary, fontSize: 14 },
  title: { fontSize: 17, fontWeight: "600", color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  breakdownBox: {
    gap: 8,
    paddingVertical: 4,
  },
  lineRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  lineLabel: { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  lineValue: { fontSize: 14, fontWeight: "500", color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  totalLabel: { fontSize: 15, fontWeight: "600", color: Colors.text, flex: 1 },
  totalValue: { fontSize: 16, fontWeight: "700", color: Colors.primaryDark },
  finePrint: { fontSize: 12, color: Colors.textTertiary, marginTop: 4 },
  disclaimer: { fontSize: 12, color: Colors.textTertiary, fontStyle: "italic" },
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
