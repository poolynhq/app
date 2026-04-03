import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
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

function parsePointWkt(w: unknown): { lat: number; lng: number } | null {
  if (w == null || typeof w !== "string") return null;
  const m = /^POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(w.trim());
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export default function CommuteLocationsScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [savingPickup, setSavingPickup] = useState(false);

  const canRide = profile?.role === "passenger" || profile?.role === "both";

  const homePt = useMemo(() => parsePointWkt(profile?.home_location), [profile?.home_location]);
  const pickupPt = useMemo(() => parsePointWkt(profile?.pickup_location), [profile?.pickup_location]);

  const alternateActive = useMemo(() => {
    if (!pickupPt) return false;
    if (!homePt) return true;
    return distanceMeters(homePt, pickupPt) > 80;
  }, [homePt, pickupPt]);

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
      await refreshProfile();
    } finally {
      setSavingPickup(false);
    }
  }, [profile?.id, refreshProfile]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          Home and work define your commute corridor. You can change them anytime; we rebuild your saved
          route for matching.
        </Text>

        <TouchableOpacity
          style={styles.primaryCard}
          onPress={() => router.push("/(onboarding)/location?fromProfile=1")}
          activeOpacity={0.85}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="home-outline" size={22} color={Colors.primary} />
          </View>
          <View style={styles.cardTextCol}>
            <Text style={styles.cardTitle}>Home & work locations</Text>
            <Text style={styles.cardBody}>
              {profile?.work_location_label?.trim()
                ? `Work: ${profile.work_location_label.trim()}`
                : "Set or update where you start and end your commute"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={Colors.textTertiary} />
        </TouchableOpacity>

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
              {alternateActive ? "Using alternate pickup (not your saved home pin)." : "Using saved home as pickup."}
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
            {alternateActive ? (
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
  primaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTextCol: { flex: 1, minWidth: 0 },
  cardTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 4,
  },
  cardBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },
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
