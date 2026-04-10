import { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
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
  distance_m: number;
  pin_kind: string;
};

type PoolScope = "team" | "open";
type SortMode = "nearest" | "farthest";

const DETOUR_KM_CHIPS = [10, 25, 50, 80] as const;

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

export function RoutePeopleSearchModal({
  visible,
  onClose,
  orgAllowsOpenLane,
  viewerHasOrg,
}: Props) {
  const [poolScope, setPoolScope] = useState<PoolScope>(viewerHasOrg ? "team" : "open");
  const [sortMode, setSortMode] = useState<SortMode>("nearest");
  const [maxKm, setMaxKm] = useState<number>(50);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<RoutePeopleRow[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

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
        p_max_distance_m: Math.round(maxKm * 1000),
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
  }, [poolScope, sortMode, maxKm, orgAllowsOpenLane, viewerHasOrg]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  return (
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
          <Text style={styles.sub}>
            Same corridor as your commute map. Tune radius and sort. Names stay professional only.
          </Text>

          <Text style={styles.filterLabel}>Who to show</Text>
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

          <Text style={styles.filterLabel}>Radius from your home pin</Text>
          <View style={styles.chipRow}>
            {DETOUR_KM_CHIPS.map((km) => (
              <TouchableOpacity
                key={km}
                style={[styles.smallChip, maxKm === km && styles.smallChipOn]}
                onPress={() => setMaxKm(km)}
              >
                <Text style={[styles.smallChipText, maxKm === km && styles.smallChipTextOn]}>
                  {km} km
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.filterLabel}>Sort</Text>
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
          ) : loading ? (
            <ActivityIndicator style={{ marginTop: Spacing.lg }} color={Colors.primary} />
          ) : (
            <FlatList
              data={people}
              keyExtractor={(item) => item.user_id}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {viewerHasOrg && poolScope === "team"
                    ? "No teammates in this band yet. Try a wider radius or Open lane (if your org allows it)."
                    : "No one in this band right now. Widen radius or check back later."}
                </Text>
              }
              renderItem={({ item }) => {
                const logoUri = poolScope === "open" ? orgLogoPublicUrl(item.org_logo_path) : null;
                const showOrg = poolScope === "open" && Boolean(item.org_name?.trim());
                const km = (item.distance_m / 1000).toFixed(item.distance_m >= 10000 ? 0 : 1);
                const roleLabel =
                  item.pin_kind === "driver_pin" || item.user_role === "driver"
                    ? "Seats / route"
                    : "Looking to ride";
                return (
                  <View style={styles.row}>
                    <View style={styles.rowAvatar}>
                      <Ionicons name="person" size={22} color={Colors.textSecondary} />
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
                  </View>
                );
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
  filterLabel: {
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: Spacing.xs,
  },
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
  list: { maxHeight: 320 },
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
  },
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
  empty: {
    textAlign: "center",
    color: Colors.textTertiary,
    fontSize: FontSize.sm,
    paddingVertical: Spacing.xl,
    lineHeight: 20,
  },
});
