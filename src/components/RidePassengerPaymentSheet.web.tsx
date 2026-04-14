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
      <Text style={styles.hint}>Open the Poolyn app on your phone to pay for this ride.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  hint: { color: Colors.textSecondary, fontSize: 14 },
});
