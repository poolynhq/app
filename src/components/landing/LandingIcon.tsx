import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Landing } from "@/constants/landingTheme";

type IonName = keyof typeof Ionicons.glyphMap;

export type LandingIconTone =
  | "surface"
  | "surfaceOutline"
  | "onDark"
  | "onForest";

type Props = {
  name: IonName;
  /** Icon glyph size */
  size?: number;
  /** Container width/height */
  box?: number;
  tone?: LandingIconTone;
  /** Full circle vs rounded square (Lovable-style tiles) */
  rounded?: "pill" | "tile";
};

export function LandingIcon({
  name,
  size = 22,
  box = 44,
  tone = "surface",
  rounded = "tile",
}: Props) {
  const radius = rounded === "pill" ? box / 2 : Math.min(14, box * 0.28);
  const { bg, border, color } = toneStyle(tone);
  return (
    <View
      style={[
        styles.wrap,
        {
          width: box,
          height: box,
          borderRadius: radius,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: border ? 1 : 0,
        },
      ]}
    >
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

function toneStyle(tone: LandingIconTone): {
  bg: string;
  border: string | undefined;
  color: string;
} {
  switch (tone) {
    case "surfaceOutline":
      return {
        bg: Landing.white,
        border: Landing.tealLine,
        color: Landing.tealDark,
      };
    case "onDark":
      return {
        bg: Landing.onDarkFill,
        border: Landing.onDarkBorder,
        color: Landing.tealOnDark,
      };
    case "onForest":
      return {
        bg: Landing.onForestIconBg,
        border: undefined,
        color: Landing.tealVivid,
      };
    default:
      return {
        bg: Landing.tealMuted,
        border: undefined,
        color: Landing.tealDark,
      };
  }
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
