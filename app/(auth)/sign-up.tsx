import { useState, useEffect, useRef } from "react";
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
  Share,
} from "react-native";
import { Link, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { extractDomain, supabase } from "@/lib/supabase";
import { CheckDomainOrgResult, DomainOrgFound } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { AuthBrandingHero } from "@/components/auth/AuthBrandingHero";

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function getPasswordStrength(p: string): {
  label: string;
  color: string;
  width: `${number}%`;
} {
  if (p.length === 0) return { label: "", color: Colors.border, width: "0%" };
  if (p.length < 6)
    return { label: "Too short", color: Colors.error, width: "20%" };
  if (p.length < 8)
    return { label: "Weak", color: Colors.error, width: "40%" };

  let score = 0;
  if (/[a-z]/.test(p)) score++;
  if (/[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^a-zA-Z0-9]/.test(p)) score++;

  if (score <= 1)
    return { label: "Weak", color: Colors.error, width: "40%" };
  if (score === 2)
    return { label: "Fair", color: Colors.accent, width: "60%" };
  if (score === 3)
    return { label: "Good", color: Colors.primary, width: "80%" };
  return { label: "Strong", color: Colors.success, width: "100%" };
}

export default function SignUp() {
  const { signUp } = useAuth();
  const params = useLocalSearchParams<{ next?: string }>();
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;
  const isBusinessPath = nextParam === "business-sign-up";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPasswordRules, setShowPasswordRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [generalError, setGeneralError] = useState("");

  const [domainOrg, setDomainOrg] = useState<CheckDomainOrgResult | null>(null);
  const [domainChecking, setDomainChecking] = useState(false);
  const domainCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emailDomain = email.includes("@") ? extractDomain(email) : "";
  const isValidEmailInput = email.includes("@") && isValidEmail(email.trim());
  const showDomainHint = false;

  const pwStrength = getPasswordStrength(password);

  // Debounced domain → org check (runs whenever a valid email is entered)
  useEffect(() => {
    if (domainCheckTimer.current) clearTimeout(domainCheckTimer.current);
    if (!isValidEmailInput || !emailDomain) {
      setDomainOrg(null);
      return;
    }
    setDomainChecking(true);
    domainCheckTimer.current = setTimeout(async () => {
      const { data } = await supabase.rpc("check_domain_org", {
        p_email_domain: emailDomain,
      });
      setDomainOrg((data as CheckDomainOrgResult) ?? { has_org: false });
      setDomainChecking(false);
    }, 600);
    return () => {
      if (domainCheckTimer.current) clearTimeout(domainCheckTimer.current);
    };
  }, [isValidEmailInput, emailDomain]);

  async function handleShareWithLeadership() {
    try {
      await Share.share({
        title: "Poolyn Corporate Carpooling",
        message:
          "Hey! I've been using Poolyn for corporate carpooling and it's great. Check it out for our team: https://poolyn.app",
      });
    } catch {
      // ignore
    }
  }

  function validate(): boolean {
    let valid = true;
    setNameError("");
    setEmailError("");
    setPasswordError("");
    setConfirmError("");
    setGeneralError("");

    if (!fullName.trim()) {
      setNameError("Please enter your full name.");
      valid = false;
    }

    if (!email.trim()) {
      setEmailError("Please enter your email.");
      valid = false;
    } else if (!isValidEmail(email.trim())) {
      setEmailError("Please enter a valid email address.");
      valid = false;
    }

    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      valid = false;
    }

    if (confirmPassword !== password) {
      setConfirmError("Passwords do not match.");
      valid = false;
    }

    return valid;
  }

  async function handleSignUp() {
    if (!validate()) return;

    setLoading(true);
    setGeneralError("");
    const { error } = await signUp(
      email.trim().toLowerCase(),
      password,
      fullName.trim()
    );
    setLoading(false);

    if (error) {
      setGeneralError(error.message);
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <View style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons
              name="mail-unread-outline"
              size={48}
              color={Colors.primary}
            />
          </View>
          <Text style={styles.successTitle}>Check your inbox</Text>
          <Text style={styles.successBody}>
            We&apos;ve sent a confirmation link to{"\n"}
            <Text style={styles.successEmail}>{email}</Text>
            {"\n\n"}Click the link to activate your account and start
            carpooling with your colleagues.
          </Text>
          <Link
            href={
              nextParam === "business-sign-up"
                ? "/(auth)/sign-in?next=business-sign-up"
                : "/(auth)/sign-in"
            }
            asChild
          >
            <TouchableOpacity style={styles.button} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Continue to sign in</Text>
            </TouchableOpacity>
          </Link>
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
        <View style={styles.header}>
          <Link href="/(auth)/start" asChild>
            <TouchableOpacity style={styles.backButton}>
              <Ionicons
                name="arrow-back"
                size={24}
                color={Colors.text}
              />
            </TouchableOpacity>
          </Link>
        </View>

        <AuthBrandingHero
          kicker={isBusinessPath ? "Launch your program" : "Join Poolyn"}
          subline={
            isBusinessPath
              ? "Create your admin login first. You’ll set up your organisation next."
              : "A few details and you’re on your way to smarter shared commutes."
          }
        />

        <View style={styles.individualBadge}>
          <Ionicons
            name={isBusinessPath ? "business-outline" : "person-outline"}
            size={16}
            color={Colors.primary}
          />
          <Text style={styles.individualBadgeText}>
            {isBusinessPath
              ? "Creating a Carpool Program admin account"
              : "Signing up as individual"}
          </Text>
        </View>

        <Text style={styles.title}>
          {isBusinessPath ? "Create your admin account" : "Create your account"}
        </Text>
        <Text style={styles.subtitle}>
          {isBusinessPath
            ? "Create your account to launch your organisation's carpool program."
            : "Create your account to start finding commute matches."}
        </Text>

        {generalError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorBannerText}>{generalError}</Text>
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full name</Text>
          <View
            style={[
              styles.inputWrapper,
              nameError ? styles.inputWrapperError : null,
            ]}
          >
            <Ionicons
              name="person-outline"
              size={20}
              color={nameError ? Colors.error : Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Jane Smith"
              placeholderTextColor={Colors.textTertiary}
              value={fullName}
              onChangeText={(t) => {
                setFullName(t);
                if (nameError) setNameError("");
              }}
              autoCapitalize="words"
              autoComplete="name"
            />
          </View>
          {nameError ? (
            <Text style={styles.fieldError}>{nameError}</Text>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <View
            style={[
              styles.inputWrapper,
              (showDomainHint || emailError) && styles.inputWrapperError,
            ]}
          >
            <Ionicons
              name="mail-outline"
              size={20}
              color={
                showDomainHint || emailError
                  ? Colors.error
                  : Colors.textTertiary
              }
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
            {isValidEmailInput && (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={Colors.success}
              />
            )}
          </View>
          {emailError ? (
            <Text style={styles.fieldError}>{emailError}</Text>
          ) : showDomainHint ? (
            <Text style={styles.fieldError}>
              Please check your email format.
            </Text>
          ) : isValidEmailInput && !domainChecking ? null : null}

          {/* Domain org detection banners */}
          {isValidEmailInput && domainChecking && (
            <View style={styles.domainCheckRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.domainHint}>Checking your organisation…</Text>
            </View>
          )}

          {isValidEmailInput && !domainChecking && domainOrg?.has_org === true && (
            <View style={[styles.domainBanner, { backgroundColor: Colors.primaryLight, borderColor: Colors.primary }]}>
              <Ionicons name="business" size={20} color={Colors.primaryDark} style={styles.domainBannerIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.domainBannerTitle, { color: Colors.primaryDark }]}>
                  {(domainOrg as DomainOrgFound).org_name} already uses Poolyn
                </Text>
                <Text style={styles.domainBannerBody}>
                  Your account will automatically join their network.
                  {(domainOrg as DomainOrgFound).admin_name
                    ? ` The admin ${(domainOrg as DomainOrgFound).admin_name} will be notified.`
                    : ""}
                </Text>
                {isBusinessPath && (domainOrg as DomainOrgFound).org_type === "enterprise" && (
                  <Text style={[styles.domainBannerBody, { color: Colors.error, marginTop: 4 }]}>
                    An admin account already exists for this domain. Contact your existing admin or use an invite code.
                  </Text>
                )}
              </View>
            </View>
          )}

          {isValidEmailInput && !domainChecking && domainOrg?.has_org === false && !isBusinessPath && (
            <View style={[styles.domainBanner, { backgroundColor: Colors.accentLight, borderColor: Colors.accent }]}>
              <Ionicons name="share-social-outline" size={20} color="#92400E" style={styles.domainBannerIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.domainBannerTitle, { color: "#92400E" }]}>
                  No corporate account for {emailDomain} yet
                </Text>
                <Text style={styles.domainBannerBody}>
                  Help your colleagues save time. Share Poolyn with your leadership so they can sponsor a business account.
                </Text>
                <TouchableOpacity style={styles.shareBtn} onPress={handleShareWithLeadership}>
                  <Ionicons name="share-outline" size={14} color="#92400E" />
                  <Text style={styles.shareBtnText}>Share with leadership</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Password</Text>
          <View
            style={[
              styles.inputWrapper,
              passwordError ? styles.inputWrapperError : null,
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={passwordError ? Colors.error : Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="At least 8 characters"
              placeholderTextColor={Colors.textTertiary}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (passwordError) setPasswordError("");
              }}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
          {passwordError ? (
            <Text style={styles.fieldError}>{passwordError}</Text>
          ) : null}
          {password.length > 0 && (
            <View style={styles.strengthRow}>
              <View style={styles.strengthBar}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      width: pwStrength.width,
                      backgroundColor: pwStrength.color,
                    },
                  ]}
                />
              </View>
              <Text
                style={[styles.strengthLabel, { color: pwStrength.color }]}
              >
                {pwStrength.label}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.ruleToggle}
            onPress={() => setShowPasswordRules((prev) => !prev)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={showPasswordRules ? "chevron-up-outline" : "chevron-down-outline"}
              size={16}
              color={Colors.textSecondary}
            />
            <Text style={styles.ruleToggleText}>Password requirements</Text>
          </TouchableOpacity>
          {showPasswordRules && (
            <View style={styles.rulesPanel}>
              <Text style={styles.ruleItem}>- Minimum 8 characters</Text>
              <Text style={styles.ruleItem}>- At least one uppercase letter</Text>
              <Text style={styles.ruleItem}>- At least one number</Text>
              <Text style={styles.ruleItem}>- At least one special character (recommended)</Text>
            </View>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirm password</Text>
          <View
            style={[
              styles.inputWrapper,
              confirmError ? styles.inputWrapperError : null,
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={confirmError ? Colors.error : Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Re-enter your password"
              placeholderTextColor={Colors.textTertiary}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                if (confirmError) setConfirmError("");
              }}
              secureTextEntry={!showConfirm}
              autoComplete="new-password"
            />
            <TouchableOpacity
              onPress={() => setShowConfirm(!showConfirm)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showConfirm ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
          {confirmError ? (
            <Text style={styles.fieldError}>{confirmError}</Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.terms}>
          By creating an account you agree to Poolyn&apos;s{" "}
          <Text style={styles.termsLink}>Terms of Service</Text> and{" "}
          <Text style={styles.termsLink}>Privacy Policy</Text>.
        </Text>

        <View style={styles.bizLink}>
          <Text style={styles.footerText}>Have an invite code? </Text>
          <Link href="/(auth)/join-org" asChild>
            <TouchableOpacity>
              <Text style={styles.footerLink}>Join network</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link
            href={
              isBusinessPath
                ? "/(auth)/sign-in?next=business-sign-up"
                : "/(auth)/sign-in"
            }
            asChild
          >
            <TouchableOpacity>
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </Link>
        </View>
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
  header: {
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
  input: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  fieldError: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  domainHint: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    marginTop: Spacing.xs,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
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
  terms: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: Spacing.lg,
    lineHeight: 18,
    paddingHorizontal: Spacing.base,
  },
  termsLink: {
    color: Colors.primary,
    fontWeight: FontWeight.medium,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing["2xl"],
  },
  footerText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
  },
  footerLink: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  bizLink: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.lg,
  },
  individualBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: Spacing.xs,
    backgroundColor: Colors.primaryLight,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.md,
  },
  individualBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.errorLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  errorBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.error,
    lineHeight: 19,
  },
  strengthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
  },
  strengthFill: {
    height: "100%",
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    minWidth: 60,
  },
  ruleToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  ruleToggleText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  rulesPanel: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  ruleItem: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
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
  successEmail: {
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  domainCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  domainBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  domainBannerIcon: {
    marginTop: 2,
  },
  domainBannerTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    marginBottom: 3,
  },
  domainBannerBody: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: Spacing.sm,
    alignSelf: "flex-start",
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: "#D97706",
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
  },
  shareBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: "#92400E",
  },
});
