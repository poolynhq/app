import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { showAlert } from "@/lib/platformAlert";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { MapPinPickerModal } from "@/components/maps/MapPinPickerModal";
import { AdhocMonthCalendar } from "@/components/rides/AdhocMonthCalendar";
import { AdhocPlaceInput, type PlacePin } from "@/components/rides/AdhocPlaceInput";
import {
  ADHOC_SEAT_REQUEST_MESSAGE_MAX_CHARS,
  localCalendarDateString,
  poolynSearchAdhocListings,
  poolynRequestAdhocSeat,
  type AdhocSearchListingRow,
} from "@/lib/adhocPoolyn";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ADHOC_PIN_PRECISION_HINT_KEY = "poolyn_adhoc_pin_precision_hint_v1";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function formatDepart(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function driverDisplayName(r: AdhocSearchListingRow): string {
  const t = (r.driver_full_name ?? "").trim();
  if (t) return t;
  return (r.driver_first_name ?? "Driver").trim();
}

function vehicleLine(r: AdhocSearchListingRow): string {
  const mm = [r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ").trim();
  const base = mm || r.vehicle_label.trim();
  return r.vehicle_colour ? `${base} · ${r.vehicle_colour}` : base;
}

export default function SearchSeatScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  useEffect(() => {
    void (async () => {
      try {
        const seen = await AsyncStorage.getItem(ADHOC_PIN_PRECISION_HINT_KEY);
        if (seen === "1") return;
        await AsyncStorage.setItem(ADHOC_PIN_PRECISION_HINT_KEY, "1");
        showAlert(
          "Use clear pins",
          "Pick leaving and going points as close to your real start and end as you can. Suburb centres work for search, but street-level pins reduce surprise detours for drivers and keep your cost estimate closer to the final trip share."
        );
      } catch {
        /* ignore */
      }
    })();
  }, []);
  const home = parseGeoPoint(profile?.home_location as unknown);
  const initialLat = home?.lat ?? -37.8136;
  const initialLng = home?.lng ?? 144.9631;
  const proximity = `${initialLng},${initialLat}`;

  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [riderFlexDays, setRiderFlexDays] = useState(0);
  const [origin, setOrigin] = useState<PlacePin | null>(null);
  const [dest, setDest] = useState<PlacePin | null>(null);
  const [mapTarget, setMapTarget] = useState<"origin" | "dest" | "pickup" | null>(null);
  const [needsBaggage, setNeedsBaggage] = useState(false);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdhocSearchListingRow[]>([]);

  const [selected, setSelected] = useState<AdhocSearchListingRow | null>(null);
  const [pickup, setPickup] = useState<PlacePin | null>(null);
  const [bookMsg, setBookMsg] = useState("");
  const [booking, setBooking] = useState(false);

  const riderDateRange = useMemo(() => {
    const from = startOfDay(addDays(selectedDate, -riderFlexDays));
    const to = startOfDay(addDays(selectedDate, riderFlexDays));
    return {
      riderDateFrom: localCalendarDateString(from),
      riderDateTo: localCalendarDateString(to),
    };
  }, [selectedDate, riderFlexDays]);

  const onSearch = useCallback(async () => {
    if (!origin || !dest) {
      showAlert("Search", "Choose both leaving near and going near using search or the map.");
      return;
    }
    setSearching(true);
    const rows = await poolynSearchAdhocListings({
      riderDateFrom: riderDateRange.riderDateFrom,
      riderDateTo: riderDateRange.riderDateTo,
      nearOriginLat: origin.lat,
      nearOriginLng: origin.lng,
      nearDestLat: dest.lat,
      nearDestLng: dest.lng,
      needsBaggage,
    });
    setResults(rows);
    setSearching(false);
    if (rows.length === 0) {
      showAlert("No trips", "Try another date, widen your map pins, or uncheck baggage if you do not need it.");
    }
  }, [origin, dest, riderDateRange, needsBaggage]);

  function openBook(row: AdhocSearchListingRow) {
    setSelected(row);
    setPickup(origin);
    setBookMsg("");
  }

  async function confirmBook() {
    if (!selected || !pickup || !dest || !origin) return;
    setBooking(true);
    const res = await poolynRequestAdhocSeat({
      rideId: selected.ride_id,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      message: bookMsg,
      needsBaggage,
      searchDestLat: dest.lat,
      searchDestLng: dest.lng,
      searchOriginLabel: origin.label,
      searchDestLabel: dest.label,
    });
    setBooking(false);
    if (res.ok) {
      setSelected(null);
      showAlert(
        "Request sent",
        "The driver will accept or decline in My rides. If they accept, use Messages on this ride to coordinate in Poolyn.",
        [{ text: "OK", onPress: () => router.push("/(tabs)/rides") }]
      );
    } else {
      showAlert("Could not book", res.reason);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Search uses your dates, your workplace network, and a corridor along each driver&apos;s route. Your
          leaving pin can sit partway along their trip (for example between two cities), not only near where they
          start. Precise map pins keep detours predictable for everyone.
        </Text>

        <Text style={styles.label}>Date</Text>
        <AdhocMonthCalendar value={selectedDate} onChange={setSelectedDate} />

        <Text style={styles.label}>I&apos;m flexible up to (search)</Text>
        <Text style={styles.hint}>
          Include trips up to this many whole days before or after the date above (matches drivers who set their own
          flexibility).
        </Text>
        <View style={styles.flexRow}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setRiderFlexDays((d) => Math.max(0, d - 1))}
          >
            <Ionicons name="remove" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.flexVal}>± {riderFlexDays} day{riderFlexDays === 1 ? "" : "s"}</Text>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setRiderFlexDays((d) => Math.min(3, d + 1))}
          >
            <Ionicons name="add" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.flexHint}>Up to 3</Text>
        </View>

        <AdhocPlaceInput
          label="Leaving near"
          mapAccessibilityLabel="Pick leaving area on map"
          value={origin}
          onChange={setOrigin}
          onOpenMap={() => setMapTarget("origin")}
          proximity={proximity}
          placeholder="City or address (e.g. San Francisco, etc.)"
        />

        <AdhocPlaceInput
          label="Going near"
          mapAccessibilityLabel="Pick destination area on map"
          value={dest}
          onChange={setDest}
          onOpenMap={() => setMapTarget("dest")}
          proximity={proximity}
          placeholder="City or address"
        />

        <Pressable style={styles.bagRow} onPress={() => setNeedsBaggage((v) => !v)}>
          <Ionicons
            name={needsBaggage ? "checkbox" : "square-outline"}
            size={24}
            color={needsBaggage ? Colors.primary : Colors.textTertiary}
          />
          <View style={styles.bagTextCol}>
            <Text style={styles.bagTitle}>I need checked-bag-sized space</Text>
            <Text style={styles.bagFoot}>
              For both sides: baggage means about one airline checked bag size. Drivers only offer what they can
              safely carry. Poolyn does not measure bags in the app.
            </Text>
          </View>
        </Pressable>

        <TouchableOpacity
          style={[styles.searchBtn, searching && styles.searchBtnDisabled]}
          disabled={searching}
          onPress={() => void onSearch()}
        >
          {searching ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="search" size={20} color={Colors.textOnPrimary} />
              <Text style={styles.searchBtnText}>Search trips</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.searchHint}>
          Trips you posted yourself are not listed here. Open My rides, Active, to see dated trips you are driving.
        </Text>

        {results.length > 0 ? (
          <View style={styles.results}>
            <Text style={styles.resultsTitle}>Trips ({results.length})</Text>
            {results.map((r) => (
              <TouchableOpacity key={r.ride_id} style={styles.card} onPress={() => openBook(r)} activeOpacity={0.85}>
                {r.adhoc_trip_title ? (
                  <Text style={styles.cardTripTitle}>{r.adhoc_trip_title}</Text>
                ) : null}
                <Text style={styles.cardName}>{driverDisplayName(r)}</Text>
                {r.organisation_name ? (
                  <Text style={styles.cardOrg}>{r.organisation_name}</Text>
                ) : null}
                <Text style={styles.cardVehicle}>{vehicleLine(r)}</Text>
                <Text style={styles.cardMeta}>{formatDepart(r.depart_at)}</Text>
                <Text style={styles.cardSub}>
                  {(r.adhoc_origin_label ?? "Start").trim()} → {(r.adhoc_destination_label ?? "End").trim()}
                </Text>
                {r.listing_notes?.trim() ? (
                  <Text style={styles.cardNotes}>{r.listing_notes.trim()}</Text>
                ) : null}
                <Text style={styles.cardHint}>
                  {r.seats_available} seat{r.seats_available === 1 ? "" : "s"} · {r.baggage_slots_available} bag
                  slot{r.baggage_slots_available === 1 ? "" : "s"}
                </Text>
                <Text style={styles.cardHint}>
                  About {r.driver_start_km_from_search_origin} km from your leaving pin to their start ·{" "}
                  {r.driver_end_km_from_search_dest} km from your destination pin to their end (straight line).
                </Text>
                {typeof r.estimated_contribution_cents_preview === "number" &&
                r.estimated_contribution_cents_preview > 0 ? (
                  <Text style={styles.cardEstimate}>
                    Preview trip share about ${(r.estimated_contribution_cents_preview / 100).toFixed(2)} (based on
                    your search corridor). Final amount uses your pickup and drop pins after the driver accepts.
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={selected !== null} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Request a seat</Text>
            {selected ? (
              <>
                {selected.adhoc_trip_title ? (
                  <Text style={styles.modalTripTitle}>{selected.adhoc_trip_title}</Text>
                ) : null}
                <Text style={styles.modalName}>{driverDisplayName(selected)}</Text>
                {selected.organisation_name ? (
                  <Text style={styles.modalOrg}>{selected.organisation_name}</Text>
                ) : null}
                <Text style={styles.modalVehicle}>{vehicleLine(selected)}</Text>
                {selected.listing_notes?.trim() ? (
                  <Text style={styles.modalNotes}>{selected.listing_notes.trim()}</Text>
                ) : null}
                <Text style={styles.modalWarn}>
                  Extra distance to pick you up can change your share of the trip cost. Straight-line distances are
                  hints only. Final pricing is in Poolyn when the driver accepts.
                </Text>
                <AdhocPlaceInput
                  label="Your pickup point"
                  mapAccessibilityLabel="Adjust pickup on map"
                  value={pickup}
                  onChange={setPickup}
                  onOpenMap={() => setMapTarget("pickup")}
                  proximity={proximity}
                  placeholder="Where you want to be picked up"
                />
                <Text style={styles.modalLabel}>Message to the driver</Text>
                <TextInput
                  style={styles.msgInput}
                  placeholder="e.g. I will be at the side entrance"
                  placeholderTextColor={Colors.textTertiary}
                  value={bookMsg}
                  onChangeText={setBookMsg}
                  multiline
                  maxLength={ADHOC_SEAT_REQUEST_MESSAGE_MAX_CHARS}
                />
                <Text style={styles.modalFoot}>
                  No phone numbers or email. The driver sees your first name from your profile and this note in
                  Poolyn only.
                </Text>
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancel} onPress={() => setSelected(null)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, booking && styles.searchBtnDisabled]}
                    disabled={booking}
                    onPress={() => void confirmBook()}
                  >
                    {booking ? (
                      <ActivityIndicator color={Colors.textOnPrimary} />
                    ) : (
                      <Text style={styles.modalConfirmText}>Send request</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <MapPinPickerModal
        visible={mapTarget !== null}
        initialLat={
          mapTarget === "dest" && dest
            ? dest.lat
            : mapTarget === "pickup" && pickup
              ? pickup.lat
              : mapTarget === "origin" && origin
                ? origin.lat
                : initialLat
        }
        initialLng={
          mapTarget === "dest" && dest
            ? dest.lng
            : mapTarget === "pickup" && pickup
              ? pickup.lng
              : mapTarget === "origin" && origin
                ? origin.lng
                : initialLng
        }
        onClose={() => setMapTarget(null)}
        onConfirm={(lat, lng, address) => {
          const label = address.trim();
          if (mapTarget === "origin") setOrigin({ lat, lng, label });
          if (mapTarget === "dest") setDest({ lat, lng, label });
          if (mapTarget === "pickup") setPickup({ lat, lng, label });
          setMapTarget(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: Spacing.sm,
    gap: 2,
  },
  backText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  scroll: { padding: Spacing.xl, paddingBottom: Spacing["3xl"] },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    lineHeight: 17,
  },
  flexRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    flexWrap: "wrap",
    marginBottom: Spacing.sm,
  },
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
  flexVal: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, minWidth: 100 },
  flexHint: { fontSize: FontSize.xs, color: Colors.textTertiary, flex: 1 },
  lead: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  bagRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: "rgba(11, 132, 87, 0.06)",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bagTextCol: { flex: 1 },
  bagTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  bagFoot: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs, lineHeight: 17 },
  searchBtn: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    minHeight: 48,
  },
  searchBtnDisabled: { opacity: 0.6 },
  searchBtnText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  searchHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  results: { marginTop: Spacing.xl },
  resultsTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, marginBottom: Spacing.sm },
  card: {
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  cardTripTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.xs,
  },
  cardName: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  cardOrg: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  cardVehicle: { fontSize: FontSize.sm, color: Colors.text, marginTop: 4 },
  cardMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
  cardSub: { fontSize: FontSize.sm, color: Colors.text, marginTop: 4 },
  cardNotes: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    fontStyle: "italic",
    lineHeight: 18,
  },
  cardHint: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.xs, lineHeight: 16 },
  cardEstimate: {
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    marginTop: Spacing.sm,
    lineHeight: 17,
    fontWeight: FontWeight.semibold,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing["2xl"],
    maxHeight: "92%",
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.sm },
  modalTripTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.sm,
  },
  modalName: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  modalOrg: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  modalVehicle: { fontSize: FontSize.sm, color: Colors.text, marginTop: 6 },
  modalNotes: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    fontStyle: "italic",
    lineHeight: 20,
  },
  modalWarn: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  modalLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  msgInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalFoot: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
    lineHeight: 16,
  },
  modalActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.lg },
  modalCancel: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalCancelText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  modalConfirm: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    minHeight: 48,
  },
  modalConfirmText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
});
