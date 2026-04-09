import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import {
  buildStaticCommuteMapUrl,
  fetchRouteInfo,
  mapboxTokenPresent,
  reverseGeocodeShort,
  type RouteInfo,
} from "@/lib/mapboxCommutePreview";
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

/** Illustrative one-way cash range from driving distance (not a quote). */
function estimateContributionRangeAud(distanceKm: number): { low: string; high: string } {
  const d = distanceKm;
  if (!Number.isFinite(d) || d <= 0) {
    return { low: "—", high: "—" };
  }
  const midAud = Math.min(0.95 + d * 0.135, 28);
  const low = Math.max(0.55, midAud * 0.68);
  const high = Math.min(midAud * 1.42, 42);
  return { low: low.toFixed(2), high: high.toFixed(2) };
}

type LocationRowSnapshot = {
  home_location: unknown;
  work_location: unknown;
  pickup_location: unknown;
  work_location_label: string | null;
};

export default function CommuteLocationsScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { profile, refreshProfile } = useAuth();
  const [savingPickup, setSavingPickup] = useState(false);
  const [locRow, setLocRow] = useState<LocationRowSnapshot | null>(null);

  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [fetchingRoute, setFetchingRoute] = useState(false);
  const [storedDistanceM, setStoredDistanceM] = useState<number | null>(null);
  const [storedDurationS, setStoredDurationS] = useState<number | null>(null);

  const [homeLabel, setHomeLabel] = useState<string | null>(null);
  const [workLabelGeo, setWorkLabelGeo] = useState<string | null>(null);
  const [pickupLabelGeo, setPickupLabelGeo] = useState<string | null>(null);

  const canRide = profile?.role === "passenger" || profile?.role === "both";

  useEffect(() => {
    if (!isFocused || !profile?.id) return;
    let cancelled = false;
    void (async () => {
      await refreshProfile();
      const { data, error } = await supabase
        .from("users")
        .select("home_location, work_location, pickup_location, work_location_label")
        .eq("id", profile.id)
        .maybeSingle();
      if (__DEV__) {
        if (error) console.warn("[commute-locations] location refetch:", error.message);
        else if (data) {
          const h = parseGeoPoint(data.home_location);
          const w = parseGeoPoint(data.work_location);
          const p = parseGeoPoint(data.pickup_location);
          console.warn("[commute-locations] parsed pins", {
            hasHomeRaw: data.home_location != null,
            hasWorkRaw: data.work_location != null,
            hasPickupRaw: data.pickup_location != null,
            homeParsed: Boolean(h),
            workParsed: Boolean(w),
            pickupParsed: Boolean(p),
          });
        }
      }
      if (!cancelled && data) setLocRow(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [isFocused, profile?.id, refreshProfile]);

  const homePt = useMemo(
    () => parseGeoPoint(locRow?.home_location ?? profile?.home_location),
    [locRow?.home_location, profile?.home_location]
  );
  const workPt = useMemo(
    () => parseGeoPoint(locRow?.work_location ?? profile?.work_location),
    [locRow?.work_location, profile?.work_location]
  );
  const pickupPt = useMemo(
    () => parseGeoPoint(locRow?.pickup_location ?? profile?.pickup_location),
    [locRow?.pickup_location, profile?.pickup_location]
  );

  /** Saved “from” point: home if present, else routine pickup pin (some profiles only store pickup + work). */
  const routineStartPt = useMemo(() => homePt ?? pickupPt, [homePt, pickupPt]);

  /** Max distance (m) where "today's pickup" still replaces home for the routine preview. Beyond → treat as stale. */
  const MAX_PICKUP_OVERRIDE_M = 50_000;

  /** True when pickup is a plausible same-day alternate start (not cross-city leftover GPS). */
  const nearPickupOverride = useMemo(() => {
    if (!pickupPt || !homePt) return false;
    const d = distanceMeters(homePt, pickupPt);
    return d > 80 && d <= MAX_PICKUP_OVERRIDE_M;
  }, [homePt, pickupPt]);

  /** Saved pickup exists but is far from home — do not use it for routing (e.g. old session in another city). */
  const staleRemotePickup = useMemo(() => {
    if (!pickupPt || !homePt) return false;
    return distanceMeters(homePt, pickupPt) > MAX_PICKUP_OVERRIDE_M;
  }, [homePt, pickupPt]);

  const tripStart = useMemo(() => {
    if (nearPickupOverride) return pickupPt;
    return routineStartPt;
  }, [nearPickupOverride, pickupPt, routineStartPt]);

  const hasCommute = Boolean(workPt && routineStartPt);

  useEffect(() => {
    if (!profile?.id || !hasCommute) {
      setStoredDistanceM(null);
      setStoredDurationS(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("commute_routes")
        .select("distance_m, duration_s")
        .eq("user_id", profile.id)
        .eq("direction", "to_work")
        .maybeSingle();
      if (cancelled || error) return;
      if (data) {
        setStoredDistanceM(data.distance_m);
        setStoredDurationS(data.duration_s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, hasCommute, workPt?.lat, workPt?.lng, routineStartPt?.lat, routineStartPt?.lng]);

  useEffect(() => {
    if (!tripStart || !workPt) {
      setRouteInfo(null);
      return;
    }
    let cancelled = false;
    setFetchingRoute(true);
    fetchRouteInfo(tripStart, workPt).then((info) => {
      if (!cancelled) {
        setRouteInfo(info);
        setFetchingRoute(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tripStart, workPt]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (homePt && mapboxTokenPresent()) {
        const h = await reverseGeocodeShort(homePt.lat, homePt.lng);
        if (!cancelled) setHomeLabel(h);
      } else {
        setHomeLabel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [homePt]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (workPt && mapboxTokenPresent()) {
        const w = await reverseGeocodeShort(workPt.lat, workPt.lng);
        if (!cancelled) setWorkLabelGeo(w);
      } else {
        setWorkLabelGeo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workPt]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (pickupPt && mapboxTokenPresent()) {
        const p = await reverseGeocodeShort(pickupPt.lat, pickupPt.lng);
        if (!cancelled) setPickupLabelGeo(p);
      } else {
        setPickupLabelGeo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickupPt]);

  const primaryKm =
    routeInfo?.primary.distanceKm ??
    (storedDistanceM != null ? storedDistanceM / 1000 : null);
  const primaryMin =
    routeInfo?.primary.durationMin ??
    (storedDurationS != null ? storedDurationS / 60 : null);

  const costRange =
    primaryKm != null && Number.isFinite(primaryKm)
      ? estimateContributionRangeAud(primaryKm)
      : null;

  const setPickupFromDevice = useCallback(async () => {
    if (!profile?.id) return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      showAlert(
        "Location needed",
        "Allow location access so we can use your current position as today’s pickup point."
      );
      return;
    }
    setSavingPickup(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lng = pos.coords.longitude;
      const lat = pos.coords.latitude;
      const wkt = `POINT(${lng} ${lat})`;
      const { error } = await supabase.from("users").update({ pickup_location: wkt }).eq("id", profile.id);
      if (error) {
        showAlert("Could not save", error.message);
        return;
      }
      setLocRow((prev) => (prev ? { ...prev, pickup_location: wkt } : prev));
      await refreshProfile();
      showAlert("Pickup updated", "Matching will use this spot as your pickup origin until you clear it.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read GPS position.";
      showAlert("Location error", msg);
    } finally {
      setSavingPickup(false);
    }
  }, [profile?.id, refreshProfile]);

  const clearAlternatePickup = useCallback(async () => {
    if (!profile?.id) return;
    setSavingPickup(true);
    try {
      const { error } = await supabase.from("users").update({ pickup_location: null }).eq("id", profile.id);
      if (error) {
        showAlert("Could not clear", error.message);
        return;
      }
      setLocRow((prev) => (prev ? { ...prev, pickup_location: null } : prev));
      await refreshProfile();
    } finally {
      setSavingPickup(false);
    }
  }, [profile?.id, refreshProfile]);

  // Prefer reverse-geocode of the saved pin so the title matches the map (avoids stale org/campus text).
  const workTitle =
    workLabelGeo?.trim() ||
    locRow?.work_location_label?.trim() ||
    profile?.work_location_label?.trim() ||
    (workPt ? "Saved workplace pin" : "");

  const startTitle = nearPickupOverride
    ? pickupLabelGeo || "Today’s pickup pin"
    : homePt
      ? homeLabel || "Saved home area"
      : pickupLabelGeo || "Saved trip start";

  const startLegendShort = nearPickupOverride ? "Pickup" : homePt ? "Home" : "Start";

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Your routine commute is used to match you with people on a similar corridor. Pickup overrides apply
          only for riders when you are not starting from home today.
        </Text>

        {!hasCommute ? (
          <View style={styles.emptyCard}>
            <Ionicons name="map-outline" size={36} color={Colors.primary} />
            <Text style={styles.emptyTitle}>Set your commute</Text>
            <Text style={styles.emptyBody}>
              Add your home and workplace pins so we can show your route and match you accurately.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/(onboarding)/location?fromProfile=1")}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Add locations</Text>
              <Ionicons name="arrow-forward" size={18} color={Colors.textOnPrimary} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryEyebrow}>Trip start</Text>
              <Text style={styles.summaryLine} numberOfLines={3}>
                {startTitle}
              </Text>
              {staleRemotePickup ? (
                <View style={styles.stalePickupBanner}>
                  <Text style={styles.stalePickupText}>
                    A saved “today’s pickup” pin is very far from your home and is ignored for this route. Clear
                    it so it does not confuse matching, or save home &amp; work again from Edit locations.
                  </Text>
                  <TouchableOpacity
                    style={styles.stalePickupBtn}
                    onPress={() => void clearAlternatePickup()}
                    disabled={savingPickup}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.stalePickupBtnText}>Clear saved pickup</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {nearPickupOverride ? (
                <Text style={styles.summaryHint}>Using today’s pickup instead of saved home.</Text>
              ) : !homePt && pickupPt ? (
                <Text style={styles.summaryHint}>
                  Trip start is your saved pickup pin. Use Edit locations to add a separate home pin if you
                  want both.
                </Text>
              ) : null}

              <Text style={[styles.summaryEyebrow, { marginTop: Spacing.md }]}>Destination</Text>
              <Text style={styles.summaryLine} numberOfLines={3}>
                {workTitle}
              </Text>

              {mapboxTokenPresent() && tripStart && workPt ? (
                <View style={styles.mapBlock}>
                  <Image
                    source={{ uri: buildStaticCommuteMapUrl(tripStart, workPt, routeInfo) }}
                    style={styles.mapImage}
                    resizeMode="cover"
                  />
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
                      <Text style={styles.legendText}>{startLegendShort}</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={12} color={Colors.textTertiary} />
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: "#E74C3C" }]} />
                      <Text style={styles.legendText}>Work</Text>
                    </View>
                    {routeInfo && routeInfo.alternates.length > 0 ? (
                      <View style={styles.altBadge}>
                        <Text style={styles.altBadgeText}>
                          +{routeInfo.alternates.length} alt{" "}
                          {routeInfo.alternates.length === 1 ? "route" : "routes"}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {fetchingRoute ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: Spacing.sm }} />
                  ) : primaryKm != null && primaryMin != null ? (
                    <>
                      <Text style={styles.statsMain}>
                        {primaryKm.toFixed(1)} km ·{" "}
                        {primaryMin < 60
                          ? `~${Math.round(primaryMin)} min drive`
                          : `~${Math.floor(primaryMin / 60)}h ${Math.round(primaryMin % 60)}m drive`}
                      </Text>
                      {routeInfo ? (
                        <Text style={styles.statsLight}>
                          Primary route is the shortest distance Mapbox returned; alts may be faster in traffic.
                        </Text>
                      ) : null}
                      {routeInfo?.alternates.map((alt, i) => (
                        <Text key={i} style={styles.statsAlt}>
                          Alt {i + 1}: {alt.distanceKm.toFixed(1)} km ·{" "}
                          {alt.durationMin < 60
                            ? `~${Math.round(alt.durationMin)} min`
                            : `~${Math.floor(alt.durationMin / 60)}h ${Math.round(alt.durationMin % 60)}m`}
                        </Text>
                      ))}
                    </>
                  ) : (
                    <Text style={styles.statsLight}>Could not load drive times. Try again later.</Text>
                  )}

                  {costRange ? (
                    <View style={styles.costBox}>
                      <Text style={styles.costLabel}>Approx. passenger contribution (one way)</Text>
                      <Text style={styles.costValue}>
                        ${costRange.low} – ${costRange.high} AUD
                      </Text>
                      <Text style={styles.costDisclaimer}>
                        Indicative only — actual shared-ride pricing depends on your network, trip, and driver.
                        Organisation members may have different fees.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.statsLight}>Add a Mapbox token to preview your route on the map.</Text>
              )}

              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => router.push("/(onboarding)/location?fromProfile=1")}
                activeOpacity={0.85}
              >
                <Ionicons name="create-outline" size={20} color={Colors.primary} />
                <Text style={styles.editBtnText}>Edit locations</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {canRide ? (
          <View style={styles.pickupCard}>
            <View style={styles.pickupHeader}>
              <Ionicons name="navigate-outline" size={22} color={Colors.info} />
              <Text style={styles.pickupTitle}>Today’s pickup (riders)</Text>
            </View>
            <Text style={styles.pickupBody}>
              If you are not starting from home, set a one-time pickup from your phone’s location. We only
              use it for matching; clear it when you are back to your usual start.
            </Text>
            <Text style={styles.pickupStatus}>
              {staleRemotePickup
                ? "Saved pickup is far from home — not used for your routine route until you clear it."
                : nearPickupOverride
                  ? "Using alternate pickup (not your saved home pin)."
                  : homePt
                    ? "Using saved home as pickup."
                    : pickupPt
                      ? "Trip start uses your saved pickup pin (no separate home on file)."
                      : "Set a trip start in Edit locations to enable pickup overrides."}
            </Text>
            <TouchableOpacity
              style={[styles.pickupBtn, savingPickup && styles.pickupBtnDisabled]}
              onPress={setPickupFromDevice}
              disabled={savingPickup}
              activeOpacity={0.85}
            >
              {savingPickup ? (
                <ActivityIndicator color={Colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons name="locate-outline" size={20} color={Colors.textOnPrimary} />
                  <Text style={styles.pickupBtnText}>Use current location as pickup</Text>
                </>
              )}
            </TouchableOpacity>
            {nearPickupOverride || staleRemotePickup ? (
              <TouchableOpacity style={styles.clearBtn} onPress={clearAlternatePickup} disabled={savingPickup}>
                <Text style={styles.clearBtnText}>Clear — use home location</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing["4xl"],
  },
  lead: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
  primaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  summaryEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  summaryLine: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: Colors.text,
    lineHeight: 22,
  },
  summaryHint: {
    fontSize: FontSize.xs,
    color: Colors.info,
    marginTop: 4,
  },
  stalePickupBanner: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.sm,
  },
  stalePickupText: {
    fontSize: FontSize.xs,
    color: Colors.text,
    lineHeight: 18,
  },
  stalePickupBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  stalePickupBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  mapBlock: { marginTop: Spacing.md },
  mapImage: {
    width: "100%",
    height: 200,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.borderLight,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  altBadge: {
    marginLeft: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryLight,
  },
  altBadgeText: { fontSize: 10, fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  statsMain: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  statsAlt: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  statsLight: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
  },
  costBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  costLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
    marginBottom: 4,
  },
  costValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  costDisclaimer: {
    fontSize: 10,
    color: Colors.textSecondary,
    lineHeight: 15,
    marginTop: Spacing.sm,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  editBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  pickupCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  pickupHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  pickupTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  pickupBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  pickupStatus: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.primary,
    marginBottom: Spacing.md,
  },
  pickupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
  },
  pickupBtnDisabled: { opacity: 0.7 },
  pickupBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  clearBtn: { marginTop: Spacing.md, alignItems: "center", padding: Spacing.sm },
  clearBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.info },
});
