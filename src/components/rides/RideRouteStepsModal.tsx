import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { normalizeRpcGeoJson, parseGeoPoint } from "@/lib/parseGeoPoint";
import { fetchDrivingRouteWithSteps, type DrivingRouteStep } from "@/lib/mapboxDirections";
import { presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  origin: unknown;
  destination: unknown;
  title?: string;
  /** Replaces default explainer under the title (e.g. rider leg vs full driver route). */
  hint?: string;
};

function formatStepDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function RideRouteStepsModal({
  visible,
  onClose,
  origin,
  destination,
  title,
  hint,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<DrivingRouteStep[]>([]);
  const [destPt, setDestPt] = useState<{ lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    const o = parseGeoPoint(normalizeRpcGeoJson(origin));
    const d = parseGeoPoint(normalizeRpcGeoJson(destination));
    if (!o || !d) {
      setError("Missing route points for this ride.");
      setSteps([]);
      setDestPt(null);
      return;
    }
    setDestPt({ lat: d.lat, lng: d.lng });
    setLoading(true);
    setError(null);
    const res = await fetchDrivingRouteWithSteps([
      [o.lng, o.lat],
      [d.lng, d.lat],
    ]);
    setLoading(false);
    if (!res.ok) {
      setError(
        res.error === "missing_mapbox_token"
          ? "Maps token is not configured."
          : "Could not load turn-by-turn steps. Try again or use Navigate."
      );
      setSteps([]);
      return;
    }
    setSteps(res.steps);
  }, [origin, destination]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, styles.backdropDim]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <Text style={styles.sheetTitle}>{title ?? "Route overview"}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetSub}>
            {hint ??
              "Step list from Mapbox (traffic-aware where available). Open your preferred app for live turn-by-turn."}
          </Text>

          {loading ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.centerBlock}>
              <Ionicons name="alert-circle-outline" size={36} color={Colors.textTertiary} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : steps.length === 0 ? (
            <View style={styles.centerBlock}>
              <Text style={styles.errorText}>No steps returned for this route.</Text>
            </View>
          ) : (
            <FlatList
              data={steps}
              keyExtractor={(_, i) => `step-${i}`}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              renderItem={({ item, index }) => (
                <View style={styles.stepRow}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text style={styles.stepInstruction}>{item.instruction}</Text>
                    <Text style={styles.stepMeta}>
                      {formatStepDistance(item.distanceM)}
                      {item.durationS > 0 ? ` · ${Math.max(1, Math.round(item.durationS / 60))} min` : ""}
                    </Text>
                  </View>
                </View>
              )}
            />
          )}

          {destPt ? (
            <TouchableOpacity
              style={styles.navBtn}
              activeOpacity={0.85}
              onPress={() => presentDrivingNavigationPicker(destPt.lat, destPt.lng)}
            >
              <Ionicons name="navigate" size={20} color={Colors.textOnPrimary} />
              <Text style={styles.navBtnText}>Navigate to destination</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdropDim: {
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    zIndex: 2,
    elevation: 8,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    maxHeight: "78%",
    ...Shadow.lg,
  },
  handleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  sheetTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    flex: 1,
  },
  sheetSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  centerBlock: {
    paddingVertical: Spacing["2xl"],
    alignItems: "center",
    gap: Spacing.sm,
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
  },
  list: { maxHeight: 360 },
  listContent: { paddingBottom: Spacing.md },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  stepBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
  },
  stepBody: { flex: 1, minWidth: 0 },
  stepInstruction: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  stepMeta: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  navBtn: {
    marginTop: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
  },
  navBtnText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
});
