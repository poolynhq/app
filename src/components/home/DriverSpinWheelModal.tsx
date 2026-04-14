import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import Svg, { Path, Polygon, Text as SvgText } from "react-native-svg";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { getOrCreateTripInstance, setCrewDesignatedDriver } from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { showAlert } from "@/lib/platformAlert";
import { firstNameOnly } from "@/lib/personName";
import type { CrewWheelMember } from "@/lib/crewDriverDicePool";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

const POOLYN_YELLOW = "#FACC15";
const POOLYN_YELLOW_TEXT = "#1A1A2E";
const SLICE_A = "#F97316";
const SLICE_B = "#84CC16";

const poolynHubIcon = require("../../../assets/poolyn-Icon-white-circle.png");
const poolynWordmark = require("../../../assets/poolyn-black-full-logo.png");

const AnimatedView = Animated.createAnimatedComponent(View);

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function wedgePath(cx: number, cy: number, r: number, a0Deg: number, a1Deg: number) {
  const x0 = cx + r * Math.cos(degToRad(a0Deg));
  const y0 = cy + r * Math.sin(degToRad(a0Deg));
  const x1 = cx + r * Math.cos(degToRad(a1Deg));
  const y1 = cy + r * Math.sin(degToRad(a1Deg));
  const large = Math.abs(a1Deg - a0Deg) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

function mod360(a: number) {
  return ((a % 360) + 360) % 360;
}

/** Final rotation (degrees) so slice `winnerIndex` lands under the top pointer. */
function computeSpinTarget(currentDeg: number, winnerIndex: number, sliceCount: number, minFullSpins: number) {
  const seg = 360 / sliceCount;
  const centerDeg = -90 + (winnerIndex + 0.5) * seg;
  const needed = mod360(-90 - centerDeg - mod360(currentDeg));
  return currentDeg + minFullSpins * 360 + needed;
}

function truncateLabel(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Inter is loaded in `app/(tabs)/_layout.tsx` (reliable on Home). */
const WHEEL_NAME_FONT = "Inter_700Bold";

type Props = {
  visible: boolean;
  onClose: () => void;
  crewId: string;
  members: CrewWheelMember[];
  defaultSelectedIds: string[];
  onDriverAssigned: () => void | Promise<void>;
  /** Runs after the user dismisses the celebration screen (after the new driver is saved). Use to open follow-up UI such as the trip schedule editor. */
  onCelebrationComplete?: () => void;
};

export function DriverSpinWheelModal({
  visible,
  onClose,
  crewId,
  members,
  defaultSelectedIds,
  onDriverAssigned,
  onCelebrationComplete,
}: Props) {
  const { width: winW } = useWindowDimensions();
  const size = Math.min(280, Math.max(220, winW - Spacing.xl * 2));
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;

  const rotation = useSharedValue(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelectedIds));
  const [spinning, setSpinning] = useState(false);
  const [pendingMidRoute, setPendingMidRoute] = useState<CrewWheelMember | null>(null);
  const [phase, setPhase] = useState<"pick" | "celebrate">("pick");
  const [celebrationFirstName, setCelebrationFirstName] = useState<string | null>(null);

  const defaultsKey = defaultSelectedIds.join("|");

  useEffect(() => {
    if (!visible) return;
    setSelected(new Set(defaultSelectedIds));
    rotation.value = 0;
    setSpinning(false);
    setPendingMidRoute(null);
    setPhase("pick");
    setCelebrationFirstName(null);
  }, [visible, defaultsKey]);

  const selectedOrdered = useMemo(() => {
    const set = selected;
    return members.filter((m) => set.has(m.userId));
  }, [members, selected]);

  const animatedWheel = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const toggleMember = useCallback((m: CrewWheelMember) => {
    if (spinning) return;
    setSelected((prev) => {
      if (prev.has(m.userId)) {
        if (prev.size <= 2) {
          showAlert("Need two people", "Keep at least two people on the wheel.");
          return prev;
        }
        const next = new Set(prev);
        next.delete(m.userId);
        return next;
      }
      if (m.isMidRoute) {
        setTimeout(() => setPendingMidRoute(m), 0);
        return prev;
      }
      const next = new Set(prev);
      next.add(m.userId);
      return next;
    });
  }, [spinning]);

  const confirmMidRouteAdd = useCallback(() => {
    const m = pendingMidRoute;
    if (!m) return;
    setPendingMidRoute(null);
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(m.userId);
      return next;
    });
  }, [pendingMidRoute]);

  const finishCelebration = useCallback(() => {
    void (async () => {
      await Promise.resolve(onDriverAssigned());
      onClose();
      setTimeout(() => onCelebrationComplete?.(), 0);
    })();
  }, [onDriverAssigned, onClose, onCelebrationComplete]);

  const assignAfterSpin = useCallback(
    async (winnerId: string) => {
      try {
        const inst = await getOrCreateTripInstance(crewId, localDateKey());
        if (!inst.ok) {
          showAlert("Could not assign driver", inst.reason);
          return;
        }
        const res = await setCrewDesignatedDriver(inst.row.id, winnerId);
        if (!res.ok) {
          showAlert("Could not assign driver", res.reason.replace(/_/g, " "));
          return;
        }
        const w = members.find((m) => m.userId === winnerId);
        setCelebrationFirstName(firstNameOnly(w?.displayName));
        setPhase("celebrate");
      } finally {
        setSpinning(false);
      }
    },
    [crewId, members]
  );

  const runSpin = useCallback(() => {
    if (spinning || selectedOrdered.length < 2) return;
    const n = selectedOrdered.length;
    const winnerIdx = Math.floor(Math.random() * n);
    const winnerId = selectedOrdered[winnerIdx]!.userId;
    const winnerIndexInWheel = winnerIdx;

    setSpinning(true);
    const target = computeSpinTarget(rotation.value, winnerIndexInWheel, n, 6);

    rotation.value = withTiming(
      target,
      { duration: 4200, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished === false) {
          runOnJS(setSpinning)(false);
          return;
        }
        runOnJS(assignAfterSpin)(winnerId);
      }
    );
  }, [spinning, selectedOrdered, assignAfterSpin]);

  const slices = useMemo(() => {
    const n = selectedOrdered.length;
    if (n < 2) return [];
    const seg = 360 / n;
    const out: { path: string; label: string; midAngle: number; tx: number; ty: number; fill: string }[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = -90 + i * seg;
      const a1 = -90 + (i + 1) * seg;
      const mid = (a0 + a1) / 2;
      const tr = radius * 0.62;
      const tx = cx + tr * Math.cos(degToRad(mid));
      const ty = cy + tr * Math.sin(degToRad(mid));
      out.push({
        path: wedgePath(cx, cy, radius, a0, a1),
        label: truncateLabel(firstNameOnly(selectedOrdered[i]!.displayName), 14),
        midAngle: mid,
        tx,
        ty,
        fill: i % 2 === 0 ? SLICE_A : SLICE_B,
      });
    }
    return out;
  }, [selectedOrdered, cx, cy, radius]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={phase === "celebrate" ? finishCelebration : onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={spinning ? undefined : phase === "celebrate" ? finishCelebration : onClose}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              {phase !== "celebrate" ? (
                <Image
                  source={poolynWordmark}
                  style={styles.headerWordmark}
                  resizeMode="contain"
                  accessibilityLabel="Poolyn"
                />
              ) : null}
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {phase === "celebrate" ? "Driver chosen" : "Randomize driver"}
              </Text>
            </View>
            <Pressable
              onPress={phase === "celebrate" ? finishCelebration : onClose}
              disabled={spinning}
              hitSlop={12}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {phase === "celebrate" ? (
            <View style={styles.celebrateWrap}>
              <Text style={styles.celebrateEmoji} accessibilityLabel="">
                🎉
              </Text>
              <Text style={styles.celebrateTitle}>Today&apos;s driver</Text>
              <Text style={styles.celebrateName}>{celebrationFirstName ?? "Driver"}</Text>
              <Text style={styles.celebrateSub}>
                They coordinate pickups and timing. Crew Chat highlights their messages.
              </Text>
              <Pressable style={styles.celebrateDone} onPress={finishCelebration} accessibilityRole="button">
                <Text style={styles.celebrateDoneText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
          <View style={styles.wheelStage}>
            <View style={[styles.pointerWrap, { width: size }]}>
              <Svg width={size} height={18}>
                <Polygon points={`${size / 2 - 10},0 ${size / 2 + 10},0 ${size / 2},18`} fill="#2563EB" />
              </Svg>
            </View>
            <AnimatedView style={[styles.wheelBox, { width: size, height: size }, animatedWheel]}>
              <Svg width={size} height={size}>
                {slices.map((s, i) => (
                  <Path key={i} d={s.path} fill={s.fill} stroke="#fff" strokeWidth={2} />
                ))}
                {slices.map((s, i) => (
                  <SvgText
                    key={`t-${i}`}
                    x={s.tx}
                    y={s.ty}
                    fill={POOLYN_YELLOW_TEXT}
                    fontSize={13}
                    fontFamily={WHEEL_NAME_FONT}
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {s.label}
                  </SvgText>
                ))}
              </Svg>
              <View style={styles.wheelHubOverlay} pointerEvents="none">
                <Image source={poolynHubIcon} style={styles.wheelHubIcon} resizeMode="contain" accessibilityLabel="" />
              </View>
            </AnimatedView>
          </View>

          <Text style={styles.hint}>
            Corridor ends (the default pair on the wheel) are grouped at the top, then mid-route homes. Tap to
            include or remove. Mid-route pickups can mean extra driving before the shared destination.
          </Text>

          <ScrollView style={styles.memberScroll} contentContainerStyle={styles.memberScrollContent}>
            {members.map((m) => {
              const on = selected.has(m.userId);
              return (
                <Pressable
                  key={m.userId}
                  style={[styles.memberRow, on ? styles.memberRowOn : styles.memberRowOff]}
                  onPress={() => toggleMember(m)}
                  disabled={spinning}
                >
                  <Ionicons
                    name={on ? "checkmark-circle" : "square-outline"}
                    size={22}
                    color={on ? Colors.primary : Colors.textTertiary}
                  />
                  <View style={styles.memberRowText}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.displayName}
                      {m.isMidRoute ? (
                        <Text style={styles.midTag}> (mid-route)</Text>
                      ) : (
                        <Text style={styles.endTag}> (corridor end)</Text>
                      )}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            style={[
              styles.spinBtn,
              (spinning || selectedOrdered.length < 2) && styles.spinBtnDisabled,
            ]}
            onPress={runSpin}
            disabled={spinning || selectedOrdered.length < 2}
          >
            {spinning ? (
              <ActivityIndicator color={POOLYN_YELLOW_TEXT} />
            ) : (
              <>
                <Ionicons name="sync" size={22} color={POOLYN_YELLOW_TEXT} />
                <Text style={styles.spinBtnText}>Spin the wheel</Text>
              </>
            )}
          </Pressable>

          {pendingMidRoute ? (
            <View style={styles.confirmOverlay}>
              <View style={styles.confirmCard}>
                <Text style={styles.confirmTitle}>Opposite-direction pickups?</Text>
                <Text style={styles.confirmBody}>
                  {pendingMidRoute.displayName} is along the middle of the route. As driver they may need to drive
                  away from the shared destination first to pick up others. Add them to the wheel anyway?
                </Text>
                <View style={styles.confirmRow}>
                  <Pressable style={styles.confirmCancel} onPress={() => setPendingMidRoute(null)}>
                    <Text style={styles.confirmCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.confirmOk} onPress={confirmMidRouteAdd}>
                    <Text style={styles.confirmOkText}>Add</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.md,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    maxHeight: "92%",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.sm,
    minWidth: 0,
  },
  headerWordmark: {
    width: 76,
    height: 26,
    flexShrink: 0,
  },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    fontFamily: "Inter_700Bold",
  },
  celebrateWrap: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  celebrateEmoji: { fontSize: 44, marginBottom: Spacing.xs },
  celebrateTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  celebrateName: {
    fontSize: FontSize["3xl"],
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  celebrateSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginTop: Spacing.xs,
    fontFamily: "Inter_500Medium",
  },
  celebrateDone: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
  },
  celebrateDoneText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
    fontFamily: "Inter_700Bold",
  },
  wheelStage: { alignItems: "center", marginBottom: Spacing.sm },
  pointerWrap: { alignItems: "center", height: 18, marginBottom: -6, zIndex: 2 },
  wheelBox: { alignItems: "center", justifyContent: "center", position: "relative" },
  wheelHubOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelHubIcon: {
    width: 58,
    height: 58,
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  memberScroll: { maxHeight: 200, marginBottom: Spacing.md },
  memberScrollContent: { gap: Spacing.xs, paddingBottom: Spacing.xs },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  memberRowOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  memberRowOff: {
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  memberRowText: { flex: 1, minWidth: 0 },
  memberName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  midTag: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.warning },
  endTag: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  spinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: POOLYN_YELLOW,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
  },
  spinBtnDisabled: { opacity: 0.55 },
  spinBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: POOLYN_YELLOW_TEXT,
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: BorderRadius.xl,
  },
  confirmCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  confirmBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.md },
  confirmRow: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.md },
  confirmCancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  confirmCancelText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.semibold },
  confirmOk: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  confirmOkText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
});
