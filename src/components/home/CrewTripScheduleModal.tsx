/**
 * Full-screen schedule editor shown after **today's driver** changes (random wheel or volunteer in chat).
 *
 * Reuses the same math as Create crew: `computeCrewSchedulePlanForDriver` orders pickups along the
 * shared corridor from the new driver's start point, recomputes pool duration, and writes:
 * - `crews.schedule_*` + `estimated_pool_drive_minutes` (via RPC so any member can save)
 * - `crew_trip_instances.excluded_pickup_user_ids` for riders not pooling today
 *
 * @see CrewFormationModal for the original creation-time UI
 * @see crewScheduleForDriver.ts
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import {
  setTripExcludedPickups,
  updateCrewScheduleSnapshot,
  type CrewListRow,
  type CrewMemberMapPin,
  type CrewRosterMember,
  type CrewScheduleMode,
  type CrewTripInstanceRow,
} from "@/lib/crewMessaging";
import { fetchPeerDetourPreview } from "@/lib/crewDetourPreview";
import { mapboxTokenPresent } from "@/lib/mapboxCommutePreview";
import { computeCrewSchedulePlanForDriver } from "@/lib/crewScheduleForDriver";
import { formatMinutesAsTime, modMinutes } from "@/lib/crewSchedulePlan";
import { showAlert } from "@/lib/platformAlert";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

function scheduleStopVerb(pattern: CrewListRow["commute_pattern"]): "Pickup" | "Drop-off" {
  return pattern === "to_home" ? "Drop-off" : "Pickup";
}

function originDestinationCopy(pattern: CrewListRow["commute_pattern"]): { origin: string; destination: string } {
  if (pattern === "to_home") {
    return { origin: "Workplace (origin)", destination: "Home (destination)" };
  }
  return { origin: "Home (origin)", destination: "Workplace (destination)" };
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  crew: CrewListRow;
  tripInstance: CrewTripInstanceRow;
  driverUserId: string;
  viewerUserId: string;
  roster: CrewRosterMember[];
  memberPins: CrewMemberMapPin[];
  viewerHome: unknown;
  viewerWork: unknown;
};

export function CrewTripScheduleModal({
  visible,
  onClose,
  onSaved,
  crew,
  tripInstance,
  driverUserId,
  viewerUserId,
  roster,
  memberPins,
  viewerHome,
  viewerWork,
}: Props) {
  const [scheduleMode, setScheduleMode] = useState<CrewScheduleMode>("arrival");
  const [anchorMinutes, setAnchorMinutes] = useState(540);
  const [baseRouteMin, setBaseRouteMin] = useState(25);
  const [maxPick, setMaxPick] = useState(4);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Passengers included in the pool (driver excluded). */
  const [ridingIds, setRidingIds] = useState<Set<string>>(() => new Set());
  const [peerDetourById, setPeerDetourById] = useState<
    Record<string, { extraMin: number } | "loading" | "err" | "no_token">
  >({});

  const driverName =
    roster.find((m) => m.userId === driverUserId)?.fullName?.trim() || "Driver";

  const passengerRoster = useMemo(
    () => roster.filter((m) => m.userId !== driverUserId),
    [roster, driverUserId]
  );

  useEffect(() => {
    if (!visible) {
      setSchedulePickerOpen(false);
      return;
    }
    setScheduleMode(crew.schedule_mode ?? "arrival");
    setAnchorMinutes(modMinutes(crew.schedule_anchor_minutes ?? 540));
    const ex = new Set(tripInstance.excluded_pickup_user_ids ?? []);
    const initial = new Set<string>();
    for (const m of passengerRoster) {
      if (!ex.has(m.userId)) initial.add(m.userId);
    }
    if (initial.size === 0 && passengerRoster.length > 0) {
      for (const m of passengerRoster) initial.add(m.userId);
    }
    setRidingIds(initial);
    setPeerDetourById({});
  }, [visible, crew.schedule_mode, crew.schedule_anchor_minutes, tripInstance.excluded_pickup_user_ids, passengerRoster]);

  useEffect(() => {
    if (!visible || !driverUserId) return;
    let cancelled = false;
    const pattern = crew.commute_pattern ?? "to_work";
    const dir = pattern === "to_home" ? "from_work" : "to_work";
    void (async () => {
      const { data } = await supabase
        .from("commute_routes")
        .select("duration_s")
        .eq("user_id", driverUserId)
        .eq("direction", dir)
        .maybeSingle();
      if (cancelled) return;
      const s = data?.duration_s;
      setBaseRouteMin(typeof s === "number" && s > 0 ? Math.max(1, Math.round(s / 60)) : 25);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, driverUserId, crew.commute_pattern]);

  useEffect(() => {
    if (!visible || !driverUserId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("seats")
        .eq("user_id", driverUserId)
        .eq("active", true)
        .order("seats", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const s = typeof data?.seats === "number" ? data.seats : 4;
      setMaxPick(Math.max(1, Math.min(6, s - 1)));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, driverUserId]);

  const ridingList = useMemo(() => [...ridingIds], [ridingIds]);

  const schedulePlan = useMemo(() => {
    const extraMinByUserId: Record<string, number> = {};
    for (const [id, v] of Object.entries(peerDetourById)) {
      if (typeof v === "object" && v !== null && "extraMin" in v) {
        extraMinByUserId[id] = v.extraMin;
      }
    }
    return computeCrewSchedulePlanForDriver({
      commutePattern: crew.commute_pattern ?? "to_work",
      viewerHome,
      viewerWork,
      driverUserId,
      memberPins,
      passengerUserIds: ridingList,
      mode: scheduleMode,
      anchorMinutes,
      baseCorridorMinutes: baseRouteMin,
      extraMinByUserId,
    });
  }, [
    crew.commute_pattern,
    viewerHome,
    viewerWork,
    driverUserId,
    memberPins,
    ridingList,
    scheduleMode,
    anchorMinutes,
    baseRouteMin,
    peerDetourById,
  ]);

  const loadDetour = useCallback(
    async (peerId: string) => {
      const peer = memberPins.find((p) => p.userId === peerId);
      const driverPin = memberPins.find((p) => p.userId === driverUserId);
      const h = parseGeoPoint(viewerHome as unknown);
      const w = parseGeoPoint(viewerWork as unknown);
      if (!peer || !driverPin || !h || !w) return;
      if (!mapboxTokenPresent()) {
        setPeerDetourById((m) => ({ ...m, [peerId]: "no_token" }));
        return;
      }
      setPeerDetourById((m) => ({ ...m, [peerId]: "loading" }));
      const pattern = crew.commute_pattern ?? "to_work";
      const peerPt = { lat: peer.lat, lng: peer.lng };
      const preview =
        pattern === "to_home"
          ? await fetchPeerDetourPreview(w, h, peerPt)
          : await fetchPeerDetourPreview({ lat: driverPin.lat, lng: driverPin.lng }, w, peerPt);
      if (!preview) {
        setPeerDetourById((m) => ({ ...m, [peerId]: "err" }));
        return;
      }
      setPeerDetourById((m) => ({
        ...m,
        [peerId]: { extraMin: preview.estimate.extraDurationMin },
      }));
    },
    [memberPins, driverUserId, viewerHome, viewerWork, crew.commute_pattern]
  );

  useEffect(() => {
    if (!visible) return;
    for (const id of ridingIds) {
      if (id === driverUserId) continue;
      if (peerDetourById[id] !== undefined) continue;
      void loadDetour(id);
    }
  }, [visible, ridingIds, driverUserId, peerDetourById, loadDetour]);

  function bumpAnchorMinutes(delta: number) {
    setAnchorMinutes((m) => modMinutes(m + delta));
  }

  function toggleRiding(peerId: string) {
    setRidingIds((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) {
        next.delete(peerId);
        return next;
      }
      if (next.size < maxPick) {
        next.add(peerId);
        return next;
      }
      showAlert("Pool full", `This vehicle can cover at most ${maxPick} extra riders for detour math.`);
      return prev;
    });
  }

  async function handleSave() {
    if (!schedulePlan) {
      showAlert("Schedule", "Could not compute times. Check home and work pins.");
      return;
    }
    setSaving(true);
    try {
      const snap = await updateCrewScheduleSnapshot({
        crewId: crew.id,
        scheduleMode,
        scheduleAnchorMinutes: anchorMinutes,
        estimatedPoolDriveMinutes: schedulePlan.totalDriveMin,
      });
      if (!snap.ok) {
        showAlert("Could not save", snap.reason);
        return;
      }
      const allPassengerIds = passengerRoster.map((m) => m.userId);
      const excluded = allPassengerIds.filter((id) => !ridingIds.has(id));
      const exRes = await setTripExcludedPickups(tripInstance.id, excluded);
      if (!exRes.ok) {
        showAlert("Partial save", `Schedule saved, but pickup list could not update: ${exRes.reason}`);
      }
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const od = originDestinationCopy(crew.commute_pattern ?? "to_work");
  const verb = scheduleStopVerb(crew.commute_pattern ?? "to_work");
  const readyHint = verb === "Pickup" ? "Be ready (pickup)" : "Drop off";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabWrap}>
            <View style={styles.grabBar} />
          </View>
          <View style={styles.header}>
            <Text style={styles.title}>Trip times for new driver</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.intro}>
            {driverName} is today&apos;s driver. Confirm who is riding and adjust the anchor time. Pickup order and
            ready-by times follow the corridor from their start.
          </Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Schedule</Text>
            <Text style={styles.hint}>Times follow your device clock.</Text>
            <View style={styles.scheduleTopRow}>
              <Pressable
                style={styles.scheduleDropdown}
                onPress={() => setSchedulePickerOpen(true)}
                accessibilityRole="button"
              >
                <Text style={styles.scheduleDropdownText} numberOfLines={1}>
                  {scheduleMode === "arrival" ? "Arrive at destination" : "Departing from origin"}
                </Text>
                <Ionicons name="chevron-down" size={20} color={Colors.primaryDark} />
              </Pressable>
              <View style={styles.scheduleTimeStepper}>
                <Pressable style={styles.stepBtn} onPress={() => bumpAnchorMinutes(-15)}>
                  <Ionicons name="remove" size={22} color={Colors.primary} />
                </Pressable>
                <Text style={styles.scheduleTimeValue}>{formatMinutesAsTime(anchorMinutes)}</Text>
                <Pressable style={styles.stepBtn} onPress={() => bumpAnchorMinutes(15)}>
                  <Ionicons name="add" size={22} color={Colors.primary} />
                </Pressable>
              </View>
            </View>

            {schedulePlan ? (
              <View style={styles.scheduleHero}>
                {scheduleMode === "arrival" ? (
                  <View style={styles.scheduleHeroPrimary}>
                    <Text style={styles.scheduleHeroKicker}>Depart by</Text>
                    <Text style={styles.scheduleHeroTime}>{formatMinutesAsTime(schedulePlan.driverDepartMinutes)}</Text>
                    <Text style={styles.scheduleHeroSecondary}>
                      ETA at destination {formatMinutesAsTime(schedulePlan.destinationArrivalMinutes)} · pool drive about{" "}
                      {schedulePlan.totalDriveMin} min
                    </Text>
                  </View>
                ) : (
                  <View style={styles.scheduleHeroPrimary}>
                    <Text style={styles.scheduleHeroKicker}>ETA at destination</Text>
                    <Text style={styles.scheduleHeroTime}>
                      {formatMinutesAsTime(schedulePlan.destinationArrivalMinutes)}
                    </Text>
                    <Text style={styles.scheduleHeroSecondary}>
                      Depart by {formatMinutesAsTime(schedulePlan.driverDepartMinutes)} · pool drive about{" "}
                      {schedulePlan.totalDriveMin} min
                    </Text>
                  </View>
                )}
                <View style={styles.timeline}>
                  {[
                    {
                      key: "origin",
                      title: od.origin,
                      time: formatMinutesAsTime(schedulePlan.driverDepartMinutes),
                      hint: "Driver leaves",
                    },
                    ...schedulePlan.riderLines.map((r) => ({
                      key: r.userId,
                      title: `${verb} · ${r.label}`,
                      time: formatMinutesAsTime(r.readyByMinutes),
                      hint: readyHint,
                    })),
                    {
                      key: "dest",
                      title: od.destination,
                      time: formatMinutesAsTime(schedulePlan.destinationArrivalMinutes),
                      hint: "Arrive",
                    },
                  ].map((node, i, arr) => (
                    <View key={node.key} style={styles.timelineRow}>
                      <View style={styles.timelineGutter}>
                        <View style={styles.timelineDot} />
                        {i < arr.length - 1 ? <View style={styles.timelineConnector} /> : null}
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={styles.timelineTitle}>{node.title}</Text>
                        <Text style={styles.timelineTime}>{node.time}</Text>
                        <Text style={styles.timelineHint}>{node.hint}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={styles.footnote}>
                  Times are approximate. Road conditions are not fully reflected. Use as guidance only.
                </Text>
              </View>
            ) : (
              <Text style={styles.hint}>Save home and workplace under Profile to unlock schedule math.</Text>
            )}

            <Text style={styles.label}>Riding today (pickup order)</Text>
            <Text style={styles.hint}>
              Unselect someone if they are not pooling today. Order updates from {driverName}&apos;s route.
            </Text>
            {passengerRoster.map((m) => {
              const on = ridingIds.has(m.userId);
              const det = peerDetourById[m.userId];
              const busy = det === "loading";
              return (
                <Pressable
                  key={m.userId}
                  style={[styles.peerRow, !on && styles.peerRowOff]}
                  onPress={() => toggleRiding(m.userId)}
                >
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.peerName} numberOfLines={1}>
                      {(m.fullName || "Member").trim()}
                      {m.userId === viewerUserId ? " (you)" : ""}
                    </Text>
                    {busy ? (
                      <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 4 }} />
                    ) : typeof det === "object" && det ? (
                      <Text style={styles.peerSub}>+{det.extraMin.toFixed(0)} min pickup detour (est.)</Text>
                    ) : det === "err" ? (
                      <Text style={styles.peerSub}>Detour estimate unavailable</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable style={[styles.primary, saving && styles.primaryDisabled]} onPress={() => void handleSave()} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save trip schedule</Text>}
          </Pressable>
        </View>
      </View>

      <Modal visible={schedulePickerOpen && visible} transparent animationType="fade" onRequestClose={() => setSchedulePickerOpen(false)}>
        <Pressable style={styles.pickerRoot} onPress={() => setSchedulePickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.pickerTitle}>Schedule type</Text>
            <Pressable
              style={styles.pickerOption}
              onPress={() => {
                setScheduleMode("arrival");
                setSchedulePickerOpen(false);
              }}
            >
              <Text style={styles.pickerOptionText}>Arrive at destination</Text>
              {scheduleMode === "arrival" ? <Ionicons name="checkmark" size={22} color={Colors.primary} /> : null}
            </Pressable>
            <Pressable
              style={styles.pickerOption}
              onPress={() => {
                setScheduleMode("start");
                setSchedulePickerOpen(false);
              }}
            >
              <Text style={styles.pickerOptionText}>Departing from origin</Text>
              {scheduleMode === "start" ? <Ionicons name="checkmark" size={22} color={Colors.primary} /> : null}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "92%",
    paddingBottom: Spacing.lg,
    ...Shadow.lg,
  },
  grabWrap: { alignItems: "center", paddingTop: Spacing.sm },
  grabBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, flex: 1, paddingRight: Spacing.sm },
  intro: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  scroll: { maxHeight: 480 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs, lineHeight: 18 },
  scheduleTopRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  scheduleDropdown: {
    flex: 1,
    minWidth: 160,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background,
  },
  scheduleDropdownText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  scheduleTimeStepper: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  scheduleTimeValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    minWidth: 100,
    textAlign: "center",
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  scheduleHero: {
    backgroundColor: "rgba(11, 132, 87, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.22)",
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  scheduleHeroPrimary: { marginBottom: Spacing.lg },
  scheduleHeroKicker: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  scheduleHeroTime: {
    fontSize: 34,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    marginTop: 4,
  },
  scheduleHeroSecondary: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 20 },
  timeline: { marginTop: Spacing.xs },
  timelineRow: { flexDirection: "row", alignItems: "stretch", minHeight: 56 },
  timelineGutter: { width: 22, alignItems: "center", alignSelf: "stretch", flexDirection: "column" },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  timelineConnector: { width: 3, flex: 1, minHeight: 24, backgroundColor: Colors.border, marginTop: 2 },
  timelineContent: { flex: 1, paddingLeft: Spacing.md, paddingBottom: Spacing.md },
  timelineTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  timelineTime: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.primaryDark, marginTop: 2 },
  timelineHint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  footnote: { fontSize: 10, color: Colors.textTertiary, lineHeight: 15, marginTop: Spacing.sm },
  peerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
    marginBottom: Spacing.sm,
  },
  peerRowOff: { borderColor: Colors.border, backgroundColor: Colors.background },
  check: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  peerName: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  peerSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  primary: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
  pickerRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: Spacing.lg },
  pickerSheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, marginBottom: Spacing.sm },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
  },
  pickerOptionText: { fontSize: FontSize.sm, color: Colors.text },
});
