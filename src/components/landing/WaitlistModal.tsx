import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BorderRadius,
  Colors,
  FontSize,
  Shadow,
  Spacing,
} from "@/constants/theme";
import { Landing } from "@/constants/landingTheme";
import { LandingFont } from "@/constants/landingTypography";
import { filterMetroAreas } from "@/constants/waitlistMetroAreas";
import {
  submitWaitlistSignup,
  type WaitlistIntent,
} from "@/lib/waitlistSignup";

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultIntent?: WaitlistIntent;
};

const INTENT_OPTIONS: { key: WaitlistIntent; label: string }[] = [
  { key: "individual", label: "Commuter" },
  { key: "organization", label: "Organization" },
  { key: "unsure", label: "Not sure yet" },
];

function basicEmailOk(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function WaitlistModal({ visible, onClose, defaultIntent }: Props) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [metro, setMetro] = useState("");
  const [intent, setIntent] = useState<WaitlistIntent>(
    defaultIntent ?? "unsure"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [metroFocused, setMetroFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const blurMetroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && defaultIntent) setIntent(defaultIntent);
  }, [visible, defaultIntent]);

  useEffect(() => {
    return () => {
      if (blurMetroTimer.current) clearTimeout(blurMetroTimer.current);
    };
  }, []);

  function refreshSuggestions(query: string) {
    setSuggestions(filterMetroAreas(query));
  }

  function reset() {
    setEmail("");
    setFullName("");
    setMetro("");
    setIntent(defaultIntent ?? "unsure");
    setLoading(false);
    setError(null);
    setDone(false);
    setMetroFocused(false);
    setSuggestions([]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function pickMetro(value: string) {
    if (blurMetroTimer.current) clearTimeout(blurMetroTimer.current);
    setMetro(value);
    setSuggestions([]);
    setMetroFocused(false);
    Keyboard.dismiss();
  }

  function onMetroFocus() {
    if (blurMetroTimer.current) clearTimeout(blurMetroTimer.current);
    setMetroFocused(true);
    refreshSuggestions(metro);
  }

  function onMetroBlur() {
    blurMetroTimer.current = setTimeout(() => {
      setMetroFocused(false);
      setSuggestions([]);
    }, 200);
  }

  async function onSubmit() {
    setError(null);
    if (!basicEmailOk(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    const { error: insertError } = await submitWaitlistSignup({
      email,
      fullName: fullName || undefined,
      metroArea: metro.trim() || undefined,
      intent,
      source: "landing_modal",
    });
    setLoading(false);
    if (insertError) {
      if (insertError.code === "23505") {
        setError("That email is already on the list. We'll be in touch.");
      } else {
        setError(insertError.message || "Something went wrong. Try again.");
      }
      return;
    }
    setDone(true);
  }

  const showMetroSuggestions =
    metroFocused && metro.trim().length > 0 && suggestions.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Join the waitlist</Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={26} color={Landing.ink} />
              </Pressable>
            </View>
            {done ? (
              <View style={styles.successBlock}>
                <Ionicons name="checkmark-circle" size={48} color={Colors.primary} />
                <Text style={styles.successTitle}>You&apos;re on the list</Text>
                <Text style={styles.successBody}>
                  We&apos;ll email you when Poolyn opens up. Welcome aboard.
                </Text>
                <Pressable style={styles.primaryBtn} onPress={handleClose}>
                  <Text style={styles.primaryBtnText}>Close</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={[styles.label, styles.labelFirst]}>Work email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="you@company.com"
                  placeholderTextColor={Landing.subtle}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                />
                <Text style={styles.label}>Name (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Alex Chen"
                  placeholderTextColor={Landing.subtle}
                  value={fullName}
                  onChangeText={setFullName}
                />
                <Text style={styles.label}>Metro area (optional)</Text>
                <Text style={styles.hint}>
                  Start typing and pick a suggestion, or enter your city and
                  country.
                </Text>
                <View style={styles.metroWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Melbourne, Australia"
                    placeholderTextColor={Landing.subtle}
                    value={metro}
                    onChangeText={(t) => {
                      setMetro(t);
                      refreshSuggestions(t);
                    }}
                    onFocus={onMetroFocus}
                    onBlur={onMetroBlur}
                    autoCorrect={false}
                  />
                  {showMetroSuggestions ? (
                    <View style={styles.suggestionsBox}>
                      <ScrollView
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        style={styles.suggestionsScroll}
                      >
                        {suggestions.map((s) => (
                          <Pressable
                            key={s}
                            style={({ pressed }) => [
                              styles.suggestionRow,
                              pressed && styles.suggestionRowPressed,
                            ]}
                            onPress={() => pickMetro(s)}
                          >
                            <Ionicons
                              name="location-outline"
                              size={18}
                              color={Landing.tealDark}
                              style={styles.suggestionIcon}
                            />
                            <Text style={styles.suggestionText}>{s}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.label}>I&apos;m interested as</Text>
                <View style={styles.intentRow}>
                  {INTENT_OPTIONS.map((o) => {
                    const on = intent === o.key;
                    return (
                      <Pressable
                        key={o.key}
                        onPress={() => setIntent(o.key)}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {o.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {error ? <Text style={styles.err}>{error}</Text> : null}
                <Pressable
                  style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                  onPress={onSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={Landing.white} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Join the waitlist</Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  sheet: {
    backgroundColor: Landing.white,
    borderRadius: BorderRadius.xl,
    padding: Spacing["2xl"],
    maxWidth: 440,
    width: "100%",
    maxHeight: "90%",
    alignSelf: "center",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xl,
  },
  sheetTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize["2xl"],
    color: Landing.ink,
    letterSpacing: -0.4,
  },
  label: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.sm,
    color: Landing.muted,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  labelFirst: { marginTop: 0 },
  hint: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.subtle,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  metroWrap: {
    position: "relative",
    zIndex: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: Landing.tealLine,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: 14,
    fontSize: FontSize.base,
    fontFamily: LandingFont.body,
    color: Landing.ink,
    backgroundColor: Landing.mintInput,
  },
  suggestionsBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: Landing.tealLine,
    borderRadius: BorderRadius.md,
    backgroundColor: Landing.white,
    overflow: "hidden",
    ...Shadow.md,
  },
  suggestionsScroll: { maxHeight: 200 },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  suggestionRowPressed: { backgroundColor: Landing.tealMuted },
  suggestionIcon: { marginRight: Spacing.sm },
  suggestionText: {
    flex: 1,
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.ink,
  },
  intentRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md, marginTop: Spacing.xs },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipOn: {
    borderColor: Landing.tealDark,
    backgroundColor: Landing.tealMuted,
  },
  chipText: { fontFamily: LandingFont.body, fontSize: FontSize.sm, color: Landing.muted },
  chipTextOn: { fontFamily: LandingFont.bodySemi, color: Landing.forest },
  err: {
    fontFamily: LandingFont.body,
    color: Colors.error,
    fontSize: FontSize.sm,
    marginTop: Spacing.md,
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Landing.forest,
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.white,
    fontSize: FontSize.base,
  },
  successBlock: { alignItems: "center", paddingVertical: Spacing.xl },
  successTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xl,
    color: Landing.ink,
    marginTop: Spacing.md,
    letterSpacing: -0.3,
  },
  successBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.base,
    color: Landing.muted,
    textAlign: "center",
    marginTop: Spacing.md,
    lineHeight: 24,
    paddingHorizontal: Spacing.sm,
  },
});
