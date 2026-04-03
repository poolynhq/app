import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

function parseQueryAndHash(url: string): URLSearchParams {
  const qIndex = url.indexOf("?");
  const hIndex = url.indexOf("#");
  let queryPart = "";
  let hashPart = "";
  if (qIndex >= 0) {
    const end = hIndex >= 0 && hIndex > qIndex ? hIndex : url.length;
    queryPart = url.slice(qIndex + 1, end);
  }
  if (hIndex >= 0) {
    hashPart = url.slice(hIndex + 1);
  }
  const combined = [queryPart, hashPart].filter(Boolean).join("&");
  return new URLSearchParams(combined);
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [done, setDone] = useState(false);

  const applyUrl = useCallback(async (url: string | null) => {
    if (!url) return false;
    const params = parseQueryAndHash(url);
    const code = params.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setAuthError(error.message);
        return false;
      }
      return true;
    }
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) {
        setAuthError(error.message);
        return false;
      }
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setBusy(true);
      setAuthError(null);

      const initial = await Linking.getInitialURL();
      let ok = await applyUrl(initial);

      if (!ok && Platform.OS === "web" && typeof window !== "undefined") {
        ok = await applyUrl(window.location.href);
      }

      if (!cancelled) {
        if (ok) {
          setSessionReady(true);
        } else if (!initial && Platform.OS !== "web") {
          setAuthError(
            "Open this screen from the password reset link in your email. If you already used the link, sign in with your new password."
          );
        } else if (!ok) {
          setAuthError(
            "This reset link is missing a token or has expired. Request a new link from Sign in."
          );
        }
        setBusy(false);
      }
    }

    void boot();

    const sub = Linking.addEventListener("url", ({ url }) => {
      void (async () => {
        const ok = await applyUrl(url);
        if (ok) {
          setSessionReady(true);
          setAuthError(null);
          setBusy(false);
        }
      })();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [applyUrl]);

  async function handleSubmit() {
    setFieldError("");
    if (password.length < 8) {
      setFieldError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFieldError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setFieldError(error.message);
      return;
    }
    setDone(true);
  }

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.centerText}>Verifying reset link…</Text>
      </View>
    );
  }

  if (authError && !sessionReady) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.replace("/(auth)/sign-in")}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
          <Text style={styles.backText}>Back to sign in</Text>
        </TouchableOpacity>
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={32} color={Colors.error} />
          <Text style={styles.errorTitle}>Could not reset password</Text>
          <Text style={styles.errorBody}>{authError}</Text>
        </View>
      </ScrollView>
    );
  }

  if (done) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={40} color={Colors.success} />
          <Text style={styles.successTitle}>Password updated</Text>
          <Text style={styles.successBody}>You can continue with your account.</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace("/(tabs)/")}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>Enter a strong password for your Poolyn account.</Text>

        <Text style={styles.label}>New password</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="At least 8 characters"
            placeholderTextColor={Colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />
        </View>

        <Text style={styles.label}>Confirm password</Text>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Repeat password"
            placeholderTextColor={Colors.textTertiary}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
          />
        </View>

        {fieldError ? <Text style={styles.fieldError}>{fieldError}</Text> : null}

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={() => void handleSubmit()}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.buttonText}>Update password</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 56,
    paddingBottom: Spacing["3xl"],
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
    backgroundColor: Colors.background,
  },
  centerText: { marginTop: Spacing.md, fontSize: FontSize.sm, color: Colors.textSecondary },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xl,
    alignSelf: "flex-start",
  },
  backText: { fontSize: FontSize.base, color: Colors.primary, fontWeight: FontWeight.medium },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing["2xl"],
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  inputWrapper: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.base,
    height: 52,
    justifyContent: "center",
    marginBottom: Spacing.lg,
    ...Shadow.sm,
  },
  input: { fontSize: FontSize.base, color: Colors.text },
  fieldError: { fontSize: FontSize.xs, color: Colors.error, marginBottom: Spacing.md },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.lg,
    ...Shadow.md,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  errorCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    gap: Spacing.md,
  },
  errorTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text },
  errorBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20 },
  successCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    gap: Spacing.md,
    ...Shadow.sm,
  },
  successTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text },
  successBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center" },
});
