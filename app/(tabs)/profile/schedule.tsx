import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { WeekdayTimes, DaySchedule } from "@/types/database";
import {
  Colors, Spacing, BorderRadius, FontSize, FontWeight, Shadow,
} from "@/constants/theme";

const DAYS: { key: keyof WeekdayTimes; label: string; short: string }[] = [
  { key: "mon", label: "Monday",    short: "Mon" },
  { key: "tue", label: "Tuesday",   short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday",  short: "Thu" },
  { key: "fri", label: "Friday",    short: "Fri" },
  { key: "sat", label: "Saturday",  short: "Sat" },
  { key: "sun", label: "Sunday",    short: "Sun" },
];

const DEFAULT_DEPART = "08:00";
const DEFAULT_RETURN = "17:30";

function isValidTime(t: string) {
  return /^\d{2}:\d{2}$/.test(t) && parseInt(t.split(":")[0], 10) < 24 && parseInt(t.split(":")[1], 10) < 60;
}

export default function ScheduleScreen() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [activeDays, setActiveDays] = useState<Set<keyof WeekdayTimes>>(new Set(["mon", "tue", "wed", "thu", "fri"]));
  const [times, setTimes] = useState<WeekdayTimes>({});
  const [flexEnabled, setFlexEnabled] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("schedules")
      .select("*")
      .eq("user_id", profile.id)
      .eq("active", true)
      .maybeSingle();

    if (data) {
      setScheduleId(data.id);
      const wt = (data.weekday_times ?? {}) as WeekdayTimes;
      setTimes(wt);
      setActiveDays(new Set(Object.keys(wt) as (keyof WeekdayTimes)[]));
    } else {
      setScheduleId(null);
      setActiveDays(new Set(["mon", "tue", "wed", "thu", "fri"]));
      setTimes({});
    }
    setFlexEnabled((profile.schedule_flex_mins ?? 0) > 0);
    setLoading(false);
  }, [profile?.id, profile?.schedule_flex_mins]);

  useEffect(() => { load(); }, [load]);

  function toggleDay(day: keyof WeekdayTimes) {
    setActiveDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
        setTimes((t) => { const n = { ...t }; delete n[day]; return n; });
      } else {
        next.add(day);
        setTimes((t) => ({ ...t, [day]: { depart: DEFAULT_DEPART, return: DEFAULT_RETURN } }));
      }
      return next;
    });
  }

  function setTime(day: keyof WeekdayTimes, field: keyof DaySchedule, value: string) {
    setTimes((t) => ({ ...t, [day]: { ...((t[day] ?? { depart: DEFAULT_DEPART, return: DEFAULT_RETURN }) as DaySchedule), [field]: value } }));
  }

  async function handleSave() {
    if (!profile?.id) return;
    for (const day of activeDays) {
      const t = times[day];
      if (!t || !isValidTime(t.depart) || !isValidTime(t.return)) {
        showAlert("Invalid time", `Please enter valid times (HH:MM) for ${DAYS.find((d) => d.key === day)?.label}.`);
        return;
      }
    }
    setSaving(true);
    const weekday_times: WeekdayTimes = {};
    activeDays.forEach((day) => {
      if (times[day]) weekday_times[day] = times[day];
    });

    if (scheduleId) {
      const { error } = await supabase.from("schedules").update({ weekday_times, updated_at: new Date().toISOString() }).eq("id", scheduleId);
      if (error) { showAlert("Error", "Could not save schedule."); setSaving(false); return; }
    } else {
      const { error } = await supabase.from("schedules").insert({ user_id: profile.id, type: "fixed_weekly", weekday_times, tolerance_mins: 15 });
      if (error) { showAlert("Error", "Could not save schedule."); setSaving(false); return; }
    }
    await supabase.from("users").update({ schedule_flex_mins: flexEnabled ? 15 : 0 }).eq("id", profile.id);
    setSaving(false);
    showAlert("Saved", "Your schedule has been updated.");
    load();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.infoText}>
            Set the days and times you typically commute. This helps us find the best matches for you.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>COMMUTE DAYS</Text>
        <View style={styles.daysRow}>
          {DAYS.map(({ key, short }) => {
            const active = activeDays.has(key);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => toggleDay(key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>{short}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {activeDays.size === 0 && (
          <Text style={styles.hint}>Select at least one day to set your commute times.</Text>
        )}

        {DAYS.filter(({ key }) => activeDays.has(key)).map(({ key, label }) => {
          const t = times[key] ?? { depart: DEFAULT_DEPART, return: DEFAULT_RETURN };
          return (
            <View key={key} style={styles.dayRow}>
              <Text style={styles.dayLabel}>{label}</Text>
              <View style={styles.timePair}>
                <View style={styles.timeField}>
                  <Text style={styles.timeFieldLabel}>Depart</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={t.depart}
                    onChangeText={(v) => setTime(key, "depart", v)}
                    placeholder="08:00"
                    placeholderTextColor={Colors.textTertiary}
                    maxLength={5}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <Ionicons name="arrow-forward" size={18} color={Colors.textTertiary} style={{ marginTop: 20 }} />
                <View style={styles.timeField}>
                  <Text style={styles.timeFieldLabel}>Return</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={t.return}
                    onChangeText={(v) => setTime(key, "return", v)}
                    placeholder="17:30"
                    placeholderTextColor={Colors.textTertiary}
                    maxLength={5}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionLabel}>FLEXIBILITY</Text>
        <View style={styles.flexCard}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.flexTitle}>Allow ±15 min flexibility</Text>
            <Text style={styles.flexBody}>Matches riders who are up to 15 minutes earlier or later than your schedule.</Text>
          </View>
          <Switch
            value={flexEnabled}
            onValueChange={setFlexEnabled}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={flexEnabled ? Colors.primary : Colors.surface}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save schedule"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  infoBox: { flexDirection: "row", gap: Spacing.sm, backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.xl, alignItems: "flex-start" },
  infoText: { flex: 1, fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
  sectionLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: Spacing.md },
  daysRow: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap", marginBottom: Spacing.xl },
  dayChip: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface },
  dayChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  dayChipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  dayChipTextActive: { color: Colors.primaryDark, fontWeight: FontWeight.semibold },
  hint: { fontSize: FontSize.sm, color: Colors.textTertiary, marginBottom: Spacing.xl, fontStyle: "italic" },
  dayRow: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm },
  dayLabel: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text, marginBottom: Spacing.md },
  timePair: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  timeField: { flex: 1 },
  timeFieldLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  timeInput: { height: 44, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBackground, paddingHorizontal: Spacing.md, fontSize: FontSize.base, color: Colors.text, textAlign: "center" },
  flexCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xl, ...Shadow.sm },
  flexTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  flexBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, paddingVertical: Spacing.base + 2, alignItems: "center" },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
});
