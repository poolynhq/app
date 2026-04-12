import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { User } from "@/types/database";
import {
  getOrCreateTripInstance,
  recordCrewTripStarted,
  setTripExcludedPickups,
  type CrewCommutePattern,
  type CrewListRow,
  type CrewMemberMapPin,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { showAlert } from "@/lib/platformAlert";
import { openGoogleCrewDrivingRoute } from "@/lib/navigationUrls";
import { acquireTripStartCoordinates } from "@/lib/tripStartLocation";
import {
  distanceMeters,
  expectedTripStartAnchor,
  orderPickupsAlongCommute,
  orderPickupsGreedy,
  resolveCommuteGeometry,
  type ResolvedCommuteLeg,
} from "@/lib/crewRouteOrdering";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const START_LOCATION_THRESHOLD_M = 750;

type ProfilePins = Pick<User, "home_location" | "work_location">;

type Props = {
  visible: boolean;
  onClose: () => void;
  crew: CrewListRow;
  userId: string;
  profilePins: ProfilePins;
  crewPins: CrewMemberMapPin[];
  /** Called after exclusions are saved and Maps opens; use `tripInstanceId` to refresh server state. */
  onTripOpened?: (tripInstanceId: string) => void;
  /** True when today’s crew trip already has trip_started_at (driver reopening Maps, not first start). */
  resumeTrip?: boolean;
};

function inferRoundTripLeg(
  origin: { lat: number; lng: number } | null,
  home: { lat: number; lng: number },
  work: { lat: number; lng: number }
): ResolvedCommuteLeg {
  if (!origin) return "to_work";
  const dh = distanceMeters(origin, home);
  const dw = distanceMeters(origin, work);
  return dh <= dw ? "to_work" : "to_home";
}

function patternLabel(p: CrewCommutePattern): string {
  if (p === "to_work") return "One-way → work";
  if (p === "to_home") return "One-way → home";
  return "Round trip";
}

export function CrewTripStartSummaryModal({
  visible,
  onClose,
  crew,
  userId,
  profilePins,
  crewPins,
  onTripOpened,
  resumeTrip = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [tripInstanceId, setTripInstanceId] = useState<string | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [activeLeg, setActiveLeg] = useState<ResolvedCommuteLeg>("to_work");
  const [roundTripLegManual, setRoundTripLegManual] = useState(false);

  const onCloseRef = useRef(onClose);
  const onTripOpenedRef = useRef(onTripOpened);
  useEffect(() => {
    onCloseRef.current = onClose;
    onTripOpenedRef.current = onTripOpened;
  }, [onClose, onTripOpened]);

  const home = parseGeoPoint(profilePins.home_location as unknown);
  const work = parseGeoPoint(profilePins.work_location as unknown);

  const othersPins = useMemo(
    () => crewPins.filter((p) => p.userId !== userId),
    [crewPins, userId]
  );

  const pattern = crew.commute_pattern ?? "to_work";

  useEffect(() => {
    if (!visible) {
      setRoundTripLegManual(false);
      return;
    }
    if (pattern === "to_work") setActiveLeg("to_work");
    else if (pattern === "to_home") setActiveLeg("to_home");
  }, [visible, pattern]);

  useEffect(() => {
    if (!visible || pattern !== "round_trip" || !home || !work || roundTripLegManual) return;
    if (gps) setActiveLeg(inferRoundTripLeg(gps, home, work));
  }, [visible, pattern, home, work, gps, roundTripLegManual]);

  const geometry = useMemo(() => {
    if (!home || !work) return null;
    const leg: ResolvedCommuteLeg =
      pattern === "round_trip" ? activeLeg : pattern === "to_home" ? "to_home" : "to_work";
    return resolveCommuteGeometry({
      pattern,
      activeLeg: leg,
      home,
      work,
    });
  }, [pattern, activeLeg, home, work]);

  const expectedAnchor = useMemo(() => {
    if (!home || !work) return null;
    const leg: ResolvedCommuteLeg =
      pattern === "round_trip" ? activeLeg : pattern === "to_home" ? "to_home" : "to_work";
    return expectedTripStartAnchor({
      pattern,
      activeLeg: leg,
      home,
      work,
    });
  }, [pattern, activeLeg, home, work]);

  const locationOk = useMemo(() => {
    if (!gps || !expectedAnchor) return true;
    return distanceMeters(gps, expectedAnchor) <= START_LOCATION_THRESHOLD_M;
  }, [gps, expectedAnchor]);

  useEffect(() => {
    if (!visible) {
      setLoadingTrip(false);
      return;
    }
    let cancelled = false;
    setLoadingTrip(true);
    void (async () => {
      const inst = await getOrCreateTripInstance(crew.id, localDateKey());
      if (cancelled) return;
      if (!inst.ok) {
        showAlert("Could not load trip", inst.reason);
        onCloseRef.current();
        setLoadingTrip(false);
        return;
      }
      setTripInstanceId(inst.row.id);
      setExcludedIds(new Set(inst.row.excluded_pickup_user_ids ?? []));
      setLoadingTrip(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, crew.id]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLocating(true);
    void acquireTripStartCoordinates().then((pt) => {
      if (cancelled) return;
      setGps(pt);
      setLocating(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const includedPins = useMemo(
    () => othersPins.filter((p) => !excludedIds.has(p.userId)),
    [othersPins, excludedIds]
  );

  const orderedPreview = useMemo(() => {
    if (includedPins.length === 0) return [];
    const origin = gps ?? home ?? work;
    if (!origin) return includedPins;
    if (geometry) {
      return orderPickupsAlongCommute(
        origin,
        includedPins,
        geometry.segmentStart,
        geometry.segmentEnd
      );
    }
    return orderPickupsGreedy(origin, includedPins);
  }, [includedPins, gps, home, work, geometry]);

  function toggleExcluded(peerId: string, nextIncluded: boolean) {
    setExcludedIds((prev) => {
      const n = new Set(prev);
      if (nextIncluded) n.delete(peerId);
      else n.add(peerId);
      return n;
    });
  }

  async function onConfirmStart() {
    if (!geometry?.finalDestination) {
      showAlert(
        "Set commute pins",
        "Save home and workplace under Profile → Commute so Poolyn can build the full route."
      );
      return;
    }
    if (!tripInstanceId) {
      showAlert("Please wait", "Trip day is still loading.");
      return;
    }
    if (!locationOk && gps) {
      showAlert(
        "Location check",
        `You are about ${expectedAnchor ? Math.round(distanceMeters(gps, expectedAnchor)) : "?"} m from the usual start of this leg. Continue only if you meant to start here.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue anyway", onPress: () => void runOpenMaps() },
        ]
      );
      return;
    }
    await runOpenMaps();
  }

  async function runOpenMaps() {
    if (!geometry?.finalDestination || !tripInstanceId) return;
    setBusy(true);
    try {
      const excluded = [...excludedIds];
      const save = await setTripExcludedPickups(tripInstanceId, excluded);
      if (!save.ok) {
        showAlert("Could not save stops", save.reason);
        return;
      }
      if (!resumeTrip) {
        const started = await recordCrewTripStarted(tripInstanceId);
        if (!started.ok) {
          showAlert("Could not record trip start", started.reason);
          return;
        }
      }
      const originForMaps = gps ?? expectedAnchor ?? home ?? work;
      const ordered = orderedPreview.map((p) => ({ lat: p.lat, lng: p.lng }));
      const meta = openGoogleCrewDrivingRoute({
        origin: originForMaps,
        pickupsInVisitOrder: ordered,
        finalDestination: geometry.finalDestination,
      });
      if (meta.truncated) {
        showAlert(
          "Partial route in Maps",
          `Google Maps only fits so many stops in one trip. This link includes ${meta.usedCount} of ${meta.totalCount} pickups. Open remaining legs from Pickup order on the crew card.`,
          [{ text: "OK" }]
        );
      }
      onTripOpenedRef.current?.(tripInstanceId);
      onCloseRef.current();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => onCloseRef.current()}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={() => onCloseRef.current()} />
        <View style={styles.sheet}>
          <View style={styles.grabRow}>
            <View style={styles.grab} />
          </View>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{resumeTrip ? "Resume trip" : "Start Poolyn"}</Text>
            <Pressable onPress={() => onCloseRef.current()} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.patternRow}>
              {crew.sticker_image_url ? (
                <Image source={{ uri: crew.sticker_image_url }} style={styles.stickerImg} />
              ) : crew.sticker_emoji ? (
                <Text style={styles.sticker}>{crew.sticker_emoji}</Text>
              ) : null}
              <View style={styles.patternBadge}>
                <Ionicons
                  name={pattern === "round_trip" ? "git-compare-outline" : "arrow-forward"}
                  size={16}
                  color={Colors.primaryDark}
                />
                <Text style={styles.patternBadgeText}>{patternLabel(pattern)}</Text>
              </View>
            </View>
            <Text style={styles.crewName} numberOfLines={2}>
              {crew.name}
            </Text>

            {resumeTrip ? (
              <Text style={styles.resumeHint}>
                This trip is already in progress. We refresh your GPS, then reopen Google Maps with the same stops.
                Change toggles if someone is no longer riding.
              </Text>
            ) : null}

            {pattern === "round_trip" && home && work ? (
              <View style={styles.legRow}>
                <Text style={styles.legLabel}>This drive</Text>
                <View style={styles.legChips}>
                  <Pressable
                    style={[styles.chip, activeLeg === "to_work" && styles.chipOn]}
                    onPress={() => {
                      setRoundTripLegManual(true);
                      setActiveLeg("to_work");
                    }}
                  >
                    <Text style={[styles.chipText, activeLeg === "to_work" && styles.chipTextOn]}>
                      Toward work
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.chip, activeLeg === "to_home" && styles.chipOn]}
                    onPress={() => {
                      setRoundTripLegManual(true);
                      setActiveLeg("to_home");
                    }}
                  >
                    <Text style={[styles.chipText, activeLeg === "to_home" && styles.chipTextOn]}>
                      Toward home
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={styles.locCard}>
              <Text style={styles.locTitle}>{resumeTrip ? "Location (resume)" : "Location"}</Text>
              {locating ? (
                <ActivityIndicator color={Colors.primary} />
              ) : gps ? (
                <Text style={styles.locBody}>
                  GPS lock ready
                  {expectedAnchor && !locationOk
                    ? `. You are ${Math.round(distanceMeters(gps, expectedAnchor))} m from the usual start (threshold ${START_LOCATION_THRESHOLD_M} m).`
                    : expectedAnchor && locationOk
                      ? `. Within ${START_LOCATION_THRESHOLD_M} m of the usual start.`
                      : "."}
                </Text>
              ) : (
                <Text style={[styles.locBody, { color: Colors.warning }]}>
                  No GPS fix yet. Allow location, or the map will use your saved commute pin as the
                  starting point.
                </Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>Stops today</Text>
            <Text style={styles.sectionHint}>
              Turn off anyone who cancelled so Google Maps only navigates the pickups you still need.
            </Text>

            {loadingTrip ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.md }} />
            ) : othersPins.length === 0 ? (
              <Text style={styles.empty}>No other crew pickups with saved home pins.</Text>
            ) : (
              othersPins.map((p) => {
                const on = !excludedIds.has(p.userId);
                return (
                  <View key={p.userId} style={styles.stopRow}>
                    <View style={styles.stopTextCol}>
                      <Text style={styles.stopName} numberOfLines={2}>
                        {(p.fullName || "Crewmate").trim()}
                      </Text>
                      <Text style={styles.stopSub}>Pickup at saved home area</Text>
                    </View>
                    <Switch
                      value={on}
                      onValueChange={(v) => toggleExcluded(p.userId, v)}
                      trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                      thumbColor={on ? Colors.primary : "#f4f3f4"}
                    />
                  </View>
                );
              })
            )}

            <Text style={styles.sectionTitle}>Visit order (preview)</Text>
            <Text style={styles.sectionHint}>
              Ordered along your commute axis when home and work are set; otherwise nearest-neighbor.
            </Text>
            {orderedPreview.length === 0 ? (
              <Text style={styles.empty}>
                No pickups. Only the final destination will open in Maps.
              </Text>
            ) : (
              orderedPreview.map((p, i) => (
                <View key={p.userId} style={styles.orderRow}>
                  <Text style={styles.orderIdx}>{i + 1}</Text>
                  <Text style={styles.orderName} numberOfLines={2}>
                    {(p.fullName || "Crewmate").trim()}
                  </Text>
                </View>
              ))
            )}
            {geometry?.finalDestination && home && work ? (
              <View style={[styles.orderRow, styles.orderFinal]}>
                <Text style={styles.orderIdx}>★</Text>
                <Text style={styles.orderName}>
                  {geometry.leg === "to_work" ? "Workplace (destination)" : "Home (destination)"}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.primary, (busy || loadingTrip) && styles.primaryDisabled]}
            onPress={() => void onConfirmStart()}
            disabled={busy || loadingTrip}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>
                {resumeTrip ? "Resume in Google Maps" : "Open in Google Maps"}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
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
    paddingBottom: Spacing.xl,
    ...Shadow.lg,
  },
  grabRow: { alignItems: "center", paddingTop: Spacing.sm },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    flex: 1,
  },
  scroll: { maxHeight: 440 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  patternRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.xs },
  sticker: { fontSize: 28 },
  stickerImg: { width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.border },
  patternBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.lg,
  },
  patternBadgeText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  crewName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.md },
  resumeHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.md,
  },
  legRow: { marginBottom: Spacing.md },
  legLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text, marginBottom: Spacing.xs },
  legChips: { flexDirection: "row", gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  chipTextOn: { color: Colors.primaryDark },
  locCard: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: 4 },
  locBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  locWarn: { fontSize: FontSize.sm, color: Colors.warning ?? "#B45309", lineHeight: 20 },
  sectionTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  sectionHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 4,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  empty: { fontSize: FontSize.sm, color: Colors.textTertiary, fontStyle: "italic" },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  stopTextCol: { flex: 1, marginRight: Spacing.md },
  stopName: { fontSize: FontSize.base, color: Colors.text, fontWeight: FontWeight.medium },
  stopSub: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  orderRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: 6 },
  orderFinal: { marginTop: 4, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  orderIdx: { width: 28, fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.primary },
  orderName: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  primary: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
    alignItems: "center",
    ...Shadow.sm,
  },
  primaryDisabled: { opacity: 0.7 },
  primaryText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
});
