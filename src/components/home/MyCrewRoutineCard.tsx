import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  deleteCrewAsOwner,
  fetchCrewMemberHomePins,
  fetchCrewRoster,
  fetchPendingCrewInvitees,
  getOrCreateTripInstance,
  isCrewOwner,
  type CrewListRow,
  type CrewMemberMapPin,
  type CrewRosterMember,
  type PendingCrewInvitee,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import {
  buildCrewMemberPinsMapUrl,
  buildCrewRoutineOverviewMapUrl,
  fetchRouteInfo,
  mapboxTokenPresent,
} from "@/lib/mapboxCommutePreview";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { showAlert } from "@/lib/platformAlert";
import { openGoogleWebCrewPickupRoute, presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import type { User } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

type ProfilePins = Pick<User, "home_location" | "work_location">;

type Props = {
  userId: string;
  crew: CrewListRow;
  memberCount: number;
  /** Pending in-app invites (not yet in roster until they accept). */
  pendingInviteCount: number;
  profilePins: ProfilePins;
  onRefresh?: () => void;
  onCrewDeleted?: () => void;
};

/** Nearest-neighbor order from a start point (good enough for carpool pickups). */
function orderPickupsGreedy(
  origin: { lat: number; lng: number },
  pins: CrewMemberMapPin[]
): CrewMemberMapPin[] {
  const remaining = [...pins];
  const ordered: CrewMemberMapPin[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = distanceMeters(current, { lat: remaining[0].lat, lng: remaining[0].lng });
    for (let i = 1; i < remaining.length; i++) {
      const d = distanceMeters(current, { lat: remaining[i].lat, lng: remaining[i].lng });
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }
  return ordered;
}

function mergeMemberAndPendingPins(
  memberPins: CrewMemberMapPin[],
  pending: PendingCrewInvitee[]
): CrewMemberMapPin[] {
  const byUser = new Map<string, CrewMemberMapPin>();
  for (const p of memberPins) byUser.set(p.userId, p);
  for (const inv of pending) {
    if (inv.lat == null || inv.lng == null) continue;
    if (byUser.has(inv.userId)) continue;
    byUser.set(inv.userId, {
      userId: inv.userId,
      fullName: inv.fullName,
      lat: inv.lat,
      lng: inv.lng,
    });
  }
  return [...byUser.values()];
}

export function MyCrewRoutineCard({
  userId,
  crew,
  memberCount,
  pendingInviteCount,
  profilePins,
  onRefresh,
  onCrewDeleted,
}: Props) {
  const router = useRouter();
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [roster, setRoster] = useState<CrewRosterMember[]>([]);
  const [pendingInvitees, setPendingInvitees] = useState<PendingCrewInvitee[]>([]);
  const [crewPinsForNav, setCrewPinsForNav] = useState<CrewMemberMapPin[]>([]);
  const [owner, setOwner] = useState(false);
  const [tripStartBusy, setTripStartBusy] = useState(false);

  useEffect(() => {
    void isCrewOwner(crew.id, userId).then(setOwner);
  }, [crew.id, userId]);

  const loadMapAndRoster = useCallback(async () => {
    setLoadingMap(true);
    const [pinsMember, rosterRows, pending] = await Promise.all([
      fetchCrewMemberHomePins(crew.id),
      fetchCrewRoster(crew.id),
      fetchPendingCrewInvitees(crew.id),
    ]);
    setRoster(rosterRows);
    setPendingInvitees(pending);
    const pins = mergeMemberAndPendingPins(pinsMember, pending);
    setCrewPinsForNav(pins);

    if (!mapboxTokenPresent()) {
      setMapUrl(null);
      setLoadingMap(false);
      return;
    }

    const home = parseGeoPoint(profilePins.home_location as unknown);
    const work = parseGeoPoint(profilePins.work_location as unknown);

    let url: string | null = null;
    if (home && work) {
      const routeInfo = await fetchRouteInfo(home, work);
      const others = pins.filter(
        (p) => p.userId !== userId && distanceMeters({ lat: p.lat, lng: p.lng }, home) > 120
      );
      url = buildCrewRoutineOverviewMapUrl(home, work, routeInfo, others.map((o) => ({ lat: o.lat, lng: o.lng })));
    } else if (pins.length > 0) {
      url = buildCrewMemberPinsMapUrl(pins.map((p) => ({ lat: p.lat, lng: p.lng })));
    }
    setMapUrl(url);
    setLoadingMap(false);
  }, [crew.id, profilePins.home_location, profilePins.work_location, userId]);

  useEffect(() => {
    void loadMapAndRoster();
  }, [loadMapAndRoster]);

  async function onTripStart() {
    const others = crewPinsForNav.filter((p) => p.userId !== userId);
    if (others.length === 0) {
      showAlert(
        "No crew pickup pins",
        "Add crewmates with a saved home pin (Profile → Commute). Then Trip start can pick who is closest to you."
      );
      return;
    }

    setTripStartBusy(true);
    try {
      let origin: { lat: number; lng: number } | null = null;
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === Location.PermissionStatus.GRANTED) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      }
      if (!origin) {
        const h = parseGeoPoint(profilePins.home_location as unknown);
        if (h) origin = h;
      }
      if (!origin) {
        showAlert(
          "Need a starting point",
          "Allow location for Poolyn in your browser or phone settings, or set your home pin under Profile → Commute."
        );
        return;
      }

      const ordered = orderPickupsGreedy(origin, others);
      const work = parseGeoPoint(profilePins.work_location as unknown);

      if (Platform.OS === "web") {
        const meta = openGoogleWebCrewPickupRoute(
          ordered.map((p) => ({ lat: p.lat, lng: p.lng })),
          work
        );
        if (meta.truncated) {
          showAlert(
            "Part of the crew is not in this Maps link",
            `Google Maps only fits so many stops in one trip. This opened the first ${meta.usedCount} of ${meta.totalCount} pickups (then work). Use Pickup order below to open directions for anyone left.`,
            [{ text: "OK" }]
          );
        }
        return;
      }

      const first = ordered[0];
      const firstName = (first.fullName || "First pickup").trim();
      presentDrivingNavigationPicker(first.lat, first.lng);
      if (ordered.length > 1 || work) {
        showAlert(
          "After each pickup",
          ordered.length > 1
            ? `You’re heading to ${firstName} first. When you arrive, finish the stop in your maps app if it asks, then use Pickup order on this screen to open the next person${work ? ", and finally Maps → workplace" : ""}.`
            : work
              ? `When you’re done at ${firstName}, open the Navigate tab → To workplace, or use the workplace row under Pickup order.`
              : "When you arrive, you’re done with this chain unless you add more stops yourself in Maps.",
          [{ text: "OK" }]
        );
      }
    } finally {
      setTripStartBusy(false);
    }
  }

  async function openTodaysChat() {
    setOpening(true);
    try {
      const inst = await getOrCreateTripInstance(crew.id, localDateKey());
      if (!inst.ok) {
        showAlert("Could not open chat", inst.reason);
        return;
      }
      router.push({
        pathname: "/(tabs)/profile/crew-chat/[tripInstanceId]",
        params: { tripInstanceId: inst.row.id },
      });
    } finally {
      setOpening(false);
    }
  }

  function promptDeleteCrew() {
    showAlert(
      "Delete this crew?",
      "Everyone loses access. Members, day chat threads, and pending invites are removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "default",
          onPress: () => {
            showAlert(
              "Delete crew permanently?",
              "You are about to delete this crew for all members. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete crew",
                  style: "destructive",
                  onPress: () => void runDeleteCrew(),
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function runDeleteCrew() {
    setDeleting(true);
    const r = await deleteCrewAsOwner(crew.id);
    setDeleting(false);
    if (!r.ok) {
      showAlert("Could not delete crew", r.reason);
      return;
    }
    onCrewDeleted?.();
  }

  const othersPins = useMemo(
    () => crewPinsForNav.filter((p) => p.userId !== userId),
    [crewPinsForNav, userId]
  );

  const workPt = parseGeoPoint(profilePins.work_location as unknown);

  const orderedLegsPreview = useMemo(() => {
    if (othersPins.length === 0) return [];
    const home = parseGeoPoint(profilePins.home_location as unknown);
    if (home) return orderPickupsGreedy(home, othersPins);
    let lat = 0;
    let lng = 0;
    for (const p of othersPins) {
      lat += p.lat;
      lng += p.lng;
    }
    const n = othersPins.length;
    const centroid = { lat: lat / n, lng: lng / n };
    return orderPickupsGreedy(centroid, othersPins);
  }, [othersPins, profilePins.home_location]);

  const invitedShown = Math.max(pendingInviteCount, pendingInvitees.length);
  const metaParts: string[] = [
    `${memberCount} in crew`,
    ...(invitedShown > 0 ? [`${invitedShown} invited`] : []),
    `code ${crew.invite_code}`,
  ];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.crewLabel}>Your crew</Text>
          <Text style={styles.crewName} numberOfLines={2}>
            {crew.name}
          </Text>
          <Text style={styles.meta}>{metaParts.join(" · ")}</Text>
        </View>
        <Pressable
          style={styles.manageBtn}
          onPress={() => router.push("/(tabs)/profile/crews")}
          hitSlop={8}
        >
          <Text style={styles.manageBtnText}>Manage</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </Pressable>
      </View>

      {roster.length > 0 || pendingInvitees.length > 0 ? (
        <View style={styles.membersBlock}>
          {roster.length > 0 ? (
            <>
              <Text style={styles.membersLabel}>In this crew</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberChips}>
                {roster.map((m) => (
                  <View key={m.userId} style={styles.memberChip}>
                    <Ionicons name="person" size={14} color={Colors.primaryDark} />
                    <Text style={styles.memberChipText} numberOfLines={1}>
                      {(m.fullName || "Member").trim()}
                      {m.userId === userId ? " (you)" : ""}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}
          {pendingInvitees.length > 0 ? (
            <>
              <Text style={[styles.membersLabel, styles.invitedLabel]}>Invited (pending)</Text>
              <Text style={styles.invitedHint}>
                They appear here after you invite them in-app; they join the roster when they accept or use the code.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberChips}>
                {pendingInvitees.map((p) => (
                  <View key={p.userId} style={[styles.memberChip, styles.memberChipPending]}>
                    <Ionicons name="mail-outline" size={14} color={Colors.textSecondary} />
                    <Text style={[styles.memberChipText, styles.memberChipTextMuted]} numberOfLines={1}>
                      {(p.fullName || "Invited").trim()}
                      {p.userId === userId ? " (you)" : ""}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.hint}>
        Green/red pins: your saved home and work with your commute route (when Mapbox can route). Smaller pins:
        other members&apos; and invited people&apos;s home areas (when they&apos;ve saved a home pin). Open chat to
        pick today&apos;s driver pool and roll dice.
      </Text>

      <View style={styles.mapWrap}>
        {loadingMap ? (
          <ActivityIndicator color={Colors.primary} style={styles.mapLoader} />
        ) : mapUrl ? (
          <Image source={{ uri: mapUrl }} style={styles.mapImg} resizeMode="cover" />
        ) : (
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={32} color={Colors.textTertiary} />
            <Text style={styles.mapPhText}>
              {mapboxTokenPresent()
                ? "Set home and work in Profile → Commute to see your route here, or wait for members to save home pins."
                : "Add a Mapbox token to preview the map."}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryBtn, opening && styles.btnDisabled]}
          onPress={() => void openTodaysChat()}
          disabled={opening}
        >
          {opening ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="chatbubbles" size={20} color="#fff" />
              <Text style={styles.primaryBtnText}>Group chat &amp; driver</Text>
            </>
          )}
        </Pressable>
        <Pressable
          style={[styles.tripStartBtn, tripStartBusy && styles.btnDisabled]}
          onPress={() => void onTripStart()}
          disabled={tripStartBusy}
        >
          {tripStartBusy ? (
            <ActivityIndicator color={Colors.primaryDark} />
          ) : (
            <>
              <Ionicons name="car-sport" size={20} color={Colors.primaryDark} />
              <View style={styles.tripStartTextCol}>
                <Text style={styles.tripStartBtnTitle}>Trip start</Text>
                <Text style={styles.tripStartBtnSub}>
                  Orders every crew pickup (nearest-first from GPS or home). Web/PWA opens one Google Maps trip with
                  those stops, then work. The list below is for the next leg or the phone app.
                </Text>
              </View>
            </>
          )}
        </Pressable>

        {orderedLegsPreview.length > 0 ? (
          <View style={styles.legsBlock}>
            <Text style={styles.legsTitle}>Pickup order &amp; legs</Text>
            <Text style={styles.legsExplainer}>
              Poolyn cannot see when you arrive — only your maps app does. In Google Maps with several stops, finish
              or confirm each pickup; the app normally advances to the next stop, then your workplace. If it does not,
              open the next row here. Use Group chat to coordinate “outside / running late.”
            </Text>
            {orderedLegsPreview.map((p, i) => (
              <View key={p.userId} style={styles.legRow}>
                <Text style={styles.legIdx}>{i + 1}</Text>
                <Text style={styles.legName} numberOfLines={2}>
                  {(p.fullName || "Crewmate").trim()}
                </Text>
                <Pressable
                  style={styles.legNavBtn}
                  onPress={() => presentDrivingNavigationPicker(p.lat, p.lng)}
                  hitSlop={6}
                >
                  <Ionicons name="navigate" size={16} color={Colors.primary} />
                  <Text style={styles.legNavBtnText}>Maps</Text>
                </Pressable>
              </View>
            ))}
            {workPt ? (
              <View style={[styles.legRow, styles.legRowFinal]}>
                <Text style={styles.legIdx}>★</Text>
                <Text style={styles.legName} numberOfLines={2}>
                  Workplace (after pickups)
                </Text>
                <Pressable
                  style={styles.legNavBtn}
                  onPress={() => presentDrivingNavigationPicker(workPt.lat, workPt.lng)}
                  hitSlop={6}
                >
                  <Ionicons name="navigate" size={16} color={Colors.primary} />
                  <Text style={styles.legNavBtnText}>Maps</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <Pressable
          style={styles.secondaryBtn}
          onPress={() => void loadMapAndRoster().then(() => onRefresh?.())}
        >
          <Ionicons name="refresh" size={18} color={Colors.primary} />
          <Text style={styles.secondaryBtnText}>Refresh map</Text>
        </Pressable>
        {owner ? (
          <Pressable
            style={[styles.deleteCrewBtn, deleting && styles.btnDisabled]}
            onPress={() => promptDeleteCrew()}
            disabled={deleting}
            hitSlop={8}
          >
            {deleting ? (
              <ActivityIndicator color={Colors.error} size="small" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color={Colors.error} />
                <Text style={styles.deleteCrewBtnText}>Delete crew</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F0FDF4",
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.2)",
    ...Shadow.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  titleBlock: { flex: 1 },
  crewLabel: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  crewName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  meta: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  manageBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  manageBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  membersBlock: { marginBottom: Spacing.sm },
  membersLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  memberChips: { flexDirection: "row", gap: Spacing.sm, paddingVertical: 2 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 200,
  },
  memberChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.text, flexShrink: 1 },
  invitedLabel: { marginTop: Spacing.sm },
  invitedHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 16,
    marginBottom: Spacing.xs,
  },
  memberChipPending: {
    backgroundColor: Colors.background,
    borderStyle: "dashed",
  },
  memberChipTextMuted: { color: Colors.textSecondary },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  mapWrap: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    backgroundColor: Colors.borderLight,
    minHeight: 180,
  },
  mapImg: { width: "100%", height: 180 },
  mapLoader: { paddingVertical: 56 },
  mapPlaceholder: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  mapPhText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: "center",
  },
  actions: { marginTop: Spacing.md, gap: Spacing.sm },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
  },
  btnDisabled: { opacity: 0.75 },
  primaryBtnText: {
    color: "#fff",
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  tripStartBtn: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: "#fff",
  },
  tripStartTextCol: { flex: 1, minWidth: 0 },
  tripStartBtnTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
  },
  tripStartBtnSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 4,
  },
  legsBlock: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.25)",
    backgroundColor: "rgba(255,255,255,0.7)",
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  legsTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  legsExplainer: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginBottom: Spacing.xs,
  },
  legRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  legRowFinal: { borderBottomWidth: 0, paddingTop: Spacing.xs },
  legIdx: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
    width: 22,
    textAlign: "center",
  },
  legName: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  legNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  legNavBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  deleteCrewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: Spacing.xs,
  },
  deleteCrewBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.error,
  },
});
