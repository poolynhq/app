import { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getLocales } from "expo-localization";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { PLATFORM_CHARGE_CURRENCY } from "@/constants/platformBilling";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const CURRENCY_OPTIONS: { code: string; label: string }[] = [
  { code: "AUD", label: "Australian dollar" },
  { code: "USD", label: "US dollar" },
  { code: "NZD", label: "New Zealand dollar" },
  { code: "GBP", label: "British pound" },
  { code: "EUR", label: "Euro" },
  { code: "CAD", label: "Canadian dollar" },
  { code: "SGD", label: "Singapore dollar" },
];

export default function BillingCurrencyOnboarding() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  const { deviceCode, deviceLabel } = useMemo(() => {
    try {
      const p = getLocales()[0];
      const code = p?.currencyCode?.trim().toUpperCase();
      const valid = code && /^[A-Z]{3}$/.test(code) ? code : null;
      const region = p?.regionCode;
      const label = valid
        ? `${valid}${region ? ` (${region})` : ""}`
        : "Could not read device currency";
      return { deviceCode: valid, deviceLabel: label };
    } catch {
      return { deviceCode: null, deviceLabel: "Could not read device currency" };
    }
  }, []);

  const defaultCode = useMemo(() => {
    if (deviceCode && CURRENCY_OPTIONS.some((o) => o.code === deviceCode)) return deviceCode;
    if (CURRENCY_OPTIONS.some((o) => o.code === PLATFORM_CHARGE_CURRENCY)) {
      return PLATFORM_CHARGE_CURRENCY;
    }
    return "AUD";
  }, [deviceCode]);

  const [selected, setSelected] = useState(defaultCode);

  async function handleContinue() {
    const userId = profile?.id;
    if (!userId) {
      showAlert("Session", "Please sign in again.");
      return;
    }

    const differsDevice = !!(deviceCode && selected !== deviceCode);
    const differsPlatform = selected !== PLATFORM_CHARGE_CURRENCY;

    setLoading(true);
    const { error } = await supabase
      .from("users")
      .update({
        billing_currency_user_code: selected,
        billing_currency_device_code: deviceCode,
        billing_currency_differs_from_device: differsDevice,
        billing_currency_differs_from_platform: differsPlatform,
      })
      .eq("id", userId);

    if (error) {
      setLoading(false);
      showAlert("Could not save", error.message);
      return;
    }

    if (differsDevice || differsPlatform) {
      const parts: string[] = [];
      if (differsPlatform) {
        parts.push(
          `This app charges cards in ${PLATFORM_CHARGE_CURRENCY}. We will still show amounts in ${selected} where you asked.`
        );
      }
      if (differsDevice && deviceCode) {
        parts.push(`Your device suggested ${deviceCode}; we saved ${selected} for display.`);
      }
      const body = parts.join(" ").trim() || "Preference saved.";
      const { error: nErr } = await supabase.rpc("poolyn_insert_own_notification", {
        p_type: "billing_currency_onboarding",
        p_title: "Currency preference",
        p_body: body,
        p_data: {
          selected,
          deviceCode,
          platformChargeCurrency: PLATFORM_CHARGE_CURRENCY,
          differsDevice,
          differsPlatform,
        },
      });
      if (nErr) {
        console.warn("poolyn_insert_own_notification", nErr.message);
      }
    }

    await refreshProfile();
    setLoading(false);
    router.push("/(onboarding)/location");
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Link href="/(onboarding)/" asChild>
        <TouchableOpacity style={styles.backButton} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
      </Link>

      <Text style={styles.title}>Which currency should we use?</Text>
      <Text style={styles.subtitle}>
        This controls symbols in the app. Your device suggests: {deviceLabel}. Charge currency for
        this Poolyn deployment is {PLATFORM_CHARGE_CURRENCY}. If those differ, we will note it and
        you will see a copy in your notifications.
      </Text>

      <View style={styles.options}>
        {CURRENCY_OPTIONS.map((o) => {
          const on = selected === o.code;
          return (
            <TouchableOpacity
              key={o.code}
              style={[styles.optionRow, on && styles.optionRowOn]}
              onPress={() => setSelected(o.code)}
              activeOpacity={0.85}
            >
              <Text style={[styles.optionCode, on && styles.optionCodeOn]}>{o.code}</Text>
              <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{o.label}</Text>
              {on ? <Ionicons name="checkmark-circle" size={22} color={Colors.primary} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
        onPress={() => void handleContinue()}
        disabled={loading}
        activeOpacity={0.9}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Continue</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing["3xl"],
  },
  backButton: { alignSelf: "flex-start", marginBottom: Spacing.md, padding: Spacing.xs },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  options: { gap: Spacing.sm, marginBottom: Spacing.xl },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  optionRowOn: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  optionCode: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    width: 40,
  },
  optionCodeOn: { color: Colors.primaryDark },
  optionLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  optionLabelOn: { fontWeight: FontWeight.semibold },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: "#fff",
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
});
