import { useState, useEffect } from "react";
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
import { Link, router, useLocalSearchParams } from "expo-router";
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

export default function JoinOrg() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orgName, setOrgName] = useState("");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const raw = params.code;
    const c = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
    const trimmed = c.trim().toUpperCase().slice(0, 8);
    if (trimmed.length >= 8) {
      setInviteCode(trimmed);
    }
  }, [params.code]);

  async function handleJoin() {
    setError("");
    const code = inviteCode.trim();

    if (!code) {
      setError("Please enter an invite code.");
      return;
    }
    if (code.length < 8) {
      setError("Invite code must be 8 characters.");
      return;
    }

    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("join_org_by_invite", {
      code,
    });
    setLoading(false);

    if (rpcError) {
      const msg = rpcError.message.toLowerCase();
      if (msg.includes("domain")) {
        setError(
          "Your email domain doesn't match this organisation. Please use your work email."
        );
      } else if (msg.includes("subscription") && msg.includes("current")) {
        setError(
          "This organisation's subscription is not current. Ask your admin to update billing before new members can join."
        );
      } else if (msg.includes("not active")) {
        setError(
          "This organisation's network is not active yet. Ask your admin to activate it before you can join."
        );
      } else if (msg.includes("invalid") || msg.includes("not found")) {
        setError("Invalid invite code. Please check and try again.");
      } else {
        setError(rpcError.message);
      }
      return;
    }

    const orgData = typeof data === "object" ? data : {};
    setOrgName(orgData?.name ?? "your organisation");
    setJoined(true);
  }

  if (joined) {
    return (
      <View style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons
              name="people-circle-outline"
              size={48}
              color={Colors.primary}
            />
          </View>
          <Text style={styles.successTitle}>You&apos;re in!</Text>
          <Text style={styles.successBody}>
            You&apos;ve joined{" "}
            <Text style={styles.bold}>{orgName}</Text>. Let&apos;s finish setting up
            your profile so you can start carpooling.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace("/(onboarding)/")}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Continue to setup</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topRow}>
          <Link href="/(auth)/" asChild>
            <TouchableOpacity style={styles.backButton} activeOpacity={0.7}>
              <Ionicons name="arrow-back" size={24} color={Colors.text} />
            </TouchableOpacity>
          </Link>
        </View>

        <View style={styles.headerIcon}>
          <Ionicons name="shield-checkmark-outline" size={40} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Join Your Network</Text>
        <Text style={styles.subtitle}>
          Enter an invite code if you have one. You can also skip this and
          continue onboarding now.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Invite code</Text>
          <View
            style={[
              styles.inputWrapper,
              error ? styles.inputWrapperError : undefined,
            ]}
          >
            <Ionicons
              name="key-outline"
              size={20}
              color={error ? Colors.error : Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.codeInput}
              placeholder="ABCD1234"
              placeholderTextColor={Colors.textTertiary}
              value={inviteCode}
              onChangeText={(t) => {
                setError("");
                setInviteCode(t.toUpperCase().slice(0, 8));
              }}
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          {error ? <Text style={styles.errorHint}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleJoin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.buttonText}>Join network</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => router.replace("/(onboarding)/")}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["3xl"],
  },

  topRow: {
    paddingTop: 60,
    marginBottom: Spacing.xl,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },

  headerIcon: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },

  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing["2xl"],
    paddingHorizontal: Spacing.base,
  },

  inputGroup: {
    marginBottom: Spacing.lg,
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
  inputWrapperError: {
    borderColor: Colors.error,
  },
  inputIcon: {
    marginRight: Spacing.md,
  },
  codeInput: {
    flex: 1,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: 3,
  },
  errorHint: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },

  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.sm,
    ...Shadow.md,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  skipBtn: {
    alignSelf: "center",
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  skipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },

  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  successTitle: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  successBody: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: Spacing["2xl"],
  },
  bold: {
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
});
