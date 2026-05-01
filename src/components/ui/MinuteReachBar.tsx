import { useRef } from "react";
import { View, Pressable, StyleSheet, type LayoutChangeEvent } from "react-native";
import { Colors, BorderRadius, Spacing } from "@/constants/theme";

type Props = {
  minimumValue: number;
  maximumValue: number;
  value: number;
  onValueChange: (n: number) => void;
};

/**
 * Web-safe horizontal control (tap track to set). Replaces @react-native-community/slider on web
 * where that package can fail to resolve optional native pieces.
 */
export function MinuteReachBar({ minimumValue, maximumValue, value, onValueChange }: Props) {
  const widthRef = useRef(160);

  const setFromX = (x: number) => {
    const span = Math.max(1e-6, maximumValue - minimumValue);
    const ratio = Math.max(0, Math.min(1, x / widthRef.current));
    const v = Math.round(minimumValue + ratio * span);
    onValueChange(Math.max(minimumValue, Math.min(maximumValue, v)));
  };

  const fillRatio = (value - minimumValue) / Math.max(1e-6, maximumValue - minimumValue);

  return (
    <View
      style={styles.wrap}
      onLayout={(e: LayoutChangeEvent) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
    >
      <Pressable
        style={({ pressed }) => [styles.track, pressed && styles.trackPressed]}
        onPress={(e) => setFromX(e.nativeEvent.locationX ?? 0)}
      >
        <View style={[styles.fill, { width: `${fillRatio * 100}%` }]} />
      </Pressable>
      <View
        style={[styles.thumb, { left: `${fillRatio * 100}%`, marginLeft: -10 }]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 36,
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  track: {
    height: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  trackPressed: { opacity: 0.85 },
  fill: {
    height: "100%",
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary,
  },
  thumb: {
    position: "absolute",
    top: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
});
