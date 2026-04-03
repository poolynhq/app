import { useState } from "react";
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

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [generalError, setGeneralError] = useState("");

  async function handleSendLink() {
    setEmailError("");
    setGeneralError("");
    if (!email.trim()) {
      setEmailError("Please enter your email address.");
      return;
    }
    if (!isValidEmail(email.trim())) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    const redirectTo =
      process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL?.trim() ||
      Linking.createURL("(auth)/reset-password");

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo }
    );
    setLoading(false);

    if (error) {
      setGeneralError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
          <Text style={styles.backText}>Back to sign in</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>
          We will email you a link to choose a new password. It opens this app when you tap it.
        </Text>

        {sent ? (
          <View style={styles.successCard}>
            <Ionicons name="mail-outline" size={28} color={Colors.primary} />
            <Text style={styles.successTitle}>Check your inbox</Text>
            <Text style={styles.successBody}>
              If an account exists for {email.trim().toLowerCase()}, you will receive a reset link
              shortly. Also check spam or promotions folders.
            </Text>
            <Text style={styles.successHint}>
              If the link does not open the app, add the same redirect URL in Supabase (Authentication
              → URL configuration) as for your web app or dev client.
            </Text>
          </View>
        ) : (
          <>
            {generalError ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color={Colors.error} />
                <Text style={styles.errorBannerText}>{generalError}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Email</Text>
            <View
              style={[styles.inputWrapper, emailError ? styles.inputWrapperError : null]}
            >
              <Ionicons
                name="mail-outline"
                size={20}
                color={emailError ? Colors.error : Colors.textTertiary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="you@company.com"
                placeholderTextColor={Colors.textTertiary}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (emailError) setEmailError("");
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>
            {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={() => void handleSendLink()}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.textOnPrimary} />
              ) : (
                <Text style={styles.buttonText}>Send reset link</Text>
              )}
            </TouchableOpacity>
          </>
        )}
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
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.base,
    height: 52,
    ...Shadow.sm,
  },
  inputWrapperError: { borderColor: Colors.error },
  inputIcon: { marginRight: Spacing.md },
  input: { flex: 1, fontSize: FontSize.base, color: Colors.text },
  fieldError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.errorLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  errorBannerText: { flex: 1, fontSize: FontSize.sm, color: Colors.error, lineHeight: 19 },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.xl,
    ...Shadow.md,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
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
  successBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  successHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
});
