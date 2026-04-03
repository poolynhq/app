import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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

const ALL_DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

const DEPART_TIMES = [
  "05:30", "06:00", "06:30", "07:00", "07:30",
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
];
const RETURN_TIMES = [
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00",
];

function formatTime(t: string) {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? "pm" : "am";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${suffix}`;
}

type DayKey = (typeof ALL_DAYS)[number]["key"];

interface DaySchedule {
  depart: string;
  return: string;
}

const RELIABILITY_OPTIONS = [
  {
    value: "always",
    label: "Very reliable",
    desc: "I almost never change plans last minute",
    icon: "shield-checkmark-outline" as const,
  },
  {
    value: "mostly",
    label: "Mostly reliable",
    desc: "Occasional changes, but I give notice",
    icon: "thumbs-up-outline" as const,
  },
  {
    value: "flexible",
    label: "My schedule varies",
    desc: "Things change often. I need flexibility",
    icon: "shuffle-outline" as const,
  },
];

export default function ScheduleSetup() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();

  const [selectedDays, setSelectedDays] = useState<Set<DayKey>>(
    new Set(["mon", "tue", "wed", "thu", "fri"])
  );
  const [sameEveryDay, setSameEveryDay] = useState(true);
  const [defaultDepart, setDefaultDepart] = useState("08:00");
  const [defaultReturn, setDefaultReturn] = useState("17:00");
  const [perDaySchedule, setPerDaySchedule] = useState<
    Record<DayKey, DaySchedule>
  >({
    mon: { depart: "08:00", return: "17:00" },
    tue: { depart: "08:00", return: "17:00" },
    wed: { depart: "08:00", return: "17:00" },
    thu: { depart: "08:00", return: "17:00" },
    fri: { depart: "08:00", return: "17:00" },
    sat: { depart: "09:00", return: "14:00" },
    sun: { depart: "09:00", return: "14:00" },
  });
  const [reliability, setReliability] = useState("mostly");
  const [flexibilityEnabled, setFlexibilityEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [daysError, setDaysError] = useState("");
  const [timeError, setTimeError] = useState("");

  function toggleDay(day: DayKey) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function updateDayTime(day: DayKey, field: "depart" | "return", val: string) {
    setPerDaySchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: val },
    }));
  }

  const isDriverFlow = profile?.role === "driver" || profile?.role === "both";
  const totalSteps = isDriverFlow ? 4 : 3;

  function timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  async function handleContinue() {
    setDaysError("");
    setTimeError("");

    if (selectedDays.size === 0) {
      setDaysError("Please select at least one commute day.");
      return;
    }

    if (sameEveryDay) {
      if (timeToMinutes(defaultDepart) >= timeToMinutes(defaultReturn)) {
        setTimeError("Return time must be after departure time.");
        return;
      }
    } else {
      for (const day of selectedDays) {
        const sched = perDaySchedule[day];
        if (timeToMinutes(sched.depart) >= timeToMinutes(sched.return)) {
          const label = ALL_DAYS.find((d) => d.key === day)?.label ?? day;
          setTimeError(`${label}: return time must be after departure time.`);
          return;
        }
      }
    }

    setLoading(true);

    const weekdayTimes: Record<string, DaySchedule> = {};
    for (const day of selectedDays) {
      weekdayTimes[day] = sameEveryDay
        ? { depart: defaultDepart, return: defaultReturn }
        : perDaySchedule[day];
    }

    const baseToleranceMins =
      reliability === "always" ? 10 : reliability === "mostly" ? 15 : 30;
    const toleranceMins = baseToleranceMins + (flexibilityEnabled ? 15 : 0);
    const reliabilityScore =
      reliability === "always" ? 90 : reliability === "mostly" ? 75 : 55;

    if (profile?.id) {
      const { error: schedError } = await supabase.from("schedules").insert({
        user_id: profile.id,
        type: reliability === "flexible" ? "shift_window" : "fixed_weekly",
        weekday_times: weekdayTimes,
        tolerance_mins: toleranceMins,
      });

      if (schedError) {
        setLoading(false);
        showAlert("Something went wrong", "Could not save your schedule. Please try again.");
        return;
      }

      const { error: userError } = await supabase
        .from("users")
        .update({
          detour_tolerance_mins: toleranceMins,
          reliability_score: reliabilityScore,
          schedule_flex_mins: flexibilityEnabled ? 15 : 0,
        })
        .eq("id", profile.id);

      // Backward-compatible fallback when latest migration columns
      // are not yet present in the connected Supabase project.
      if (userError) {
        const { error: fallbackUserError } = await supabase
          .from("users")
          .update({
            detour_tolerance_mins: toleranceMins,
          })
          .eq("id", profile.id);

        if (fallbackUserError) {
          setLoading(false);
          showAlert("Something went wrong", "Could not update your preferences. Please try again.");
          return;
        }
      }
    }

    setLoading(false);

    if (isDriverFlow) {
      router.push("/(onboarding)/vehicle");
    } else {
      if (profile?.id) {
        await supabase
          .from("users")
          .update({ onboarding_completed: true })
          .eq("id", profile.id);
        await refreshProfile();
      }
      router.replace("/(onboarding)/complete");
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${(3 / totalSteps) * 100}%` }]} />
      </View>

      <Text style={styles.step}>Step 3 of {totalSteps}</Text>
      <Text style={styles.title}>Your commute schedule</Text>
      <Text style={styles.subtitle}>
        Set your usual travel times. Flex Credits let you adjust on the fly; no need to be exact.
      </Text>

      {/* Day selector */}
      <Text style={styles.sectionLabel}>Which days do you commute?</Text>
      <View style={styles.dayRow}>
        {ALL_DAYS.map((day) => {
          const active = selectedDays.has(day.key);
          return (
            <TouchableOpacity
              key={day.key}
              style={[styles.dayChip, active && styles.dayChipActive]}
              onPress={() => {
                toggleDay(day.key);
                if (daysError) setDaysError("");
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.dayLabel, active && styles.dayLabelActive]}>
                {day.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {daysError ? (
        <Text style={styles.validationError}>{daysError}</Text>
      ) : null}
      {timeError ? (
        <Text style={styles.validationError}>{timeError}</Text>
      ) : null}

      {/* Same every day toggle */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Same time every day</Text>
        <Switch
          value={sameEveryDay}
          onValueChange={setSameEveryDay}
          trackColor={{ false: Colors.border, true: Colors.primaryLight }}
          thumbColor={sameEveryDay ? Colors.primary : Colors.textTertiary}
        />
      </View>

      <View style={styles.toggleRow}>
        <View>
          <Text style={styles.toggleLabel}>+/- 15 min flexibility</Text>
          <Text style={styles.toggleHint}>
            Helps us find more route-compatible matches
          </Text>
        </View>
        <Switch
          value={flexibilityEnabled}
          onValueChange={setFlexibilityEnabled}
          trackColor={{ false: Colors.border, true: Colors.primaryLight }}
          thumbColor={flexibilityEnabled ? Colors.primary : Colors.textTertiary}
        />
      </View>

      {sameEveryDay ? (
        <View style={styles.timeSection}>
          <Text style={styles.timeLabel}>
            <Ionicons name="arrow-forward-circle" size={16} color={Colors.primary} />
            {"  "}Departure (to work)
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.timeChips}>
              {DEPART_TIMES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.timeChip,
                    defaultDepart === t && styles.timeChipActive,
                  ]}
                  onPress={() => setDefaultDepart(t)}
                >
                  <Text
                    style={[
                      styles.timeChipText,
                      defaultDepart === t && styles.timeChipTextActive,
                    ]}
                  >
                    {formatTime(t)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={[styles.timeLabel, { marginTop: Spacing.lg }]}>
            <Ionicons name="arrow-back-circle" size={16} color={Colors.accent} />
            {"  "}Return (from work)
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.timeChips}>
              {RETURN_TIMES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.timeChip,
                    defaultReturn === t && styles.timeChipActive,
                  ]}
                  onPress={() => setDefaultReturn(t)}
                >
                  <Text
                    style={[
                      styles.timeChipText,
                      defaultReturn === t && styles.timeChipTextActive,
                    ]}
                  >
                    {formatTime(t)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : (
        <View style={styles.perDaySection}>
          {ALL_DAYS.filter((d) => selectedDays.has(d.key)).map((day) => (
            <View key={day.key} style={styles.perDayCard}>
              <Text style={styles.perDayTitle}>{day.label}</Text>
              <View style={styles.perDayTimes}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perDayTimeLabel}>Depart</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.miniTimeChips}>
                      {DEPART_TIMES.map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={[
                            styles.miniChip,
                            perDaySchedule[day.key].depart === t &&
                              styles.miniChipActive,
                          ]}
                          onPress={() => updateDayTime(day.key, "depart", t)}
                        >
                          <Text
                            style={[
                              styles.miniChipText,
                              perDaySchedule[day.key].depart === t &&
                                styles.miniChipTextActive,
                            ]}
                          >
                            {formatTime(t)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perDayTimeLabel}>Return</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.miniTimeChips}>
                      {RETURN_TIMES.map((t) => (
                        <TouchableOpacity
                          key={t}
                          style={[
                            styles.miniChip,
                            perDaySchedule[day.key].return === t &&
                              styles.miniChipActive,
                          ]}
                          onPress={() => updateDayTime(day.key, "return", t)}
                        >
                          <Text
                            style={[
                              styles.miniChipText,
                              perDaySchedule[day.key].return === t &&
                                styles.miniChipTextActive,
                            ]}
                          >
                            {formatTime(t)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Reliability */}
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>How reliable is your schedule?</Text>
      <Text style={styles.sectionHint}>
        This helps us match you with the right people. No judgement.
      </Text>
      <View style={styles.reliabilityOptions}>
        {RELIABILITY_OPTIONS.map((opt) => {
          const active = reliability === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.reliabilityCard,
                active && styles.reliabilityCardActive,
              ]}
              onPress={() => setReliability(opt.value)}
            >
              <Ionicons
                name={opt.icon}
                size={22}
                color={active ? Colors.primary : Colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.reliabilityLabel,
                    active && styles.reliabilityLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
                <Text style={styles.reliabilityDesc}>{opt.desc}</Text>
              </View>
              <View style={[styles.radio, active && styles.radioActive]}>
                {active && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Flex credits note */}
      <View style={styles.flexNote}>
        <Ionicons name="flash-outline" size={20} color={Colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.flexTitle}>You get 3 Flex Credits / month</Text>
          <Text style={styles.flexBody}>
            Use them to cancel, leave early, or change plans without affecting
            your reliability score. Earn more by being consistent.
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>
            {loading ? "Saving..." : isDriverFlow ? "Continue" : "Finish setup"}
          </Text>
          <Ionicons
            name={isDriverFlow ? "arrow-forward" : "checkmark"}
            size={20}
            color={Colors.textOnPrimary}
          />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 70,
    paddingBottom: Spacing["4xl"],
  },
  progress: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginBottom: Spacing.xl,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  step: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginBottom: Spacing["2xl"],
    lineHeight: 22,
  },
  sectionLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  sectionHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 19,
  },
  validationError: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginBottom: Spacing.md,
  },
  dayRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  dayChip: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  dayChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
  },
  dayLabelActive: { color: Colors.textOnPrimary },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  toggleLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: Colors.text,
  },
  toggleHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  timeSection: { marginBottom: Spacing.lg },
  timeLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  timeChips: { flexDirection: "row", gap: Spacing.sm, paddingRight: Spacing.xl },
  timeChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  timeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  timeChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  timeChipTextActive: { color: Colors.textOnPrimary },
  perDaySection: { gap: Spacing.md, marginBottom: Spacing.lg },
  perDayCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  perDayTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  perDayTimes: { gap: Spacing.sm },
  perDayTimeLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  miniTimeChips: { flexDirection: "row", gap: Spacing.xs, paddingRight: Spacing.md },
  miniChip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  miniChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  miniChipText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  miniChipTextActive: { color: Colors.textOnPrimary },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xl,
  },
  reliabilityOptions: { gap: Spacing.sm, marginBottom: Spacing.xl },
  reliabilityCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  reliabilityCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  reliabilityLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 1,
  },
  reliabilityLabelActive: { color: Colors.primaryDark },
  reliabilityDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  flexNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  flexTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 2,
  },
  flexBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing["2xl"],
  },
  backBtn: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  button: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.md,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
});
