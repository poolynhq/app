import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { useDiscoverViewerLayers } from "@/hooks/useDiscoverViewerLayers";
import { DiscoverMapLayers } from "@/components/maps/DiscoverMapLayers";
import { resolveAvatarDisplayUrl } from "@/lib/avatarStorage";
import {
  buildRoutePeopleDemandPointsGeoJson,
  homeWorkFallbackLine,
  primaryCommuteLineCoords,
} from "@/lib/routePeopleCorridorHeatmap";
import {
  detourMinutesToSearchRadiusM,
  maxDetourMinutesFromRoute,
} from "@/lib/routePeopleDetourSearch";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

export type RoutePeopleRow = {
  user_id: string;
  full_name: string | null;
  user_role: string;
  org_id: string | null;
  org_name: string | null;
  org_logo_path: string | null;
  avatar_url?: string | null;
  distance_m: number;
  pin_kind: string;
  /** Same commute pin used for distance (home, or work if home missing). From server after migration 0112. */
  pin_lng?: number | null;
  pin_lat?: number | null;
};

type PoolScope = "team" | "open";
type SortMode = "nearest" | "farthest";

const EMPTY_MAP_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Workplace allows seeing other companies on corridor. */
  orgAllowsOpenLane: boolean;
  viewerHasOrg: boolean;
};

function orgLogoPublicUrl(logoPath: string | null | undefined): string | null {
  const p = String(logoPath ?? "").trim();
  if (!p) return null;
  return supabase.storage.from("org-logos").getPublicUrl(p).data.publicUrl ?? null;
}

type DemandCircleTapMsg = {
  type?: string;
  user_id?: string;
  full_name?: string;
  org_name?: string;
};

function routePersonFromMapTap(people: RoutePeopleRow[], msg: DemandCircleTapMsg): RoutePeopleRow | null {
  const uid = typeof msg.user_id === "string" ? msg.user_id.trim() : "";
  if (!uid) return null;
  const existing = people.find((p) => p.user_id === uid);
  if (existing) return existing;
  const fn = typeof msg.full_name === "string" ? msg.full_name.trim() : "";
  const org = typeof msg.org_name === "string" ? msg.org_name.trim() : "";
  return {
    user_id: uid,
    full_name: fn ? fn : null,
    user_role: "rider",
    org_id: null,
    org_name: org ? org : null,
    org_logo_path: null,
    avatar_url: null,
    distance_m: 0,
    pin_kind: "rider_pin",
  };
}

export function RoutePeopleSearchModal({
  visible,
  onClose,
  orgAllowsOpenLane,
  viewerHasOrg,
}: Props) {
  const { profile } = useAuth();
  const router = useRouter();
  const [routeMapLatch, setRouteMapLatch] = useState(0);
  const [poolScope, setPoolScope] = useState<PoolScope>(viewerHasOrg ? "team" : "open");
  const [sortMode, setSortMode] = useState<SortMode>("nearest");
  const [detourMinutes, setDetourMinutes] = useState(8);
  const [detourInfoVisible, setDetourInfoVisible] = useState(false);
  const [deviationPickerOpen, setDeviationPickerOpen] = useState(false);
  const [commuteStats, setCommuteStats] = useState<{
    distance_m: number;
    duration_s: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<RoutePeopleRow[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [peerSheet, setPeerSheet] = useState<RoutePeopleRow | null>(null);
  const [introDraft, setIntroDraft] = useState("");
  const [introSending, setIntroSending] = useState(false);
  const [corridorMeta, setCorridorMeta] = useState({
    loading: false,
    hasThread: false,
    outPending: false,
    inPending: false,
  });

  const { viewerPinsGeoJson, viewerMyRoutesGeoJson, routesLoading } = useDiscoverViewerLayers(
    profile ?? null,
    routeMapLatch
  );

  useEffect(() => {
    if (visible) setRouteMapLatch((n) => n + 1);
    else {
      setDetourInfoVisible(false);
      setDeviationPickerOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !profile?.id) {
      setCommuteStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("commute_routes")
        .select("distance_m, duration_s")
        .eq("user_id", profile.id)
        .eq("direction", "to_work")
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setCommuteStats(null);
        return;
      }
      setCommuteStats({
        distance_m: Number(data.distance_m),
        duration_s: Number(data.duration_s),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, profile?.id]);

  const maxDetourCeiling = useMemo(
    () => maxDetourMinutesFromRoute(commuteStats?.duration_s),
    [commuteStats?.duration_s]
  );

  const deviationMinuteOptions = useMemo(
    () => Array.from({ length: Math.max(1, maxDetourCeiling - 1) }, (_, i) => i + 2),
    [maxDetourCeiling]
  );

  useEffect(() => {
    setDetourMinutes((prev) => Math.min(Math.max(2, prev), maxDetourCeiling));
  }, [maxDetourCeiling]);

  const searchRadiusM = useMemo(
    () =>
      detourMinutesToSearchRadiusM(
        detourMinutes,
        commuteStats?.distance_m,
        commuteStats?.duration_s
      ),
    [detourMinutes, commuteStats]
  );

  const coordsForHeat = useMemo(() => {
    return (
      primaryCommuteLineCoords(viewerMyRoutesGeoJson) ?? homeWorkFallbackLine(viewerPinsGeoJson)
    );
  }, [viewerMyRoutesGeoJson, viewerPinsGeoJson]);

  const routePeopleDemandGeoJson = useMemo(() => buildRoutePeopleDemandPointsGeoJson(people), [people]);

  const mapFallbackCenter = useMemo((): [number, number] => {
    const home = viewerPinsGeoJson.features.find(
      (f) => String((f.properties as { kind?: string } | null)?.kind ?? "") === "home"
    );
    if (home?.geometry.type === "Point") {
      const c = home.geometry.coordinates as [number, number];
      return [c[0], c[1]];
    }
    const any = viewerPinsGeoJson.features.find((f) => f.geometry.type === "Point");
    if (any?.geometry.type === "Point") {
      const c = any.geometry.coordinates as [number, number];
      return [c[0], c[1]];
    }
    return [138.6, -34.85];
  }, [viewerPinsGeoJson]);

  const corridorMapKey = useMemo(
    () =>
      `${routePeopleDemandGeoJson.features.length}|${viewerMyRoutesGeoJson.features.length}|${viewerPinsGeoJson.features.length}|${searchRadiusM}|${routesLoading ? 1 : 0}`,
    [routePeopleDemandGeoJson, viewerMyRoutesGeoJson, viewerPinsGeoJson, searchRadiusM, routesLoading]
  );

  const showCorridorMap = reason !== "no_home" && Boolean(profile?.id);
  const canRenderHeatPath = (coordsForHeat?.length ?? 0) >= 2;

  const openLaneDisabled = viewerHasOrg && !orgAllowsOpenLane;

  useEffect(() => {
    if (visible) {
      setPoolScope(viewerHasOrg ? "team" : "open");
    }
  }, [visible, viewerHasOrg]);

  useEffect(() => {
    if (openLaneDisabled && poolScope === "open") {
      setPoolScope("team");
    }
  }, [openLaneDisabled, poolScope]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scope = poolScope === "open" && !orgAllowsOpenLane && viewerHasOrg ? "team" : poolScope;
      const { data, error } = await supabase.rpc("poolyn_route_people_directory", {
        p_pool_scope: scope,
        p_sort: sortMode,
        p_max_distance_m: searchRadiusM,
      });
      if (error) {
        setPeople([]);
        setRestricted(false);
        setReason(null);
        showAlert("Could not load list", error.message);
        return;
      }
      const payload = data as {
        ok?: boolean;
        restricted?: boolean;
        people?: RoutePeopleRow[];
        reason?: string | null;
      } | null;
      setPeople(Array.isArray(payload?.people) ? payload!.people! : []);
      setRestricted(payload?.restricted === true);
      setReason(typeof payload?.reason === "string" ? payload.reason : null);
    } finally {
      setLoading(false);
    }
  }, [poolScope, sortMode, searchRadiusM, orgAllowsOpenLane, viewerHasOrg]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  useEffect(() => {
    if (!peerSheet?.user_id || !profile?.id) {
      setCorridorMeta({ loading: false, hasThread: false, outPending: false, inPending: false });
      return;
    }
    let cancelled = false;
    setCorridorMeta((m) => ({ ...m, loading: true }));
    const peer = peerSheet.user_id;
    void (async () => {
      const [t1, t2] = await Promise.all([
        supabase.from("poolyn_corridor_dm_threads").select("id").eq("user_low", profile.id).eq("user_high", peer).maybeSingle(),
        supabase.from("poolyn_corridor_dm_threads").select("id").eq("user_low", peer).eq("user_high", profile.id).maybeSingle(),
      ]);
      const hasThread = Boolean(t1.data?.id || t2.data?.id);
      const [outQ, inQ] = await Promise.all([
        supabase
          .from("poolyn_corridor_intro_requests")
          .select("id")
          .eq("from_user_id", profile.id)
          .eq("to_user_id", peer)
          .eq("status", "pending")
          .maybeSingle(),
        supabase
          .from("poolyn_corridor_intro_requests")
          .select("id")
          .eq("from_user_id", peer)
          .eq("to_user_id", profile.id)
          .eq("status", "pending")
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setCorridorMeta({
        loading: false,
        hasThread,
        outPending: Boolean(outQ.data?.id),
        inPending: Boolean(inQ.data?.id),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [peerSheet?.user_id, profile?.id]);

  const onMapWebViewMessage = useCallback(
    (msg: DemandCircleTapMsg) => {
      if (msg.type !== "demand_circle_tap") return;
      const row = routePersonFromMapTap(people, msg);
      if (row) setPeerSheet(row);
    },
    [people]
  );

  const sendIntroRequest = useCallback(async () => {
    if (!profile?.id || !peerSheet?.user_id) return;
    const body = introDraft.trim();
    if (body.length < 1) {
      showAlert("Say hello", "Add a short note with your intro request (up to 500 characters).");
      return;
    }
    setIntroSending(true);
    try {
      const { data, error } = await supabase.rpc("poolyn_send_corridor_intro_request", {
        p_to_user_id: peerSheet.user_id,
        p_intro_body: body,
      });
      const payload = data as { ok?: boolean; error?: string } | null;
      if (error || !payload?.ok) {
        const code = payload?.error;
        if (code === "already_pending") {
          showAlert("Already sent", "You already have a pending intro to this person.");
        } else if (code === "already_connected") {
          showAlert("Connected", "You can open your message thread from here.");
        } else {
          showAlert("Could not send", error?.message ?? "Try again in a moment.");
        }
        return;
      }
      setIntroDraft("");
      showAlert("Request sent", "They will get a notification and can accept or decline.");
      setCorridorMeta((m) => ({ ...m, outPending: true }));
    } finally {
      setIntroSending(false);
    }
  }, [profile?.id, peerSheet?.user_id, introDraft]);

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grab} />
          <View style={styles.headRow}>
            <Text style={styles.title}>Along your route</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>Your corridor and lane. Names stay professional only.</Text>

          <Text style={[styles.filterLabel, { marginBottom: Spacing.xs }]}>Who to show</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[
                styles.scopeChip,
                poolScope === "team" && styles.scopeChipOn,
                !viewerHasOrg && styles.scopeChipDisabled,
              ]}
              onPress={() => {
                if (!viewerHasOrg) {
                  showAlert(
                    "Squad lane",
                    "Join a workplace network on Poolyn to see teammates on your route here."
                  );
                  return;
                }
                setPoolScope("team");
              }}
            >
              <Ionicons
                name="people"
                size={16}
                color={poolScope === "team" ? "#fff" : Colors.primary}
              />
              <Text style={[styles.scopeChipText, poolScope === "team" && styles.scopeChipTextOn]}>
                Squad lane
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.scopeChip,
                poolScope === "open" && styles.scopeChipOnOpen,
                openLaneDisabled && styles.scopeChipDisabled,
              ]}
              onPress={() => {
                if (openLaneDisabled) {
                  showAlert(
                    "Closed network",
                    "Your workplace only shows teammates in the app. Ask an admin if cross-company matching should be enabled."
                  );
                  return;
                }
                setPoolScope("open");
              }}
            >
              <Ionicons
                name="globe-outline"
                size={16}
                color={poolScope === "open" && !openLaneDisabled ? "#fff" : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.scopeChipText,
                  poolScope === "open" && !openLaneDisabled && styles.scopeChipTextOn,
                  openLaneDisabled && styles.scopeChipTextDisabled,
                ]}
              >
                Open lane
              </Text>
            </TouchableOpacity>
          </View>
          {openLaneDisabled ? (
            <Text style={styles.restrictHint}>Open lane is off for your workplace network.</Text>
          ) : restricted && poolScope === "open" ? (
            <Text style={styles.restrictHint}>Open lane is not available for your account.</Text>
          ) : null}

          <View style={styles.detourLabelRow}>
            <Text style={styles.filterLabel}>Max route deviation</Text>
            <TouchableOpacity
              onPress={() => setDetourInfoVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="What max route deviation means"
            >
              <Ionicons name="information-circle-outline" size={20} color={Colors.primaryDark} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.deviationDropdown}
            onPress={() => setDeviationPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Max route deviation, ${detourMinutes} minutes`}
          >
            <Text style={styles.deviationDropdownText}>{detourMinutes} min</Text>
            <Ionicons name="chevron-down" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <Text style={[styles.filterLabel, { marginTop: Spacing.xs }]}>Sort</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.smallChip, sortMode === "nearest" && styles.smallChipOn]}
              onPress={() => setSortMode("nearest")}
            >
              <Text style={[styles.smallChipText, sortMode === "nearest" && styles.smallChipTextOn]}>
                Closest first
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallChip, sortMode === "farthest" && styles.smallChipOn]}
              onPress={() => setSortMode("farthest")}
            >
              <Text style={[styles.smallChipText, sortMode === "farthest" && styles.smallChipTextOn]}>
                Farthest first
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.applyBtn} onPress={() => void load()} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={Colors.textOnPrimary} />
            ) : (
              <Text style={styles.applyBtnText}>Refresh list</Text>
            )}
          </TouchableOpacity>

          {reason === "no_home" ? (
            <Text style={styles.empty}>Save a home pin under Profile → Commute to see people along your route.</Text>
          ) : showCorridorMap ? (
            <>
              {canRenderHeatPath ? (
                <View style={styles.corridorMapWrap}>
                  <DiscoverMapLayers
                    key={corridorMapKey}
                    demandGeoJson={routePeopleDemandGeoJson}
                    supplyGeoJson={EMPTY_MAP_FC}
                    routeGeoJson={EMPTY_MAP_FC}
                    viewerPinsGeoJson={viewerPinsGeoJson}
                    viewerMyRoutesGeoJson={viewerMyRoutesGeoJson}
                    layerEmphasis="demand"
                    title="Corridor"
                    mapHeight={200}
                    fallbackCenter={mapFallbackCenter}
                    remoteLoading={routesLoading}
                    compactMapChrome
                    demandLayerMode="circles"
                    onMapWebViewMessage={onMapWebViewMessage}
                  />
                  <Text style={styles.mapCaption}>
                    Tap an orange dot to see who it is. Green line: your commute path. Closed workplaces do not
                    appear in Open lane for people outside that workplace.
                  </Text>
                </View>
              ) : routesLoading ? (
                <View style={styles.mapLoadingBox}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.mapLoadingText}>Loading your route…</Text>
                </View>
              ) : (
                <Text style={styles.mapFallback}>
                  Save home and work under Profile → Commute to show your corridor on the map.
                </Text>
              )}
              {loading && people.length === 0 ? (
                <ActivityIndicator style={{ marginVertical: Spacing.sm }} color={Colors.primary} />
              ) : null}
              <FlatList
                data={people}
                keyExtractor={(item) => item.user_id}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  !loading ? (
                    <Text style={styles.empty}>
                      {viewerHasOrg && poolScope === "team"
                        ? "No teammates in this band yet. Try a wider deviation or Open lane (if your org allows it)."
                        : "No one in this band right now. Widen deviation or check back later."}
                    </Text>
                  ) : null
                }
                renderItem={({ item }) => {
                  const logoUri = poolScope === "open" ? orgLogoPublicUrl(item.org_logo_path) : null;
                  const showOrg = poolScope === "open" && Boolean(item.org_name?.trim());
                  const km = (item.distance_m / 1000).toFixed(item.distance_m >= 10000 ? 0 : 1);
                  const roleLabel =
                    item.pin_kind === "driver_pin" || item.user_role === "driver"
                      ? "Seats / route"
                      : "Looking to ride";
                  const avatarUri = resolveAvatarDisplayUrl(item.avatar_url);
                  return (
                    <TouchableOpacity
                      style={styles.row}
                      activeOpacity={0.75}
                      onPress={() => setPeerSheet(item)}
                    >
                      <View style={styles.rowAvatar}>
                        {avatarUri ? (
                          <Image source={{ uri: avatarUri }} style={styles.rowAvatarImg} />
                        ) : (
                          <Ionicons name="person" size={22} color={Colors.textSecondary} />
                        )}
                      </View>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {(item.full_name ?? "Member").trim()}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {roleLabel} · ~{km} km
                        </Text>
                        {showOrg ? (
                          <View style={styles.orgRow}>
                            {logoUri ? (
                              <Image source={{ uri: logoUri }} style={styles.orgLogo} />
                            ) : (
                              <View style={styles.orgLogoPh}>
                                <Ionicons name="business-outline" size={14} color={Colors.textTertiary} />
                              </View>
                            )}
                            <Text style={styles.orgName} numberOfLines={1}>
                              {item.org_name}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </>
          ) : (
            <Text style={styles.empty}>Sign in to see people along your route.</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={detourInfoVisible}
      animationType="fade"
      transparent
      onRequestClose={() => setDetourInfoVisible(false)}
    >
      <Pressable style={styles.infoBackdrop} onPress={() => setDetourInfoVisible(false)}>
        <Pressable style={styles.infoCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.infoTitle}>Max route deviation</Text>
          <Text style={styles.infoBody}>
            Minutes map to distance from your usual to-work pace. They cap how far from your home pin we list
            people whose pin sits between your home and work. It is a list filter only, not a trip detour limit.
          </Text>
          <Text style={styles.infoMeta}>
            Same-line commuters past your work stay listed. People past your home on that line only appear when
            their work is past yours. Range here: 2 to {maxDetourCeiling} min.
          </Text>
          <TouchableOpacity
            style={styles.infoCloseBtn}
            onPress={() => setDetourInfoVisible(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.infoCloseText}>Got it</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={deviationPickerOpen}
      animationType="fade"
      transparent
      onRequestClose={() => setDeviationPickerOpen(false)}
    >
      <Pressable style={styles.infoBackdrop} onPress={() => setDeviationPickerOpen(false)}>
        <Pressable style={styles.deviationPickerCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.deviationPickerTitle}>Minutes</Text>
          <FlatList
            data={deviationMinuteOptions}
            keyExtractor={(n) => String(n)}
            style={styles.deviationPickerList}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: m }) => (
              <TouchableOpacity
                style={[styles.deviationPickerRow, m === detourMinutes && styles.deviationPickerRowOn]}
                onPress={() => {
                  setDetourMinutes(m);
                  setDeviationPickerOpen(false);
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.deviationPickerRowText, m === detourMinutes && styles.deviationPickerRowTextOn]}>
                  {m} min
                </Text>
                {m === detourMinutes ? <Ionicons name="checkmark" size={18} color={Colors.primary} /> : null}
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={peerSheet !== null}
      animationType="slide"
      transparent
      onRequestClose={() => {
        setPeerSheet(null);
        setIntroDraft("");
      }}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          setPeerSheet(null);
          setIntroDraft("");
        }}
      >
        <Pressable style={styles.peerSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grab} />
          <View style={styles.headRow}>
            <Text style={styles.title}>Along your route</Text>
            <TouchableOpacity
              onPress={() => {
                setPeerSheet(null);
                setIntroDraft("");
              }}
              hitSlop={12}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {peerSheet ? (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.peerHero}>
                {resolveAvatarDisplayUrl(peerSheet.avatar_url) ? (
                  <Image
                    source={{ uri: resolveAvatarDisplayUrl(peerSheet.avatar_url)! }}
                    style={styles.peerHeroAvatar}
                  />
                ) : (
                  <View style={styles.peerHeroAvatarPh}>
                    <Ionicons name="person" size={36} color={Colors.textTertiary} />
                  </View>
                )}
                <Text style={styles.peerHeroName} numberOfLines={2}>
                  {(peerSheet.full_name ?? "Member").trim()}
                </Text>
                {poolScope === "open" && peerSheet.org_name?.trim() ? (
                  <Text style={styles.peerHeroOrg} numberOfLines={2}>
                    {peerSheet.org_name}
                  </Text>
                ) : null}
                <Text style={styles.peerHeroRole}>
                  {peerSheet.pin_kind === "driver_pin" || peerSheet.user_role === "driver"
                    ? "Driver / seats on route"
                    : "Rider"}
                  {peerSheet.distance_m > 0
                    ? ` · ~${(peerSheet.distance_m / 1000).toFixed(peerSheet.distance_m >= 10000 ? 0 : 1)} km from your home pin`
                    : ""}
                </Text>
              </View>

              {corridorMeta.loading ? (
                <ActivityIndicator style={{ marginVertical: Spacing.md }} color={Colors.primary} />
              ) : corridorMeta.hasThread ? (
                <TouchableOpacity
                  style={styles.peerPrimaryBtn}
                  activeOpacity={0.85}
                  onPress={() => {
                    const id = peerSheet.user_id;
                    setPeerSheet(null);
                    setIntroDraft("");
                    router.push({ pathname: "/(tabs)/profile/corridor-thread/[peerId]", params: { peerId: id } });
                  }}
                >
                  <Text style={styles.peerPrimaryBtnText}>Open messages</Text>
                </TouchableOpacity>
              ) : corridorMeta.inPending ? (
                <Text style={styles.peerHint}>
                  This person already sent you an intro. Open Profile → Activity to accept or decline.
                </Text>
              ) : corridorMeta.outPending ? (
                <Text style={styles.peerHint}>Your intro request is pending. They will get a notification.</Text>
              ) : (
                <>
                  <Text style={styles.peerIntroLabel}>Message request (one note until they accept)</Text>
                  <TextInput
                    style={styles.peerIntroInput}
                    value={introDraft}
                    onChangeText={setIntroDraft}
                    placeholder="Hi, I commute nearby and would like to connect..."
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity
                    style={[styles.peerPrimaryBtn, introSending && styles.peerPrimaryBtnDisabled]}
                    disabled={introSending}
                    activeOpacity={0.85}
                    onPress={() => void sendIntroRequest()}
                  >
                    {introSending ? (
                      <ActivityIndicator color={Colors.textOnPrimary} />
                    ) : (
                      <Text style={styles.peerPrimaryBtnText}>Send intro request</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              <Text style={styles.peerFinePrint}>
                After they accept, you can chat back and forth in Profile. Until then, only this one intro note is
                sent.
              </Text>
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing["3xl"],
    maxHeight: "88%",
  },
  grab: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  sub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  detourLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  deviationDropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    maxWidth: 200,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  deviationDropdownText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  deviationPickerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 280,
    width: "72%",
    maxWidth: 280,
    alignSelf: "center",
  },
  deviationPickerTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  deviationPickerList: { maxHeight: 220 },
  deviationPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  deviationPickerRowOn: { backgroundColor: Colors.primaryLight },
  deviationPickerRowText: { fontSize: FontSize.sm, color: Colors.text },
  deviationPickerRowTextOn: { fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  scopeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  scopeChipOn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  scopeChipOnOpen: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
  },
  scopeChipDisabled: {
    opacity: 0.45,
    borderColor: Colors.border,
  },
  scopeChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  scopeChipTextOn: { color: "#fff" },
  scopeChipTextDisabled: { color: Colors.textTertiary },
  smallChip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  smallChipOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  smallChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  smallChipTextOn: {
    color: Colors.primaryDark,
    fontWeight: FontWeight.semibold,
  },
  restrictHint: {
    fontSize: FontSize.xs,
    color: Colors.warning,
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  applyBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  applyBtnText: {
    color: Colors.textOnPrimary,
    fontWeight: FontWeight.bold,
    fontSize: FontSize.sm,
  },
  corridorMapWrap: {
    marginBottom: Spacing.sm,
    overflow: "hidden",
  },
  mapCaption: {
    fontSize: 10,
    color: Colors.textTertiary,
    lineHeight: 14,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
    paddingTop: 4,
  },
  mapLoadingBox: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  mapLoadingText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  mapFallback: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  list: { maxHeight: 260 },
  listContent: { paddingBottom: Spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  rowAvatarImg: { width: 44, height: 44 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  rowMeta: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  orgRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  orgLogo: { width: 18, height: 18, borderRadius: 4 },
  orgLogoPh: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: Colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  orgName: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  peerSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing["3xl"],
    maxHeight: "75%",
  },
  peerHero: { alignItems: "center", paddingVertical: Spacing.md },
  peerHeroAvatar: { width: 88, height: 88, borderRadius: 44, marginBottom: Spacing.sm },
  peerHeroAvatarPh: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.inputBackground,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  peerHeroName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    textAlign: "center",
  },
  peerHeroOrg: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  peerHeroRole: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    lineHeight: 20,
  },
  peerHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    textAlign: "center",
    marginVertical: Spacing.md,
  },
  peerIntroLabel: {
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: Spacing.xs,
  },
  peerIntroInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.text,
    marginBottom: Spacing.md,
    backgroundColor: Colors.background,
  },
  peerPrimaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  peerPrimaryBtnDisabled: { opacity: 0.6 },
  peerPrimaryBtnText: {
    color: Colors.textOnPrimary,
    fontWeight: FontWeight.bold,
    fontSize: FontSize.sm,
  },
  peerFinePrint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 16,
    textAlign: "center",
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  empty: {
    textAlign: "center",
    color: Colors.textTertiary,
    fontSize: FontSize.sm,
    paddingVertical: Spacing.xl,
    lineHeight: 20,
  },
  infoBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  infoBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  infoMeta: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    lineHeight: 18,
    marginBottom: Spacing.lg,
  },
  infoCloseBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  infoCloseText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
});
