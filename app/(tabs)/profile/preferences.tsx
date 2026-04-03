import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

/** Hide ride atmosphere controls until product governs who sets them (v1). */
const SHOW_RIDE_ATMOSPHERE_V1 = false;

const MAX_PASS_OPTIONS = [1, 2, 3, 4];
const DRIVER_DETOUR_MINUTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function clampDetourMins(v: number): number {
  return Math.min(10, Math.max(1, Math.round(v)));
}

export default function PreferencesScreen() {
  const { profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefId, setPrefId] = useState<string | null>(null);

  const [maxDetour, setMaxDetour] = useState(8);
  const [maxPassengers, setMaxPassengers] = useState(3);
  const [autoAccept, setAutoAccept] = useState(false);
  const [driverSameGenderPassengersOnly, setDriverSameGenderPassengersOnly] = useState(false);
  const [quietRide, setQuietRide] = useState(false);
  const [smokingOk, setSmokingOk] = useState(false);
  const [petsOk, setPetsOk] = useState(false);
  const [musicOk, setMusicOk] = useState(true);
  const [trustedPassengerCount, setTrustedPassengerCount] = useState(0);

  const [detourPickerOpen, setDetourPickerOpen] = useState(false);
  const [detourInfoOpen, setDetourInfoOpen] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data: prefs } = await supabase
      .from("driver_preferences")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle();
    if (prefs) {
      setPrefId(prefs.id);
      setMaxDetour(clampDetourMins(prefs.max_detour_mins));
      setMaxPassengers(prefs.max_passengers);
      setAutoAccept(prefs.auto_accept);
      setDriverSameGenderPassengersOnly(prefs.gender_pref === "same");
      setQuietRide(prefs.quiet_ride);
      setSmokingOk(prefs.smoking_ok);
      setPetsOk(prefs.pets_ok);
      setMusicOk(prefs.music_ok);
    }
    const { count, error: trustErr } = await supabase
      .from("driver_trusted_passengers")
      .select("passenger_id", { count: "exact", head: true })
      .eq("driver_id", profile.id);
    setTrustedPassengerCount(trustErr ? 0 : count ?? 0);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!profile?.id) return;
    setSaving(true);
    const prefPayload = {
      user_id: profile.id,
      max_detour_mins: clampDetourMins(maxDetour),
      max_passengers: maxPassengers,
      auto_accept: autoAccept,
      gender_pref: driverSameGenderPassengersOnly ? "same" : "any",
      quiet_ride: quietRide,
      smoking_ok: smokingOk,
      pets_ok: petsOk,
      music_ok: musicOk,
    };
    if (prefId) {
      await supabase.from("driver_preferences").update(prefPayload).eq("id", prefId);
    } else {
      await supabase.from("driver_preferences").insert(prefPayload);
    }
    await refreshProfile();
    setSaving(false);
    showAlert("Saved", "Your driver preferences have been updated.");
    load();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (profile?.role === "passenger") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ScrollView contentContainerStyle={styles.passengerOnly}>
          <Ionicons name="car-outline" size={40} color={Colors.textTertiary} />
          <Text style={styles.passengerOnlyTitle}>Driver preferences</Text>
          <Text style={styles.passengerOnlyBody}>
            These settings apply when you offer rides. Change your role to Driver or Both on your
            profile, then come back here to set detours, auto-accept, and passenger gender rules.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Driver</Text>
        <View style={styles.card}>
          <PrefRow icon="people-outline" label="Max passengers" subtitle="Riders per trip">
            <View style={styles.chipRow}>
              {MAX_PASS_OPTIONS.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.chip, maxPassengers === v && styles.chipActive]}
                  onPress={() => setMaxPassengers(v)}
                >
                  <Text style={[styles.chipText, maxPassengers === v && styles.chipTextActive]}>
                    {v}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </PrefRow>
          <Divider />
          <PrefRow
            icon="resize-outline"
            label="Max extra trip time"
            subtitle="Minutes you allow pickups to add to your drive"
          >
            <View style={styles.detourControlRow}>
              <TouchableOpacity
                style={styles.detourSelect}
                onPress={() => setDetourPickerOpen(true)}
                activeOpacity={0.75}
              >
                <Text style={styles.detourSelectText}>{maxDetour} min</Text>
                <Ionicons name="chevron-down" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDetourInfoOpen(true)}
                hitSlop={12}
                style={styles.infoBubble}
                accessibilityLabel="About extra trip time and cost"
              >
                <Ionicons name="information-circle-outline" size={24} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          </PrefRow>
          <Divider />
          <PrefRow
            icon="flash-outline"
            label="Auto-accept trusted riders"
            subtitle={
              trustedPassengerCount === 0
                ? "When on, only riders on your trusted list are auto-seated (same org). Add people after a completed trip (coming soon)."
                : `${trustedPassengerCount} trusted: same-org auto seat on posted rides only.`
            }
          >
            <Switch
              value={autoAccept}
              onValueChange={(v) => {
                if (v && trustedPassengerCount === 0) {
                  showAlert(
                    "Trusted list empty",
                    "Turn this on when you are ready. After we ship trip history, you will add riders to your trusted list; until then, no one is auto-seated."
                  );
                }
                setAutoAccept(v);
              }}
              trackColor={{ false: Colors.border, true: Colors.primaryLight }}
              thumbColor={autoAccept ? Colors.primary : Colors.surface}
            />
          </PrefRow>
          <Divider />
          <PrefRow
            icon="people-outline"
            label="Same-gender passengers only"
            subtitle="Uses the gender on your profile. Off = any gender."
          >
            <Switch
              value={driverSameGenderPassengersOnly}
              onValueChange={setDriverSameGenderPassengersOnly}
              trackColor={{ false: Colors.border, true: Colors.primaryLight }}
              thumbColor={driverSameGenderPassengersOnly ? Colors.primary : Colors.surface}
            />
          </PrefRow>
        </View>

        {SHOW_RIDE_ATMOSPHERE_V1 ? (
          <>
            <Text style={styles.sectionLabel}>RIDE ATMOSPHERE</Text>
            <View style={styles.card}>
              <PrefRow icon="volume-mute-outline" label="Quiet ride" subtitle="No calls or loud music preferred">
                <Switch
                  value={quietRide}
                  onValueChange={setQuietRide}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={quietRide ? Colors.primary : Colors.surface}
                />
              </PrefRow>
              <Divider />
              <PrefRow icon="musical-notes-outline" label="Music OK" subtitle="Comfortable playing music during rides">
                <Switch
                  value={musicOk}
                  onValueChange={setMusicOk}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={musicOk ? Colors.primary : Colors.surface}
                />
              </PrefRow>
              <Divider />
              <PrefRow icon="paw-outline" label="Pets welcome" subtitle="Happy to have pets in the car">
                <Switch
                  value={petsOk}
                  onValueChange={setPetsOk}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={petsOk ? Colors.primary : Colors.surface}
                />
              </PrefRow>
              <Divider />
              <PrefRow icon="flame-outline" label="Smoking OK" subtitle="Comfortable with smoking in or near the vehicle">
                <Switch
                  value={smokingOk}
                  onValueChange={setSmokingOk}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={smokingOk ? Colors.primary : Colors.surface}
                />
              </PrefRow>
            </View>
          </>
        ) : null}

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save preferences"}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={detourPickerOpen} transparent animationType="fade" onRequestClose={() => setDetourPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDetourPickerOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Max extra trip time</Text>
            <Text style={styles.modalHint}>Pickups must fit within this added time.</Text>
            <ScrollView style={styles.pickerList} showsVerticalScrollIndicator={false}>
              {DRIVER_DETOUR_MINUTES.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.pickerRow, maxDetour === m && styles.pickerRowActive]}
                  onPress={() => {
                    setMaxDetour(m);
                    setDetourPickerOpen(false);
                  }}
                >
                  <Text style={[styles.pickerRowText, maxDetour === m && styles.pickerRowTextActive]}>{m} min</Text>
                  {maxDetour === m ? <Ionicons name="checkmark" size={20} color={Colors.primary} /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCloseOnly} onPress={() => setDetourPickerOpen(false)}>
              <Text style={styles.modalCloseOnlyText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={detourInfoOpen} transparent animationType="fade" onRequestClose={() => setDetourInfoOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDetourInfoOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Extra time on your commute</Text>
            <DetourRouteSchematic />
            <Text style={styles.infoBody}>
              This is the maximum extra minutes added to your usual home-to-work drive when you pick
              someone up along the way. Fair-share pricing credits that added distance and time to the
              rider whose pickup caused the detour, not to other passengers.
            </Text>
            <TouchableOpacity style={styles.modalPrimaryBtn} onPress={() => setDetourInfoOpen(false)}>
              <Text style={styles.modalPrimaryBtnText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

/** Baseline commute with a peaked pickup detour (matches in-app green / neutral palette). */
function DetourRouteSchematic() {
  return (
    <View style={detourSchematicStyles.wrap}>
      <View style={detourSchematicStyles.canvas}>
        <View style={detourSchematicStyles.baseline} />
        <View style={detourSchematicStyles.peak} />
        <View style={detourSchematicStyles.markerHome} />
        <View style={detourSchematicStyles.markerWork} />
      </View>
      <Text style={detourSchematicStyles.caption}>Straight route with a short pickup detour</Text>
    </View>
  );
}

const detourSchematicStyles = StyleSheet.create({
  wrap: { width: "100%", alignItems: "center", marginVertical: Spacing.md },
  canvas: { width: "100%", height: 72, position: "relative" },
  baseline: {
    position: "absolute",
    left: "7%",
    right: "7%",
    bottom: 18,
    height: 3,
    backgroundColor: Colors.text,
    borderRadius: 2,
    opacity: 0.9,
    zIndex: 1,
  },
  /* Tip touches the commute line; flat top is the detour loop above your route. */
  peak: {
    position: "absolute",
    left: "50%",
    marginLeft: -26,
    bottom: 18,
    width: 0,
    height: 0,
    borderLeftWidth: 26,
    borderRightWidth: 26,
    borderTopWidth: 32,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#CBD5E1",
    zIndex: 2,
  },
  markerHome: {
    position: "absolute",
    left: "5.5%",
    bottom: 13,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: Colors.accentLight,
    borderWidth: 2.5,
    borderColor: Colors.primary,
    zIndex: 3,
  },
  markerWork: {
    position: "absolute",
    right: "5.5%",
    bottom: 13,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.primaryDark,
    zIndex: 3,
  },
  caption: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    textAlign: "center",
    lineHeight: 17,
  },
});

function PrefRow({
  icon,
  label,
  subtitle,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={prefStyles.row}>
      <View style={prefStyles.iconWrap}>
        <Ionicons name={icon} size={20} color={Colors.primary} />
      </View>
      <View style={prefStyles.text}>
        <Text style={prefStyles.label}>{label}</Text>
        {subtitle ? <Text style={prefStyles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={prefStyles.control}>{children}</View>
    </View>
  );
}

const prefStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.md, gap: Spacing.md },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  text: { flex: 1 },
  label: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.text },
  subtitle: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  control: { flexShrink: 0 },
});

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.borderLight, marginHorizontal: -Spacing.base }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  passengerOnly: {
    padding: Spacing["2xl"],
    alignItems: "center",
    gap: Spacing.md,
    paddingTop: Spacing["4xl"],
  },
  passengerOnlyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    textAlign: "center",
  },
  passengerOnlyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  chipRow: { flexDirection: "row", gap: Spacing.xs, flexWrap: "wrap" },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  chipTextActive: { color: Colors.primaryDark, fontWeight: FontWeight.semibold },
  detourControlRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  detourSelect: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    minWidth: 100,
  },
  detourSelectText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  infoBubble: { padding: 4 },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.base + 2,
    alignItems: "center",
  },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: "80%",
    ...Shadow.sm,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  modalHint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  pickerList: { maxHeight: 280 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  pickerRowActive: { backgroundColor: Colors.primaryLight },
  pickerRowText: { fontSize: FontSize.base, color: Colors.text },
  pickerRowTextActive: { fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  modalCloseOnly: { marginTop: Spacing.md, alignItems: "center" },
  modalCloseOnlyText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  infoBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  modalPrimaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  modalPrimaryBtnText: { color: Colors.textOnPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
