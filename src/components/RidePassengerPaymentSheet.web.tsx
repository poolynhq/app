import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/theme";

type Props = {
  ridePassengerId: string;
  onPaid?: () => void;
  onError?: (message: string) => void;
};

/**
 * Web: @stripe/stripe-react-native cannot load in the browser. Use the mobile app for card payments.
 */
export function RidePassengerPaymentSheet(_props: Props) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{"You're contributing to shared travel costs"}</Text>
      <Text style={styles.sub}>
        Card payments for this trip run in the Poolyn mobile app. Open the app on your phone to continue.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  title: { fontSize: 16, fontWeight: "600", color: Colors.text },
  sub: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
});
