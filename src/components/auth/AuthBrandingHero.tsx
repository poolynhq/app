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

const poolynFullLogo = require("../../../assets/poolyn-black-full-logo.png");

type Props = {
  /** Short line under the wordmark, e.g. "Welcome back" */
  kicker: string;
  /** Supporting line */
  subline?: string;
};

/**
 * Shared auth header: full wordmark on a soft mint wash.
 */
export function AuthBrandingHero({ kicker, subline }: Props) {
  return (
    <LinearGradient
      colors={["#ECFDF5", "#F8FAFC"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <Image
        source={poolynFullLogo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Poolyn"
      />
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
  logo: {
    height: 56,
    width: 200,
    marginBottom: Spacing.md,
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
