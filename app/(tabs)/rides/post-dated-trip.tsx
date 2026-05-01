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
import { supabase } from "@/lib/supabase";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { MapPinPickerModal } from "@/components/maps/MapPinPickerModal";
import { AdhocMonthCalendar } from "@/components/rides/AdhocMonthCalendar";
import { AdhocPlaceInput, type PlacePin } from "@/components/rides/AdhocPlaceInput";
import { ADHOC_LISTING_NOTES_MAX_CHARS, localCalendarDateString, poolynCreateAdhocListing, poolynCreateAdhocRecurringSeries } from "@/lib/adhocPoolyn";
import { openDriverBankConnectSetup } from "@/lib/ridePassengerPayment";
import { userTripPayoutsReady } from "@/lib/userTripPayouts";
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

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** Local date + clock time on that calendar day. */
function combineDateAndTime(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** Cap total listings created in one submit (each round trip counts as two). */
const MAX_ADHOC_LISTINGS_PER_SUBMIT = 24;

function splitCents(total: number): [number, number] {
  const a = Math.ceil(total / 2);
  const b = Math.floor(total / 2);
  return [a, b];
}

/**
 * Dates from `fromDay` through `untilDay` inclusive where `getDay()` is in `weekdays`,
 * sorted ascending. Stops after `maxDates` entries.
 */
function enumerateWeeklyDates(fromDay: Date, untilDay: Date, weekdays: Set<number>, maxDates: number): Date[] {
  const out: Date[] = [];
  const start = startOfDay(fromDay).getTime();
  const end = startOfDay(untilDay).getTime();
  if (end < start) return out;
  const cur = new Date(start);
  while (cur.getTime() <= end && out.length < maxDates) {
    if (weekdays.has(cur.getDay())) {
      out.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Anchor date then every 14 days until end date. */
function enumerateFortnightly(anchor: Date, untilDay: Date, maxDates: number): Date[] {
  const out: Date[] = [];
  const end = startOfDay(untilDay).getTime();
  let cur = startOfDay(anchor);
  while (out.length < maxDates && cur.getTime() <= end) {
    out.push(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()));
    cur = addDays(cur, 14);
  }
  return out;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** Same calendar day-of-month each month (clamped), from anchor month through untilDay. */
function enumerateMonthlySameDom(anchor: Date, untilDay: Date, maxDates: number): Date[] {
  const out: Date[] = [];
  const end = startOfDay(untilDay).getTime();
  const startTs = startOfDay(anchor).getTime();
  const dom = anchor.getDate();
  let y = anchor.getFullYear();
  let mo = anchor.getMonth();
  while (out.length < maxDates) {
    const dim = daysInMonth(y, mo);
    const d = startOfDay(new Date(y, mo, Math.min(dom, dim)));
    const t = d.getTime();
    if (t > end) break;
    if (t >= startTs) {
      out.push(d);
    }
    mo++;
    if (mo > 11) {
      mo = 0;
      y++;
    }
  }
  return out;
}

type TripDirection = "one_way" | "round_trip";
type TripFrequency = "one_off" | "recurring";
type RecurrencePattern = "weekly" | "fortnightly" | "monthly";

const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
};

/** Parses a dollars string to whole cents (AUD), clamped to migration limits. */
function parseDollarsToCents(raw: string): number {
  const t = raw.trim().replace(/[^0-9.]/g, "");
  if (!t) return 0;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(5_000_000, Math.round(n * 100));
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

  const [tripDirection, setTripDirection] = useState<TripDirection>("one_way");
  /** Return date (one-off round trip) or ignored when recurring (return uses same calendar day as each outbound). */
  const [returnDate, setReturnDate] = useState(() => startOfDay(new Date()));
  const [returnH, setReturnH] = useState(15);
  const [returnM, setReturnM] = useState(0);

  const [frequency, setFrequency] = useState<TripFrequency>("one_off");
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("weekly");
  const [patternPickerOpen, setPatternPickerOpen] = useState(false);

  const [repeatUntil, setRepeatUntil] = useState(() => startOfDay(addDays(new Date(), 28)));

  const [origin, setOrigin] = useState<PlacePin | null>(null);
  const [dest, setDest] = useState<PlacePin | null>(null);
  const [mapTarget, setMapTarget] = useState<"origin" | "dest" | null>(null);

  const [seats, setSeats] = useState(1);
  const [bagSlots, setBagSlots] = useState(0);
  const [listingNotes, setListingNotes] = useState("");
  const [tollDollars, setTollDollars] = useState("");
  const [parkingDollars, setParkingDollars] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const roundTrip = tripDirection === "round_trip";
  const recurring = frequency === "recurring";

  const occurrenceDates = useMemo(() => {
    if (!recurring) {
      return [startOfDay(selectedDate)];
    }
    const maxDates = Math.ceil(MAX_ADHOC_LISTINGS_PER_SUBMIT / (roundTrip ? 2 : 1));
    if (recurrencePattern === "weekly") {
      const anchorWeekday = startOfDay(selectedDate).getDay();
      return enumerateWeeklyDates(selectedDate, repeatUntil, new Set([anchorWeekday]), maxDates);
    }
    if (recurrencePattern === "fortnightly") {
      return enumerateFortnightly(selectedDate, repeatUntil, maxDates);
    }
    return enumerateMonthlySameDom(selectedDate, repeatUntil, maxDates);
  }, [
    recurring,
    recurrencePattern,
    selectedDate,
    repeatUntil,
    roundTrip,
  ]);

  const scheduledListingCount = useMemo(
    () => occurrenceDates.length * (roundTrip ? 2 : 1),
    [occurrenceDates, roundTrip]
  );

  const recurrenceSummaryLine = useMemo(() => {
    if (!recurring) return null;
    const n = occurrenceDates.length;
    const patternWord = RECURRENCE_LABELS[recurrencePattern].toLowerCase();
    const until = repeatUntil.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (roundTrip) {
      return `This recurring plan includes ${n} ${patternWord} outbound dates (${scheduledListingCount} listings counting outbound and return) through ${until}.`;
    }
    return `This recurring plan includes ${n} ${patternWord} outings through ${until}.`;
  }, [
    recurring,
    recurrencePattern,
    occurrenceDates.length,
    repeatUntil,
    roundTrip,
    scheduledListingCount,
  ]);

  /** Keep one-off return date from sliding before outbound date. */
  useEffect(() => {
    if (!roundTrip || recurring) return;
    setReturnDate((rd) => {
      if (startOfDay(rd).getTime() < startOfDay(selectedDate).getTime()) return startOfDay(selectedDate);
      return rd;
    });
  }, [selectedDate, roundTrip, recurring]);

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
    if (recurring) {
      if (startOfDay(repeatUntil).getTime() < startOfDay(selectedDate).getTime()) {
        showAlert("Repeat until", "Choose an end date on or after the first trip date.");
        return;
      }
      if (occurrenceDates.length === 0) {
        showAlert(
          "Repeat",
          "No dates match your repeat rule in that range. Adjust dates or pattern."
        );
        return;
      }
    }

    const tollCents = parseDollarsToCents(tollDollars);
    const parkingCents = parseDollarsToCents(parkingDollars);
    const tollSplit =
      roundTrip && tollCents > 0 ? splitCents(tollCents) : ([tollCents, 0] as [number, number]);
    const parkSplit =
      roundTrip && parkingCents > 0 ? splitCents(parkingCents) : ([parkingCents, 0] as [number, number]);
    const [tollOut, tollRet] = tollSplit;
    const [parkOut, parkRet] = parkSplit;

    type Leg = {
      departAt: Date;
      originPin: PlacePin;
      destPin: PlacePin;
      toll: number;
      park: number;
      title: string | null;
    };
    const legs: Leg[] = [];
    const titleBase = tripTitle.trim() || null;

    for (const day of occurrenceDates) {
      const outboundDepart = combineDateAndTime(day, departH, departM);
      legs.push({
        departAt: outboundDepart,
        originPin: origin,
        destPin: dest,
        toll: tollOut,
        park: parkOut,
        title: titleBase,
      });
      if (roundTrip) {
        const retDepart = recurring
          ? combineDateAndTime(day, returnH, returnM)
          : combineDateAndTime(returnDate, returnH, returnM);
        if (retDepart.getTime() <= outboundDepart.getTime()) {
          showAlert(
            "Return time",
            recurring
              ? "Return must be later than outbound on each trip day."
              : "Return date and time must be after your outbound departure."
          );
          return;
        }
        legs.push({
          departAt: retDepart,
          originPin: dest,
          destPin: origin,
          toll: tollRet,
          park: parkRet,
          title: titleBase ? `${titleBase} (return)`.slice(0, 120) : "Return leg",
        });
      }
    }

    const pastOk = Date.now() - 60_000;
    for (const leg of legs) {
      if (leg.departAt.getTime() < pastOk) {
        showAlert("Time", "Pick departure times in the future for every trip.");
        return;
      }
    }

    setSubmitting(true);

    let recurringSeriesId: string | undefined;
    if (recurring) {
      const sr = await poolynCreateAdhocRecurringSeries({
        recurrencePattern,
        anchorDate: localCalendarDateString(selectedDate),
        repeatUntilDate: localCalendarDateString(repeatUntil),
        isRoundTrip: roundTrip,
      });
      if (!sr.ok) {
        setSubmitting(false);
        showAlert("Recurring trip", sr.reason);
        return;
      }
      recurringSeriesId = sr.seriesId;
    }

    let posted = 0;
    let firstErr = "";
    for (const leg of legs) {
      const res = await poolynCreateAdhocListing({
        departAt: leg.departAt,
        originLat: leg.originPin.lat,
        originLng: leg.originPin.lng,
        destLat: leg.destPin.lat,
        destLng: leg.destPin.lng,
        originLabel: leg.originPin.label,
        destLabel: leg.destPin.label,
        passengerSeatsAvailable: seats,
        baggageSlots: bagSlots,
        tripTitle: leg.title,
        departFlexDays,
        listingNotes: listingNotes.trim() || null,
        tollCents: leg.toll > 0 ? leg.toll : undefined,
        parkingCents: leg.park > 0 ? leg.park : undefined,
        adhocRecurringSeriesId: recurringSeriesId,
      });
      if (res.ok) {
        posted++;
      } else if (!firstErr) {
        firstErr = res.reason;
      }
    }
    setSubmitting(false);

    if (posted === legs.length) {
      let msg: string;
      if (recurring) {
        msg = `Your recurring trip is live with ${occurrenceDates.length} outings (${posted} listings). Colleagues can search each date.`;
      } else if (legs.length === 1) {
        msg = "Your trip is live for colleagues to find under Search for a seat.";
      } else {
        msg = `${posted} trips are live for colleagues to find under Search for a seat.`;
      }
      showAlert("Posted", msg, [{ text: "OK", onPress: () => router.back() }]);
      return;
    }
    if (posted === 0) {
      const map: Record<string, string> = {
        no_vehicle: "Add an active vehicle with at least two total seats under Profile first.",
        bad_depart_time: "Pick a future departure time.",
        no_org: "Join a workplace on Poolyn before posting.",
        payouts_not_ready:
          "Finish bank connection in Poolyn so colleagues can pay by card for this trip. It only runs when you choose to host.",
      };
      const msg = map[firstErr] ?? firstErr;
      if (firstErr === "payouts_not_ready") {
        showAlert("Bank setup required", msg, [
          { text: "Not now", style: "cancel" },
          { text: "Connect bank", onPress: () => void openDriverBankConnectSetup() },
        ]);
      } else {
        showAlert("Could not post", msg);
      }
      return;
    }
    showAlert(
      "Partially posted",
      `${posted} of ${legs.length} trips were posted.${firstErr ? ` Last error: ${firstErr}` : ""} Check My rides for what went live.`,
      [{ text: "OK", onPress: () => router.back() }]
    );
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
          <Text style={styles.blockedTitle}>Driver profile needed</Text>
          <Text style={styles.blockedBody}>
            Add a vehicle with at least two seats to host a dated trip. You can still join rides as a rider first.
          </Text>
          <TouchableOpacity
            style={styles.blockedCta}
            onPress={() => router.push("/(tabs)/profile/driver-setup")}
            activeOpacity={0.85}
          >
            <Text style={styles.blockedCtaText}>Start driving</Text>
          </TouchableOpacity>
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
          Set where you are leaving from, where you are going, and when. Choose one way or a return leg, and a single
          date or a repeating pattern. Colleagues in your workplace can search and request a seat.
        </Text>

        {profile && !userTripPayoutsReady(profile) ? (
          <View style={styles.payoutBanner}>
            <Ionicons name="card-outline" size={22} color={Colors.primary} />
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <Text style={styles.payoutBannerTitle}>Receiving trip costs</Text>
              <Text style={styles.payoutBannerBody}>
                Each rider pays through Stripe to your Connect account. Transfers to your bank run on a weekly
                schedule (for example Saturdays) after you connect your bank.
              </Text>
              <TouchableOpacity onPress={() => void openDriverBankConnectSetup()} activeOpacity={0.75}>
                <Text style={styles.payoutBannerLink}>Connect your bank</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <Text style={styles.label}>Trip type</Text>
        <View style={styles.radioCard}>
          <Pressable
            style={[styles.radioInlineHalf, tripDirection === "one_way" && styles.radioInlineHalfOn]}
            onPress={() => setTripDirection("one_way")}
            accessibilityRole="radio"
            accessibilityState={{ selected: tripDirection === "one_way" }}
          >
            <View style={[styles.radioOuter, tripDirection === "one_way" && styles.radioOuterOn]}>
              {tripDirection === "one_way" ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.radioTitle}>One way</Text>
          </Pressable>
          <View style={styles.radioDivider} />
          <Pressable
            style={[styles.radioInlineHalf, tripDirection === "round_trip" && styles.radioInlineHalfOn]}
            onPress={() => setTripDirection("round_trip")}
            accessibilityRole="radio"
            accessibilityState={{ selected: tripDirection === "round_trip" }}
          >
            <View style={[styles.radioOuter, tripDirection === "round_trip" && styles.radioOuterOn]}>
              {tripDirection === "round_trip" ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.radioTitle}>Round trip</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Frequency</Text>
        <View style={styles.radioCard}>
          <Pressable
            style={[styles.radioInlineHalf, frequency === "one_off" && styles.radioInlineHalfOn]}
            onPress={() => setFrequency("one_off")}
            accessibilityRole="radio"
            accessibilityState={{ selected: frequency === "one_off" }}
          >
            <View style={[styles.radioOuter, frequency === "one_off" && styles.radioOuterOn]}>
              {frequency === "one_off" ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.radioTitle}>One-off</Text>
          </Pressable>
          <View style={styles.radioDivider} />
          <Pressable
            style={[styles.radioInlineHalf, frequency === "recurring" && styles.radioInlineHalfOn]}
            onPress={() => {
              setFrequency("recurring");
              const sel = startOfDay(selectedDate).getTime();
              if (startOfDay(repeatUntil).getTime() < sel) {
                setRepeatUntil(startOfDay(addDays(selectedDate, 28)));
              }
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: frequency === "recurring" }}
          >
            <View style={[styles.radioOuter, frequency === "recurring" && styles.radioOuterOn]}>
              {frequency === "recurring" ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.radioTitle}>Recurring</Text>
          </Pressable>
        </View>

        {recurring ? (
          <>
            <Text style={styles.label}>Repeat pattern</Text>
            <Pressable
              style={styles.patternPickerBtn}
              onPress={() => setPatternPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose repeat pattern"
            >
              <Text style={styles.patternPickerValue}>{RECURRENCE_LABELS[recurrencePattern]}</Text>
              <Ionicons name="chevron-down" size={22} color={Colors.primary} />
            </Pressable>
          </>
        ) : null}

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

        {roundTrip && !recurring ? (
          <>
            <Text style={styles.label}>Return date</Text>
            <AdhocMonthCalendar value={returnDate} onChange={setReturnDate} />
          </>
        ) : null}

        {roundTrip ? (
          <>
            <Text style={styles.label}>Return departure</Text>
            <View style={styles.timeRow}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setReturnH((h) => (h <= 0 ? 23 : h - 1))}>
                <Ionicons name="remove" size={22} color={Colors.primary} />
              </TouchableOpacity>
              <Text style={styles.timeVal}>
                {String(returnH).padStart(2, "0")}:{String(returnM).padStart(2, "0")}
              </Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setReturnH((h) => (h >= 23 ? 0 : h + 1))}>
                <Ionicons name="add" size={22} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={styles.minRow}>
              {([0, 15, 30, 45] as const).map((m) => (
                <TouchableOpacity
                  key={`ret-${m}`}
                  style={[styles.minChip, returnM === m && styles.minChipOn]}
                  onPress={() => setReturnM(m)}
                >
                  <Text style={[styles.minChipText, returnM === m && styles.minChipTextOn]}>
                    :{String(m).padStart(2, "0")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

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

        {recurring ? (
          <>
            <Text style={styles.label}>Repeat until</Text>
            <AdhocMonthCalendar value={repeatUntil} onChange={setRepeatUntil} maxDaysAhead={365} />
            {recurrenceSummaryLine ? (
              <Text style={styles.recurrenceSummary}>{recurrenceSummaryLine}</Text>
            ) : null}
          </>
        ) : null}

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

        <View style={styles.optionalCostRow}>
          <Text style={styles.label}>Toll (optional)</Text>
          <TouchableOpacity
            onPress={() =>
              showAlert("Tolls", "Tolls will be shared among riders on this trip.")
            }
            hitSlop={12}
            accessibilityLabel="About tolls"
          >
            <Ionicons name="information-circle-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.currencyInput}
          placeholder="0.00"
          placeholderTextColor={Colors.textTertiary}
          value={tollDollars}
          onChangeText={setTollDollars}
          keyboardType="decimal-pad"
        />

        <View style={styles.optionalCostRow}>
          <Text style={styles.label}>Parking (optional)</Text>
          <TouchableOpacity
            onPress={() =>
              showAlert(
                "Parking",
                "Parking costs will be shared across riders. Enter the total parking cost for this trip."
              )
            }
            hitSlop={12}
            accessibilityLabel="About parking"
          >
            <Ionicons name="information-circle-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.currencyInput}
          placeholder="0.00"
          placeholderTextColor={Colors.textTertiary}
          value={parkingDollars}
          onChangeText={setParkingDollars}
          keyboardType="decimal-pad"
        />

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
          ) : recurring ? (
            <Text style={styles.primaryBtnText}>Post recurring trip</Text>
          ) : scheduledListingCount > 1 ? (
            <Text style={styles.primaryBtnText}>{`Post ${scheduledListingCount} trips`}</Text>
          ) : (
            <Text style={styles.primaryBtnText}>Post trip</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={patternPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPatternPickerOpen(false)}
      >
        <View style={styles.patternModalRoot}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setPatternPickerOpen(false)}
          />
          <View style={styles.patternModalCenter} pointerEvents="box-none">
            <View style={styles.modalSheet}>
              <Text style={styles.modalSheetTitle}>Repeat pattern</Text>
              {(["weekly", "fortnightly", "monthly"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.modalOption, recurrencePattern === p && styles.modalOptionOn]}
                  onPress={() => {
                    setRecurrencePattern(p);
                    setPatternPickerOpen(false);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.modalOptionText}>{RECURRENCE_LABELS[p]}</Text>
                  {recurrencePattern === p ? (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                  ) : (
                    <View style={{ width: 22 }} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

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
  radioCard: {
    flexDirection: "row",
    alignItems: "stretch",
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  radioInlineHalf: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  radioInlineHalfOn: {
    backgroundColor: Colors.primaryLight,
  },
  radioDivider: {
    width: 1,
    backgroundColor: Colors.border,
    alignSelf: "stretch",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  radioOuterOn: {
    borderColor: Colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  radioTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  patternPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  patternPickerValue: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  patternModalRoot: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  patternModalCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalSheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalSheetTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  modalOptionOn: { backgroundColor: Colors.primaryLight },
  modalOptionText: { fontSize: FontSize.base, color: Colors.text, fontWeight: FontWeight.medium },
  recurrenceSummary: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
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
  payoutBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  payoutBannerTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text, marginBottom: 4 },
  payoutBannerBody: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18, marginBottom: Spacing.sm },
  payoutBannerLink: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
  optionalCostRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  currencyInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
    backgroundColor: Colors.surface,
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
  blockedCta: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.md,
  },
  blockedCtaText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
});
