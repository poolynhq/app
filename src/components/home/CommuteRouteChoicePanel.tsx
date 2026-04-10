import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { showAlert } from "@/lib/platformAlert";
import { persistCommuteRouteVariantIndex } from "@/lib/commuteRouteStorage";
import {
  buildStaticCommuteMapUrl,
  fetchRouteInfo,
  mapboxTokenPresent,
  type RouteInfo,
} from "@/lib/mapboxCommutePreview";
import { CommuteRouteInteractiveMap } from "@/components/home/CommuteRouteInteractiveMap";
import type { User } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const VARIANT_KEY = "poolyn_commute_route_variant_idx_v1";

const ROUTE_HELP_TITLE = "Your commute line";
const ROUTE_HELP_BODY =
  "We save the line you pick for matching and for crews you create later. Crews you already formed keep the line from the day they started. Refresh if your usual times change.";

const MAP_PREVIEW_H = 200;

type Props = {
  userId: string;
  profile: Pick<User, "home_location" | "work_location">;
  /** True when user may form a crew / refresh matching (commute route chosen or not required). */
  onRouteReadyChange: (ready: boolean) => void;
  /** Opens Profile commute editor (home & work pins). */
  onEditCommutePins: () => void;
  /** When true, no outer card chrome (parent supplies the shell). */
  omitOuterCard?: boolean;
};

export function CommuteRouteChoicePanel({
  userId,
  profile,
  onRouteReadyChange,
  onEditCommutePins,
  omitOuterCard = false,
}: Props) {
  const home = useMemo(() => parseGeoPoint(profile.home_location as unknown), [profile.home_location]);
  const work = useMemo(() => parseGeoPoint(profile.work_location as unknown), [profile.work_location]);

  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [persisting, setPersisting] = useState(false);

  const previewUrl = useMemo(() => {
    if (!home || !work || !mapboxTokenPresent()) return null;
    if (!routeInfo) return null;
    const n = 1 + routeInfo.alternates.length;
    const hi =
      selectedIndex != null && selectedIndex >= 0 && selectedIndex < n ? selectedIndex : 0;
    return buildStaticCommuteMapUrl(home, work, routeInfo, "600x240@2x", hi);
  }, [home, work, routeInfo, selectedIndex]);

  const useInteractivePreview =
    Platform.OS !== "web" && mapboxTokenPresent() && home && work;

  const routeOptions = useMemo(() => {
    if (!routeInfo) return [];
    return [routeInfo.primary, ...routeInfo.alternates].filter((r) => r.coords?.length >= 2);
  }, [routeInfo]);

  const runInit = useCallback(async () => {
    if (!userId) {
      onRouteReadyChange(false);
      setLoading(false);
      return;
    }
    if (!home || !work) {
      onRouteReadyChange(false);
      setLoading(false);
      setRouteInfo(null);
      setSelectedIndex(null);
      return;
    }
    if (!mapboxTokenPresent()) {
      onRouteReadyChange(true);
      setLoading(false);
      setRouteInfo(null);
      setSelectedIndex(null);
      return;
    }

    setLoading(true);
    try {
      const { data: row } = await supabase
        .from("commute_routes")
        .select("id")
        .eq("user_id", userId)
        .eq("direction", "to_work")
        .maybeSingle();

      const ri = await fetchRouteInfo(home, work);
      setRouteInfo(ri);

      if (!ri) {
        setSelectedIndex(null);
        onRouteReadyChange(Boolean(row));
        return;
      }

      const savedRaw = await AsyncStorage.getItem(VARIANT_KEY);
      const saved = savedRaw != null ? parseInt(savedRaw, 10) : NaN;

      if (Number.isFinite(saved) && saved >= 0 && saved <= 2) {
        setSelectedIndex(saved);
        onRouteReadyChange(true);
      } else if (row) {
        setSelectedIndex(0);
        onRouteReadyChange(true);
      } else {
        setSelectedIndex(null);
        onRouteReadyChange(false);
      }
    } finally {
      setLoading(false);
    }
  }, [home, work, userId, onRouteReadyChange]);

  useEffect(() => {
    void runInit();
  }, [runInit]);

  async function onSelectVariant(idx: number) {
    if (!home || !work || persisting) return;
    const prevIdx = selectedIndex;
    setSelectedIndex(idx);
    onRouteReadyChange(true);
    setPersisting(true);
    try {
      const p = await persistCommuteRouteVariantIndex(userId, home, work, idx);
      if (!p.ok) {
        setSelectedIndex(prevIdx);
        showAlert("Route", p.error ?? "Could not save this option.");
        return;
      }
      await AsyncStorage.setItem(VARIANT_KEY, String(idx));
    } finally {
      setPersisting(false);
    }
  }

  async function onRefresh() {
    if (!home || !work || refreshing) return;
    setRefreshing(true);
    try {
      const ri = await fetchRouteInfo(home, work);
      setRouteInfo(ri);
      const nOpts = ri ? 1 + ri.alternates.length : 0;
      if (selectedIndex != null && nOpts > 0) {
        const clamped = Math.min(selectedIndex, nOpts - 1);
        setSelectedIndex(clamped);
        const p = await persistCommuteRouteVariantIndex(userId, home, work, clamped);
        if (p.ok) {
          await AsyncStorage.setItem(VARIANT_KEY, String(clamped));
        }
      }
    } finally {
      setRefreshing(false);
    }
  }

  const editLocationsBtn = (
    <Pressable style={styles.editPinsBtn} onPress={onEditCommutePins} hitSlop={8}>
      <Ionicons name="location-outline" size={18} color={Colors.primaryDark} />
      <Text style={styles.editPinsBtnText}>Change home &amp; work</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
    </Pressable>
  );

  const shell = omitOuterCard ? styles.cardEmbedded : styles.card;

  if (!home || !work) {
    return (
      <View style={shell}>
        <Text style={styles.eyebrow}>Regular commute</Text>
        <Text style={styles.bodyMuted}>
          Set home and work to preview driving routes and pick the line you usually take.
        </Text>
        {editLocationsBtn}
      </View>
    );
  }

  if (!mapboxTokenPresent()) {
    return (
      <View style={shell}>
        <Text style={styles.eyebrow}>Regular commute</Text>
        <Text style={styles.bodyMuted}>
          Add a routing token in app settings to preview lines here. Your pins still work for matching.
        </Text>
        {editLocationsBtn}
      </View>
    );
  }

  return (
    <View style={shell}>
      <View style={styles.cardTopRow}>
        <Text style={styles.panelTitle}>Driving route</Text>
        {editLocationsBtn}
      </View>
      <View style={styles.hintRow}>
        <Text style={styles.subShort}>
          Pick your usual line. First chip is primary; others are alternates.
        </Text>
        <Pressable
          onPress={() => showAlert(ROUTE_HELP_TITLE, ROUTE_HELP_BODY)}
          hitSlop={10}
          accessibilityLabel="More about saved commute route"
        >
          <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.bodyMuted}>Loading route options…</Text>
        </View>
      ) : (
        <>
          {useInteractivePreview ? (
            <CommuteRouteInteractiveMap
              key={`${selectedIndex ?? 0}-${routeOptions.length}-${previewUrl ?? ""}`}
              home={home}
              work={work}
              routeInfo={routeInfo}
              highlightIndex={selectedIndex ?? 0}
              height={MAP_PREVIEW_H}
            />
          ) : previewUrl ? (
            <Image source={{ uri: previewUrl }} style={styles.map} resizeMode="cover" />
          ) : (
            <View style={styles.mapPh}>
              <Ionicons name="map-outline" size={28} color={Colors.textTertiary} />
              <Text style={styles.bodyMuted}>No driving routes returned — check pins or try again.</Text>
            </View>
          )}

          <Text style={styles.chipsLabel}>
            {routeOptions.length > 1 ? "Pick your usual route" : "Route"}
          </Text>
          <View style={styles.chipRow}>
            {routeOptions.map((r, idx) => {
              const on = selectedIndex === idx;
              const roleLabel =
                routeOptions.length <= 1
                  ? "Your saved line"
                  : idx === 0
                    ? "Usual"
                    : idx === 1
                      ? "Alternate A"
                      : "Alternate B";
              return (
                <Pressable
                  key={idx}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => void onSelectVariant(idx)}
                  disabled={persisting}
                >
                  <Text style={[styles.chipTitle, on && styles.chipTitleOn]}>
                    {r.distanceKm.toFixed(1)} km · ~{Math.round(r.durationMin)} min
                  </Text>
                  <Text style={[styles.chipMeta, on && styles.chipMetaOn]}>{roleLabel}</Text>
                </Pressable>
              );
            })}
          </View>

          {routeOptions.length === 0 && !loading ? (
            <Text style={styles.bodyMuted}>
              No extra routes right now. Try Refresh or check pins with Change home &amp; work.
            </Text>
          ) : null}

          {selectedIndex == null && routeOptions.length > 0 ? (
            <Text style={styles.warn}>Tap a route to save it for matching and new crews.</Text>
          ) : null}

          <Pressable
            style={[styles.refreshBtn, (refreshing || persisting) && styles.btnDisabled]}
            onPress={() => void onRefresh()}
            disabled={refreshing || persisting}
          >
            {refreshing ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <>
                <Ionicons name="refresh" size={18} color={Colors.primary} />
                <Text style={styles.refreshText}>Refresh routes</Text>
              </>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  cardEmbedded: {
    backgroundColor: "transparent",
    padding: 0,
    marginBottom: 0,
    borderWidth: 0,
    borderRadius: 0,
    ...Platform.select({
      ios: { shadowOpacity: 0 },
      android: { elevation: 0 },
      default: {},
    }),
  },
  cardTopRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  panelTitle: {
    flex: 1,
    minWidth: 120,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  eyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    flexShrink: 0,
  },
  editPinsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  editPinsBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
    maxWidth: 140,
  },
  bodyMuted: { fontSize: FontSize.sm, color: Colors.textTertiary, lineHeight: 20 },
  loader: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  hintRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  subShort: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  map: {
    width: "100%",
    height: MAP_PREVIEW_H,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.borderLight,
    marginBottom: Spacing.sm,
  },
  mapPh: {
    minHeight: MAP_PREVIEW_H,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  chipsLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    flexGrow: 1,
    minWidth: "28%",
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  chipTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  chipTitleOn: { color: Colors.primaryDark },
  chipMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  chipMetaOn: { color: Colors.primaryDark },
  warn: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: "#92400E",
    marginTop: Spacing.sm,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: Spacing.md,
    paddingVertical: 10,
  },
  refreshText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
  btnDisabled: { opacity: 0.65 },
});
