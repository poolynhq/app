/**
 * Crew chat: shared driver wheel with server-side randomness (poolyn_crew_driver_spin_* RPCs).
 * Pool syncs over Realtime; only the session opener can execute the spin.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  abandonCrewDriverSpinSession,
  executeCrewDriverSpin,
  fetchCrewDriverSpinSession,
  openCrewDriverSpinSession,
  toggleCrewDriverSpinPool,
  type CrewDriverSpinSessionRow,
} from "@/lib/crewMessaging";
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

const WHEEL_NAME_FONT = "Inter_700Bold";

type Props = {
  visible: boolean;
  onClose: () => void;
  tripInstanceId: string;
  members: CrewWheelMember[];
  viewerUserId: string;
  onDriverAssigned: () => void | Promise<void>;
  onCelebrationComplete?: () => void;
};

export function CollaborativeDriverSpinModal({
  visible,
  onClose,
  tripInstanceId,
  members,
  viewerUserId,
  onDriverAssigned,
  onCelebrationComplete,
}: Props) {
  const { width: winW } = useWindowDimensions();
  const size = Math.min(280, Math.max(220, winW - Spacing.xl * 2));
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;

  const rotation = useSharedValue(0);
  const [session, setSession] = useState<CrewDriverSpinSessionRow | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [pendingMidRoute, setPendingMidRoute] = useState<CrewWheelMember | null>(null);
  const [phase, setPhase] = useState<"pick" | "celebrate">("pick");
  const [celebrationFirstName, setCelebrationFirstName] = useState<string | null>(null);

  const skipRealtimeSpinUiRef = useRef(false);
  const followerAnimatedKeyRef = useRef<string | null>(null);
  const openerCompletedSpinRef = useRef(false);
  const completeSpinUiRef = useRef<(winnerUserId: string) => void>(() => {});

  const selectedOrdered = useMemo(() => {
    if (!session?.pool_user_ids?.length) return [];
    const byId = new Map(members.map((m) => [m.userId, m]));
    return session.pool_user_ids
      .map((id) => byId.get(id))
      .filter((m): m is CrewWheelMember => !!m);
  }, [members, session?.pool_user_ids]);

  const animatedWheel = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const iAmOpener = session?.opened_by_user_id === viewerUserId;
  const openerFirstName = useMemo(() => {
    const id = session?.opened_by_user_id;
    if (!id) return "the host";
    const m = members.find((x) => x.userId === id);
    return firstNameOnly(m?.displayName) || "the host";
  }, [session?.opened_by_user_id, members]);

  const runSpinAnimation = useCallback(
    (winnerIndex: number, poolLen: number) => {
      if (poolLen < 2) return;
      setSpinning(true);
      const target = computeSpinTarget(rotation.value, winnerIndex, poolLen, 6);
      rotation.value = withTiming(
        target,
        { duration: 4200, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished === false) {
            runOnJS(setSpinning)(false);
            return;
          }
          runOnJS(setSpinning)(false);
        }
      );
    },
    [rotation]
  );

  const finishCelebration = useCallback(() => {
    void (async () => {
      await Promise.resolve(onDriverAssigned());
      onClose();
      setTimeout(() => onCelebrationComplete?.(), 0);
    })();
  }, [onDriverAssigned, onClose, onCelebrationComplete]);

  const completeSpinUi = useCallback(
    (winnerUserId: string) => {
      const w = members.find((m) => m.userId === winnerUserId);
      setCelebrationFirstName(firstNameOnly(w?.displayName));
      setPhase("celebrate");
    },
    [members]
  );

  completeSpinUiRef.current = completeSpinUi;

  /** Bootstrap session: join an open session if present; otherwise create (server default pool). */
  useEffect(() => {
    if (!visible || !tripInstanceId) return;
    setBooting(true);
    setBootError(null);
    void (async () => {
      try {
        const existing = await fetchCrewDriverSpinSession(tripInstanceId);
        if (existing?.phase === "open") {
          setSession(existing);
          return;
        }
        const res = await openCrewDriverSpinSession({
          tripInstanceId,
        });
        if (!res.ok) {
          setBootError(res.reason);
          return;
        }
        setSession({
          crew_trip_instance_id: tripInstanceId,
          opened_by_user_id: res.openedByUserId,
          pool_user_ids: res.poolUserIds,
          phase: "open",
          winner_user_id: null,
          winner_index: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } finally {
        setBooting(false);
      }
    })();
  }, [visible, tripInstanceId]);

  useEffect(() => {
    if (!visible || !tripInstanceId) return;

    const onRow = (row: Record<string, unknown> | null) => {
      if (!row) return;
      const pool = row.pool_user_ids;
      const ids = Array.isArray(pool) ? pool.filter((x): x is string => typeof x === "string") : [];
      const next: CrewDriverSpinSessionRow = {
        crew_trip_instance_id: row.crew_trip_instance_id as string,
        opened_by_user_id: row.opened_by_user_id as string,
        pool_user_ids: ids,
        phase: row.phase === "completed" ? "completed" : "open",
        winner_user_id: (row.winner_user_id as string | null) ?? null,
        winner_index: typeof row.winner_index === "number" ? row.winner_index : null,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
      };
      setSession(next);

      if (next.phase !== "completed" || next.winner_index == null || next.winner_user_id == null) return;

      if (skipRealtimeSpinUiRef.current) {
        return;
      }

      if (next.opened_by_user_id === viewerUserId && openerCompletedSpinRef.current) {
        return;
      }

      const key = `${next.winner_user_id}:${next.updated_at}`;
      if (followerAnimatedKeyRef.current === key) return;
      followerAnimatedKeyRef.current = key;

      runSpinAnimation(next.winner_index, ids.length);
      const wid = next.winner_user_id;
      setTimeout(() => completeSpinUiRef.current(wid), 4300);
    };

    const channel: RealtimeChannel = supabase
      .channel(`crew-spin:${tripInstanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crew_driver_spin_sessions",
          filter: `crew_trip_instance_id=eq.${tripInstanceId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setSession(null);
            onClose();
            return;
          }
          if (payload.new) onRow(payload.new as Record<string, unknown>);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [visible, tripInstanceId, onClose, runSpinAnimation, viewerUserId]);

  useEffect(() => {
    if (visible) return;
    rotation.value = 0;
    setSpinning(false);
    setPendingMidRoute(null);
    setPhase("pick");
    setCelebrationFirstName(null);
    setSession(null);
    setBootError(null);
    skipRealtimeSpinUiRef.current = false;
    followerAnimatedKeyRef.current = null;
    openerCompletedSpinRef.current = false;
  }, [visible, rotation]);

  const onToggleSelf = useCallback(
    async (add: boolean, member: CrewWheelMember) => {
      if (spinning || !session || session.phase !== "open") return;
      if (add && member.isMidRoute) {
        setPendingMidRoute(member);
        return;
      }
      const res = await toggleCrewDriverSpinPool(tripInstanceId, add);
      if (!res.ok) {
        showAlert("Could not update", res.reason.replace(/_/g, " "));
        return;
      }
      setSession((prev) =>
        prev
          ? { ...prev, pool_user_ids: res.poolUserIds, updated_at: new Date().toISOString() }
          : prev
      );
    },
    [spinning, session, tripInstanceId]
  );

  const confirmMidRouteAdd = useCallback(() => {
    const m = pendingMidRoute;
    if (!m) return;
    setPendingMidRoute(null);
    void onToggleSelf(true, { ...m, isMidRoute: false });
  }, [pendingMidRoute, onToggleSelf]);

  const onPressSpin = useCallback(async () => {
    if (!session || session.phase !== "open" || spinning || selectedOrdered.length < 2 || !iAmOpener) return;
    skipRealtimeSpinUiRef.current = true;
    openerCompletedSpinRef.current = true;
    const res = await executeCrewDriverSpin(tripInstanceId);
    if (!res.ok) {
      skipRealtimeSpinUiRef.current = false;
      openerCompletedSpinRef.current = false;
      showAlert("Could not spin", res.reason.replace(/_/g, " "));
      return;
    }
    const n = selectedOrdered.length;
    runSpinAnimation(res.winnerIndex, n);
    setTimeout(() => {
      completeSpinUi(res.winnerUserId);
      skipRealtimeSpinUiRef.current = false;
    }, 4300);
  }, [session, spinning, selectedOrdered.length, iAmOpener, tripInstanceId, runSpinAnimation, completeSpinUi]);

  const slices = useMemo(() => {
    const n = selectedOrdered.length;
    if (n < 2) return [];
    const seg = 360 / n;
    const out: { path: string; label: string; tx: number; ty: number; fill: string }[] = [];
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
        tx,
        ty,
        fill: i % 2 === 0 ? SLICE_A : SLICE_B,
      });
    }
    return out;
  }, [selectedOrdered, cx, cy, radius]);

  async function handleClose() {
    if (spinning) return;
    if (session?.phase === "open") {
      await abandonCrewDriverSpinSession(tripInstanceId);
    }
    onClose();
  }

  const showSheet = !bootError && !booting && session;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={phase === "celebrate" ? finishCelebration : handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={spinning ? undefined : phase === "celebrate" ? finishCelebration : handleClose}
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
              onPress={phase === "celebrate" ? finishCelebration : handleClose}
              disabled={spinning}
              hitSlop={12}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {booting ? (
            <View style={styles.bootCenter}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.bootText}>Starting wheel...</Text>
            </View>
          ) : bootError ? (
            <View style={styles.bootCenter}>
              <Text style={styles.errText}>{bootError.replace(/_/g, " ")}</Text>
              <Pressable style={styles.errBtn} onPress={handleClose}>
                <Text style={styles.errBtnText}>Close</Text>
              </Pressable>
            </View>
          ) : phase === "celebrate" ? (
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
          ) : showSheet ? (
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
                Corridor ends start on the wheel. Use Add me or Remove me for yourself. Only {openerFirstName} can
                spin.
              </Text>

              <ScrollView style={styles.memberScroll} contentContainerStyle={styles.memberScrollContent}>
                {members.map((m) => {
                  const inPool = session!.pool_user_ids.includes(m.userId);
                  const isSelf = m.userId === viewerUserId;
                  return (
                    <View
                      key={m.userId}
                      style={[styles.memberRow, inPool ? styles.memberRowOn : styles.memberRowOff]}
                    >
                      <View style={styles.memberRowText}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {firstNameOnly(m.displayName)}
                          {m.isMidRoute ? (
                            <Text style={styles.midTag}> (mid-route)</Text>
                          ) : (
                            <Text style={styles.endTag}> (corridor end)</Text>
                          )}
                        </Text>
                        {!isSelf ? (
                          <Text style={styles.poolHint}>{inPool ? "In the wheel" : "Not in the wheel"}</Text>
                        ) : null}
                      </View>
                      {isSelf ? (
                        <Pressable
                          style={styles.selfToggle}
                          onPress={() => void onToggleSelf(!inPool, m)}
                          disabled={spinning}
                        >
                          <Text style={styles.selfToggleText}>{inPool ? "Remove me" : "Add me"}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>

              {iAmOpener ? (
                <Pressable
                  style={[styles.spinBtn, (spinning || selectedOrdered.length < 2) && styles.spinBtnDisabled]}
                  onPress={() => void onPressSpin()}
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
              ) : (
                <Text style={styles.waitingSpin}>Only {openerFirstName} can spin the wheel.</Text>
              )}

              {pendingMidRoute ? (
                <View style={styles.confirmOverlay}>
                  <View style={styles.confirmCard}>
                    <Text style={styles.confirmTitle}>Opposite-direction pickups?</Text>
                    <Text style={styles.confirmBody}>
                      {pendingMidRoute.displayName} is along the middle of the route. As driver they may need to drive
                      away from the shared destination first to pick up others. Add yourself to the wheel anyway?
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
          ) : null}
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
  bootCenter: { alignItems: "center", paddingVertical: Spacing.xl, gap: Spacing.md },
  bootText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  errText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center" },
  errBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  errBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
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
  poolHint: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  selfToggle: {
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  selfToggleText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  waitingSpin: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
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
