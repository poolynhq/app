import { useEffect, useState } from "react";
import {
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import Animated, {
  Easing,
  type AnimatedStyle,
  type SharedValue,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Landing } from "@/constants/landingTheme";

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const NODE = 52;
const SPOKE_TRIM = 30;

function leafRgba(alpha: number): string {
  const hex = Landing.leaf.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const webSatShadow =
  Platform.OS === "web"
    ? ({ boxShadow: `0 6px 20px ${leafRgba(0.2)}` } as object)
    : {};

/** Quadrants: dice TL, chat TR, music BL, game BR (matches left column). */
const SATELLITES: {
  angle: number;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { angle: (-3 * Math.PI) / 4, icon: "dice-outline" },
  { angle: -Math.PI / 4, icon: "chatbubbles-outline" },
  { angle: (3 * Math.PI) / 4, icon: "musical-notes-outline" },
  { angle: Math.PI / 4, icon: "game-controller-outline" },
];

function HubSpoke({
  x1,
  y1,
  x2,
  y2,
  stroke,
  dashOffset,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  dashOffset: SharedValue<number>;
}) {
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));
  return (
    <AnimatedLine
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={2}
      strokeDasharray="7 8"
      strokeLinecap="round"
      animatedProps={animatedProps}
    />
  );
}

function PulseRing({
  cx,
  cy,
  delay,
  maxR,
  stroke,
}: {
  cx: number;
  cy: number;
  delay: number;
  maxR: number;
  stroke: string;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: 2600,
            easing: Easing.out(Easing.quad),
          }),
          withTiming(0, { duration: 0 })
        ),
        -1,
        false
      )
    );
  }, [delay, p]);
  const animatedProps = useAnimatedProps(() => ({
    r: 26 + p.value * (maxR - 26),
    opacity: 0.5 * (1 - p.value),
  }));
  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      fill="none"
      stroke={stroke}
      strokeWidth={1.5}
      animatedProps={animatedProps}
    />
  );
}

/**
 * Recognizable car (Ionicons) on a wide horizontal pill, not a tall bus block.
 * Three person glyphs overlap the roof line so it reads as a full carpool.
 */
function CarpoolCarIllustration({
  headWiggleStyle,
}: {
  headWiggleStyle: AnimatedStyle<ViewStyle>;
}) {
  return (
    <View style={carPool.outer}>
      <View style={carPool.pill}>
        <View style={carPool.stack}>
          <Animated.View style={[carPool.riders, headWiggleStyle]}>
            <Ionicons name="person" size={13} color="rgba(255,255,255,0.94)" />
            <Ionicons name="person" size={13} color="rgba(255,255,255,0.94)" />
            <Ionicons name="person" size={13} color="rgba(255,255,255,0.94)" />
          </Animated.View>
          <Ionicons name="car-sport" size={56} color={Landing.white} />
        </View>
      </View>
    </View>
  );
}

function SatelliteNode({
  left,
  top,
  icon,
  phase,
  spin,
}: {
  left: number;
  top: number;
  icon: keyof typeof Ionicons.glyphMap;
  phase: number;
  spin: boolean;
}) {
  const bob = useSharedValue(0);
  const rotation = useSharedValue(0);
  useEffect(() => {
    bob.value = withDelay(
      phase,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: 1100,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: 1100,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        false
      )
    );
    if (spin) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 12000, easing: Easing.linear }),
        -1,
        false
      );
    }
  }, [bob, phase, rotation, spin]);

  const wrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(bob.value, [0, 1], [0, -5]) },
      { scale: interpolate(bob.value, [0, 1], [1, 1.05]) },
    ],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      style={[
        styles.satWrap,
        { left: left - NODE / 2, top: top - NODE / 2 },
        wrapStyle,
      ]}
    >
      <View style={styles.satGlow} />
      <View style={styles.satCircle}>
        {spin ? (
          <Animated.View style={iconStyle}>
            <Ionicons name={icon} size={22} color={Landing.forest} />
          </Animated.View>
        ) : (
          <Ionicons name={icon} size={22} color={Landing.forest} />
        )}
      </View>
    </Animated.View>
  );
}

export function CommunityHubAnimation() {
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const dashOffset = useSharedValue(0);
  const carBob = useSharedValue(0);
  const headWiggle = useSharedValue(0);

  useEffect(() => {
    dashOffset.value = withRepeat(
      withTiming(80, { duration: 2000, easing: Easing.linear }),
      -1,
      true
    );
    carBob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    headWiggle.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [carBob, dashOffset, headWiggle]);

  const carStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(carBob.value, [0, 1], [0, -4]) },
      { scale: interpolate(carBob.value, [0, 1], [1, 1.02]) },
    ],
  }));

  const headStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(headWiggle.value, [0, 1], [-2, 2]),
      },
    ],
  }));

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  }

  const W = layout.width;
  const H = layout.height;
  const cx = W / 2;
  const cy = H / 2;
  const orbit = Math.min(W, H) * 0.36;
  const pulseMax = orbit + 18;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {W > 0 && H > 0 ? (
        <>
          <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
            {[Landing.leaf, leafRgba(0.45), leafRgba(0.28)].map((stroke, i) => (
              <PulseRing
                key={i}
                cx={cx}
                cy={cy}
                delay={i * 750}
                maxR={pulseMax + i * 12}
                stroke={stroke}
              />
            ))}
            {SATELLITES.map((s, i) => {
              const ux = cx + (orbit - SPOKE_TRIM) * Math.cos(s.angle);
              const uy = cy + (orbit - SPOKE_TRIM) * Math.sin(s.angle);
              return (
                <HubSpoke
                  key={i}
                  x1={cx}
                  y1={cy}
                  x2={ux}
                  y2={uy}
                  stroke={leafRgba(0.5)}
                  dashOffset={dashOffset}
                />
              );
            })}
          </Svg>

          {SATELLITES.map((s, i) => {
            const sx = cx + orbit * Math.cos(s.angle);
            const sy = cy + orbit * Math.sin(s.angle);
            return (
              <SatelliteNode
                key={i}
                left={sx}
                top={sy}
                icon={s.icon}
                phase={i * 220}
                spin={s.icon === "dice-outline"}
              />
            );
          })}

          <Animated.View
            style={[styles.carCluster, { left: cx - 76, top: cy - 42 }, carStyle]}
          >
            <CarpoolCarIllustration headWiggleStyle={headStyle} />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 280,
    width: "100%",
    position: "relative",
    overflow: "hidden",
  },
  satWrap: {
    position: "absolute",
    width: NODE,
    height: NODE,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
  },
  satGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: NODE / 2,
    backgroundColor: leafRgba(0.12),
    transform: [{ scale: 1.15 }],
  },
  satCircle: {
    width: NODE - 6,
    height: NODE - 6,
    borderRadius: (NODE - 6) / 2,
    backgroundColor: Landing.mintSurface,
    borderWidth: 1,
    borderColor: leafRgba(0.25),
    alignItems: "center",
    justifyContent: "center",
    ...webSatShadow,
  },
  carCluster: {
    position: "absolute",
    width: 152,
    height: 88,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "center",
  },
});

const carPool = StyleSheet.create({
  outer: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  pill: {
    width: 152,
    height: 80,
    borderRadius: 40,
    backgroundColor: Landing.forest,
    alignItems: "center",
    justifyContent: "center",
    ...webSatShadow,
  },
  stack: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  riders: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: -14,
    zIndex: 2,
  },
});
