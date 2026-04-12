import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { showAlert } from "@/lib/platformAlert";
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { MapPinPickerModal } from "@/components/maps/MapPinPickerModal";
import { AdhocMonthCalendar } from "@/components/rides/AdhocMonthCalendar";
import { AdhocPlaceInput, type PlacePin } from "@/components/rides/AdhocPlaceInput";
import { ADHOC_LISTING_NOTES_MAX_CHARS, poolynCreateAdhocListing } from "@/lib/adhocPoolyn";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function PostDatedTripScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const home = parseGeoPoint(profile?.home_location as unknown);
  const initialLat = home?.lat ?? -37.8136;
  const initialLng = home?.lng ?? 144.9631;
  const proximity = `${initialLng},${initialLat}`;

  const [hasVehicle, setHasVehicle] = useState(true);
  const [vehicleMaxPassenger, setVehicleMaxPassenger] = useState(3);
  const [vehicleMake, setVehicleMake] = useState<string | null>(null);
  const [vehicleModel, setVehicleModel] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loadingVeh, setLoadingVeh] = useState(true);

  const [tripTitle, setTripTitle] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [departFlexDays, setDepartFlexDays] = useState(0);
  const [departH, setDepartH] = useState(8);
  const [departM, setDepartM] = useState(0);

  const [origin, setOrigin] = useState<PlacePin | null>(null);
  const [dest, setDest] = useState<PlacePin | null>(null);
  const [mapTarget, setMapTarget] = useState<"origin" | "dest" | null>(null);

  const [seats, setSeats] = useState(1);
  const [bagSlots, setBagSlots] = useState(0);
  const [listingNotes, setListingNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const departAt = useMemo(() => {
    return new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      departH,
      departM,
      0,
      0
    );
  }, [selectedDate, departH, departM]);

  const loadVehicleAndOrg = useCallback(async () => {
    if (!profile?.id) {
      setLoadingVeh(false);
      return;
    }
    if (profile.org_id) {
      const { data: org } = await supabase.from("organisations").select("name").eq("id", profile.org_id).maybeSingle();
      setOrgName(org?.name?.trim() ?? null);
    } else {
      setOrgName(null);
    }
    const { data } = await supabase
      .from("vehicles")
      .select("seats, make, model")
      .eq("user_id", profile.id)
      .eq("active", true)
      .gt("seats", 1)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!data) {
      setHasVehicle(false);
      setVehicleMaxPassenger(1);
      setVehicleMake(null);
      setVehicleModel(null);
    } else {
      setHasVehicle(true);
      const s = data.seats ?? 4;
      setVehicleMaxPassenger(Math.max(1, s - 1));
      setVehicleMake(data.make?.trim() ?? null);
      setVehicleModel(data.model?.trim() ?? null);
    }
    setLoadingVeh(false);
  }, [profile?.id, profile?.org_id]);

  useEffect(() => {
    void loadVehicleAndOrg();
  }, [loadVehicleAndOrg]);

  useEffect(() => {
    setSeats((x) => Math.min(x, vehicleMaxPassenger));
  }, [vehicleMaxPassenger]);

  const disclosureLines = useMemo(() => {
    const name = (profile?.full_name ?? "").trim() || "your name on your profile";
    const org = orgName || "your workplace name on Poolyn";
    const mk = vehicleMake && vehicleModel ? `${vehicleMake} ${vehicleModel}` : vehicleMake || vehicleModel || "your active vehicle make and model";
    return { name, org, vehicle: mk };
  }, [profile?.full_name, orgName, vehicleMake, vehicleModel]);

  async function onSubmit() {
    if (!origin || !dest) {
      showAlert("Locations", "Choose both start and end using search or the map.");
      return;
    }
    if (departAt.getTime() < Date.now() - 60_000) {
      showAlert("Time", "Pick a departure time in the future.");
      return;
    }
    setSubmitting(true);
    const res = await poolynCreateAdhocListing({
      departAt,
      originLat: origin.lat,
      originLng: origin.lng,
      destLat: dest.lat,
      destLng: dest.lng,
      originLabel: origin.label,
      destLabel: dest.label,
      passengerSeatsAvailable: seats,
      baggageSlots: bagSlots,
      tripTitle: tripTitle.trim() || null,
      departFlexDays,
      listingNotes: listingNotes.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) {
      showAlert("Posted", "Your trip is live for colleagues to find under Search for a seat.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } else {
      const map: Record<string, string> = {
        no_vehicle: "Add an active vehicle with at least two total seats under Profile first.",
        bad_depart_time: "Pick a future departure time.",
        no_org: "Join a workplace on Poolyn before posting.",
      };
      showAlert("Could not post", map[res.reason] ?? res.reason);
    }
  }

  if (loadingVeh) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      </SafeAreaView>
    );
  }

  if (!hasVehicle) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.blocked}>
          <Ionicons name="car-outline" size={40} color={Colors.textTertiary} />
          <Text style={styles.blockedTitle}>Vehicle required</Text>
          <Text style={styles.blockedBody}>
            Add an active vehicle with at least two total seats under Profile to post a dated trip. You can use
            Poolyn as a rider without a vehicle.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Trip name (optional)</Text>
        <TextInput
          style={styles.titleInput}
          placeholder="e.g. Airport run, weekend office day"
          placeholderTextColor={Colors.textTertiary}
          value={tripTitle}
          onChangeText={setTripTitle}
          maxLength={120}
        />

        <Text style={styles.lead}>
          Set where you are leaving from, where you are going, and when. Colleagues in your workplace can search
          and request a seat.
        </Text>

        <Text style={styles.label}>Date</Text>
        <AdhocMonthCalendar value={selectedDate} onChange={setSelectedDate} />

        <Text style={styles.label}>Departure day flexibility (you)</Text>
        <Text style={styles.hint}>
          Allow your trip to match searches up to this many whole days before or after the date above (same time of
          day).
        </Text>
        <View style={styles.stepRow}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setDepartFlexDays((d) => Math.max(0, d - 1))}
          >
            <Ionicons name="remove" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.stepVal}>± {departFlexDays} day{departFlexDays === 1 ? "" : "s"}</Text>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setDepartFlexDays((d) => Math.min(2, d + 1))}
          >
            <Ionicons name="add" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.stepHint}>Up to 2</Text>
        </View>

        <Text style={styles.label}>Approximate departure</Text>
        <View style={styles.timeRow}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setDepartH((h) => (h <= 0 ? 23 : h - 1))}>
            <Ionicons name="remove" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.timeVal}>
            {String(departH).padStart(2, "0")}:{String(departM).padStart(2, "0")}
          </Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setDepartH((h) => (h >= 23 ? 0 : h + 1))}>
            <Ionicons name="add" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.minRow}>
          {([0, 15, 30, 45] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.minChip, departM === m && styles.minChipOn]}
              onPress={() => setDepartM(m)}
            >
              <Text style={[styles.minChipText, departM === m && styles.minChipTextOn]}>:{String(m).padStart(2, "0")}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <AdhocPlaceInput
          label="Start"
          mapAccessibilityLabel="Pick start on map"
          value={origin}
          onChange={setOrigin}
          onOpenMap={() => setMapTarget("origin")}
          proximity={proximity}
        />

        <AdhocPlaceInput
          label="End"
          mapAccessibilityLabel="Pick end on map"
          value={dest}
          onChange={setDest}
          onOpenMap={() => setMapTarget("dest")}
          proximity={proximity}
        />

        <Text style={styles.label}>Passenger seats you are offering</Text>
        <View style={styles.stepRow}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setSeats((s) => Math.max(1, s - 1))}
          >
            <Ionicons name="remove" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.stepVal}>{seats}</Text>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setSeats((s) => Math.min(vehicleMaxPassenger, s + 1))}
          >
            <Ionicons name="add" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.stepHint}>Up to {vehicleMaxPassenger} (your vehicle)</Text>
        </View>

        <Text style={styles.label}>Checked-bag-sized slots</Text>
        <Text style={styles.hint}>
          How many large bags (about airline checked size) you can take besides passengers.
        </Text>
        <View style={styles.stepRow}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setBagSlots((b) => Math.max(0, b - 1))}>
            <Ionicons name="remove" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.stepVal}>{bagSlots}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setBagSlots((b) => Math.min(6, b + 1))}>
            <Ionicons name="add" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.disclosure}>
          <Ionicons name="information-circle-outline" size={20} color={Colors.primaryDark} />
          <Text style={styles.disclosureText}>
            Along with route and time, riders will see: your full name as it appears on your Poolyn profile
            (currently &ldquo;{disclosureLines.name}&rdquo;), your organisation name ({disclosureLines.org}), and your
            vehicle ({disclosureLines.vehicle}). If you list a colour on your vehicle, it can appear in search. We do
            not show your contact details.
          </Text>
        </View>

        <Text style={styles.footnote}>
          Times are approximate. Final pickup order and pricing follow Poolyn after someone books a seat.
        </Text>

        <Text style={styles.label}>Notes for riders (optional)</Text>
        <Text style={styles.hint}>
          Stops, breaks, or route hints. Shown to colleagues who find this trip in search (not for contact details).
        </Text>
        <TextInput
          style={styles.notesInput}
          placeholder="e.g. Extra breaks on long legs, passing through City X"
          placeholderTextColor={Colors.textTertiary}
          value={listingNotes}
          onChangeText={setListingNotes}
          multiline
          maxLength={ADHOC_LISTING_NOTES_MAX_CHARS}
        />

        <TouchableOpacity
          style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
          disabled={submitting}
          onPress={() => void onSubmit()}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryBtnText}>Post trip</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <MapPinPickerModal
        visible={mapTarget !== null}
        initialLat={mapTarget === "dest" && dest ? dest.lat : mapTarget === "origin" && origin ? origin.lat : initialLat}
        initialLng={mapTarget === "dest" && dest ? dest.lng : mapTarget === "origin" && origin ? origin.lng : initialLng}
        onClose={() => setMapTarget(null)}
        onConfirm={(lat, lng, address) => {
          const label = address.trim();
          if (mapTarget === "origin") setOrigin({ lat, lng, label });
          if (mapTarget === "dest") setDest({ lat, lng, label });
          setMapTarget(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.xl, paddingBottom: Spacing["3xl"] },
  titleInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  lead: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
    marginTop: Spacing.md,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    lineHeight: 17,
  },
  disclosure: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: "rgba(11, 132, 87, 0.07)",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.22)",
  },
  disclosureText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
  },
  timeVal: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, color: Colors.primaryDark, minWidth: 100, textAlign: "center" },
  minRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.sm, justifyContent: "center" },
  minChip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  minChipOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  minChipText: { fontSize: FontSize.sm, color: Colors.text },
  minChipTextOn: { fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    flexWrap: "wrap",
  },
  stepVal: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, minWidth: 36, textAlign: "center" },
  stepHint: { fontSize: FontSize.xs, color: Colors.textTertiary, flex: 1 },
  footnote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    backgroundColor: Colors.surface,
    minHeight: 88,
    textAlignVertical: "top",
  },
  primaryBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  blocked: { padding: Spacing.xl, alignItems: "center" },
  blockedTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, marginTop: Spacing.md },
  blockedBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm, lineHeight: 20 },
});
