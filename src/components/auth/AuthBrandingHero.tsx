import { View, Text, Image, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const poolynLoyo = require("../../../assets/poolyn_loyo.png");
const poolynCircle = require("../../../assets/poolyn-Icon-white-circle.png");

type Props = {
  /** Short line under the wordmark, e.g. "Welcome back" */
  kicker: string;
  /** Supporting line */
  subline?: string;
};

/**
 * Shared auth header: horizontal wordmark + circular mark on a soft mint wash.
 */
export function AuthBrandingHero({ kicker, subline }: Props) {
  return (
    <LinearGradient
      colors={["#ECFDF5", "#F8FAFC"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.markRow}>
        <View style={styles.circleShadow}>
          <Image source={poolynCircle} style={styles.circleImg} resizeMode="contain" />
        </View>
        <Image source={poolynLoyo} style={styles.loyo} resizeMode="contain" accessibilityLabel="Poolyn" />
      </View>
      <Text style={styles.kicker}>{kicker}</Text>
      {subline ? <Text style={styles.subline}>{subline}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.12)",
    ...Platform.select({
      web: { boxShadow: "0 8px 28px rgba(15, 118, 110, 0.08)" } as object,
      default: Shadow.sm,
    }),
  },
  markRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  circleShadow: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    ...Shadow.sm,
  },
  circleImg: {
    width: 56,
    height: 56,
  },
  loyo: {
    height: 44,
    flex: 1,
    maxWidth: 220,
    minWidth: 140,
  },
  kicker: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  subline: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
