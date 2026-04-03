import { useState, useEffect, useCallback, useMemo, type ComponentProps } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Json } from "@/types/database";
import {
  NOTIFICATION_PREFERENCE_CATALOG,
  mergeNotificationPreferences,
  type NotificationPreferenceId,
} from "@/constants/notificationPreferenceCatalog";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type RowState = {
  id: NotificationPreferenceId;
  icon: string;
  title: string;
  subtitle: string;
  enabled: boolean;
};

export default function NotificationsScreen() {
  const { profile, refreshProfile } = useAuth();
  const [prefs, setPrefs] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const hydrate = useCallback(() => {
    const merged = mergeNotificationPreferences(profile?.notification_preferences);
    setPrefs(
      NOTIFICATION_PREFERENCE_CATALOG.map((c) => ({
        id: c.id,
        icon: c.icon,
        title: c.title,
        subtitle: c.subtitle,
        enabled: merged[c.id]?.enabled ?? c.defaultEnabled,
      }))
    );
    setDirty(false);
  }, [profile?.notification_preferences]);

  useEffect(() => {
    setLoading(!profile);
    if (profile) {
      hydrate();
      setLoading(false);
    }
  }, [profile, hydrate]);

  const mapToJson = useMemo(() => {
    const out: Record<string, { enabled: boolean }> = {};
    for (const p of prefs) out[p.id] = { enabled: p.enabled };
    return out;
  }, [prefs]);

  function toggle(id: string) {
    setPrefs((p) => p.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n)));
    setDirty(true);
  }

  async function save() {
    if (!profile?.id) return;
    setSaving(true);
    const payload = mapToJson as unknown as Json;
    const { error } = await supabase
      .from("users")
      .update({ notification_preferences: payload })
      .eq("id", profile.id);
    setSaving(false);
    if (error) {
      showAlert("Could not save", error.message);
      return;
    }
    await refreshProfile();
    setDirty(false);
    showAlert("Saved", "Your notification preferences are stored on your account.");
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.infoText}>
            These preferences are saved to your profile. Push delivery still depends on device
            permissions when that feature is enabled.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>NOTIFICATION TYPES</Text>
        <View style={styles.card}>
          {prefs.map((pref, i) => (
            <View key={pref.id}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons
                    name={pref.icon as ComponentProps<typeof Ionicons>["name"]}
                    size={20}
                    color={pref.enabled ? Colors.primary : Colors.textTertiary}
                  />
                </View>
                <View style={styles.text}>
                  <Text style={styles.rowTitle}>{pref.title}</Text>
                  <Text style={styles.rowSubtitle}>{pref.subtitle}</Text>
                </View>
                <Switch
                  value={pref.enabled}
                  onValueChange={() => toggle(pref.id)}
                  trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                  thumbColor={pref.enabled ? Colors.primary : Colors.surface}
                />
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.quickRow}
            activeOpacity={0.7}
            onPress={() => {
              setPrefs((p) => p.map((n) => ({ ...n, enabled: true })));
              setDirty(true);
            }}
          >
            <Ionicons name="checkmark-done-outline" size={20} color={Colors.primary} />
            <Text style={styles.quickLabel}>Enable all notification types</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.quickRow}
            activeOpacity={0.7}
            onPress={() => {
              showAlert("Mute all", "Turn off all categories in this list?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Mute all",
                  style: "destructive",
                  onPress: () => {
                    setPrefs((p) => p.map((n) => ({ ...n, enabled: false })));
                    setDirty(true);
                  },
                },
              ]);
            }}
          >
            <Ionicons name="volume-mute-outline" size={20} color={Colors.error} />
            <Text style={[styles.quickLabel, { color: Colors.error }]}>
              Mute all notification types
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
          onPress={() => void save()}
          disabled={!dirty || saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.saveBtnText}>Save preferences</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  infoBox: {
    flexDirection: "row",
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    alignItems: "flex-start",
  },
  infoText: { flex: 1, fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  text: { flex: 1 },
  rowTitle: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.text },
  rowSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  divider: { height: 1, backgroundColor: Colors.borderLight },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.base,
  },
  quickLabel: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.text },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.base + 2,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
});
