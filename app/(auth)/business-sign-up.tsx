import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, extractDomain } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { logoObjectNameAndContentType } from "@/lib/storageImageMeta";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const PLANS = [
  {
    key: "free",
    name: "Scout Basic",
    price: "$29/mo",
    features: ["Up to 10 active users", "Basic matching", "No analytics"],
  },
  {
    key: "starter",
    name: "Momentum Growth",
    price: "$49/mo",
    features: [
      "20 active users included",
      "$2 per additional active user",
      "Analytics + coordination",
    ],
  },
  {
    key: "business",
    name: "Pulse Business",
    price: "$99/mo",
    features: [
      "100 active users included",
      "$1.50 per additional active user",
      "Priority matching + admin controls",
    ],
  },
  {
    key: "enterprise",
    name: "Orbit Enterprise",
    price: "Contact us",
    features: ["Custom SLA", "Fallback ride guarantees", "Custom integrations"],
  },
] as const;

type PlanKey = (typeof PLANS)[number]["key"];
const INDUSTRY_OPTIONS = [
  "Technology",
  "Education",
  "Healthcare",
  "Finance",
  "Manufacturing",
  "Retail",
  "Logistics",
  "Government",
  "Hospitality",
  "Other",
] as const;
const HEAR_ABOUT_OPTIONS = [
  "LinkedIn",
  "Google Search",
  "Friend or colleague",
  "Employee referral",
  "Event or conference",
  "Other",
] as const;

export default function BusinessSignUp() {
  const { session, profile, isLoading, refreshProfile } = useAuth();

  const [step, setStep] = useState(1);

  // Step 1 — Admin Details
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  // Step 2 — Organisation Setup
  const [orgName, setOrgName] = useState("");
  const [orgDomain, setOrgDomain] = useState("");
  const [staffSize, setStaffSize] = useState("");
  const [industry, setIndustry] =
    useState<(typeof INDUSTRY_OPTIONS)[number]>("Technology");
  const [otherIndustry, setOtherIndustry] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [hearAboutUs, setHearAboutUs] =
    useState<(typeof HEAR_ABOUT_OPTIONS)[number]>("LinkedIn");
  const [otherHearAbout, setOtherHearAbout] = useState("");
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [showIndustryOptions, setShowIndustryOptions] = useState(false);
  const [showReferralOptions, setShowReferralOptions] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  /** After picking from the list, skip one autocomplete run (otherwise the full address re-triggers Mapbox and the dropdown reopens with a duplicate). */
  const addressJustSelectedFromList = useRef(false);
  /** Lets suggestion `onPress` run before blur clears the list (web). */
  const addressBlurClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3 — Plan Selection
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>("starter");

  // Shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // TEMP: testing mode, allow any email domain.
  // const emailDomain = email.includes("@") ? extractDomain(email) : "";
  // const isValidWorkEmail = email.includes("@") && isWorkEmail(email);

  function clearError() {
    setError("");
  }

  const effectiveIndustry = industry === "Other" ? otherIndustry.trim() : industry;
  const effectiveHearAbout =
    hearAboutUs === "Other" ? otherHearAbout.trim() : hearAboutUs;

  async function handlePickLogo() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setError("Please allow photo access to upload your company logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (uri) {
      clearError();
      setLogoUri(uri);
    }
  }

  async function uploadBusinessLogo(
    orgId: string
  ): Promise<{ path: string | null; error: string | null }> {
    if (!logoUri) return { path: null, error: null };
    setUploadingLogo(true);
    try {
      const response = await fetch(logoUri);
      if (!response.ok) {
        return { path: null, error: `Could not read logo file (${response.status})` };
      }
      const buf = await response.arrayBuffer();
      const { objectName, contentType } = logoObjectNameAndContentType(
        logoUri,
        response.headers.get("content-type"),
        buf
      );
      const path = `${orgId}/${objectName}`;
      const body = new Uint8Array(buf);
      const { error: uploadError } = await supabase.storage.from("org-logos").upload(path, body, {
        contentType,
        cacheControl: "3600",
        upsert: true,
      });
      if (uploadError) {
        return { path: null, error: uploadError.message };
      }
      return { path, error: null };
    } catch (e) {
      return {
        path: null,
        error: e instanceof Error ? e.message : "Logo upload failed",
      };
    } finally {
      setUploadingLogo(false);
    }
  }

  useEffect(() => {
    if (!session?.user) return;
    setEmail((prev) => prev || session.user.email || "");
    setFullName((prev) => prev || profile?.full_name || "");
  }, [session?.user, profile?.full_name]);

  useEffect(() => {
    const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!businessAddress.trim() || businessAddress.trim().length < 3 || !mapboxToken) {
      setAddressSuggestions([]);
      return;
    }

    if (addressJustSelectedFromList.current) {
      addressJustSelectedFromList.current = false;
      setAddressSuggestions([]);
      setSearchingAddress(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setSearchingAddress(true);
        const q = businessAddress.trim();
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
            q
          )}.json?access_token=${mapboxToken}&types=address,place&autocomplete=true&limit=6&proximity=ip`
        );
        const payload = (await response.json()) as {
          features?: { place_name: string }[];
        };
        if (Array.isArray(payload.features)) {
          const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
          const qn = norm(q);
          const names = payload.features
            .map((f) => f.place_name)
            .filter((name) => norm(name) !== qn);
          setAddressSuggestions(names.slice(0, 5));
        } else {
          setAddressSuggestions([]);
        }
      } catch {
        setAddressSuggestions([]);
      } finally {
        setSearchingAddress(false);
      }
    }, 350);

    return () => clearTimeout(timeoutId);
  }, [businessAddress]);

  async function handleStep1Continue() {
    clearError();
    if (!profile?.id) {
      setError("Please sign in and verify your email before continuing.");
      return;
    }
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase
      .from("users")
      .update({ full_name: fullName.trim() })
      .eq("id", profile.id);
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setOrgDomain(extractDomain(email.trim().toLowerCase()));
    setStep(2);
  }

  async function handleStep2Continue() {
    clearError();
    if (!orgName.trim()) {
      setError("Organisation name is required.");
      return;
    }
    if (!businessAddress.trim()) {
      setError("Business address is required.");
      return;
    }
    if (!effectiveIndustry) {
      setError("Industry is required.");
      return;
    }
    if (!effectiveHearAbout) {
      setError("Please tell us how you heard about us.");
      return;
    }
    const d = orgDomain.trim().toLowerCase().replace(/^@/, "");
    setLoading(true);
    const { data: dupData, error: dupErr } = await supabase.rpc(
      "enterprise_org_domain_duplicate_check",
      { p_domain: d }
    );
    setLoading(false);
    if (dupErr) {
      setError(dupErr.message);
      return;
    }
    const dup = dupData as { ok?: boolean; reason?: string } | null;
    if (!dup?.ok) {
      setError(dup?.reason ?? "This domain is not available.");
      return;
    }
    setStep(3);
  }

  function handleStep3Continue() {
    clearError();
    setStep(4);
  }

  async function handleCreateOrg() {
    clearError();
    setLoading(true);

    const userId = profile?.id;
    if (!userId) {
      setError("Account not ready. Please wait a moment and try again.");
      setLoading(false);
      return;
    }

    const normalizedDomain = orgDomain.trim().toLowerCase().replace(/^@/, "");
    let data: any = null;
    let rpcError: any = null;

    const { data: domainStatus, error: domainStatusErr } = await supabase.rpc(
      "enterprise_org_domain_status",
      { p_domain: normalizedDomain }
    );
    if (domainStatusErr) {
      setLoading(false);
      setError(domainStatusErr.message);
      return;
    }
    const st = domainStatus as { ok?: boolean; reason?: string } | null;
    if (!st?.ok) {
      setLoading(false);
      setError(st?.reason ?? "This domain cannot be used for a new organisation.");
      return;
    }

    const createWithPlan = await supabase.rpc("create_enterprise_org", {
      org_name: orgName.trim(),
      org_domain: normalizedDomain,
      admin_user_id: userId,
      plan_name: selectedPlan,
    });
    data = createWithPlan.data;
    rpcError = createWithPlan.error;

    // Backward-compatible retry only when function signature differs.
    if (
      rpcError &&
      String(rpcError.message).includes(
        "Could not find the function public.create_enterprise_org(admin_user_id, org_domain, org_name, plan_name)"
      )
    ) {
      const retryWithoutPlan = await supabase.rpc("create_enterprise_org", {
        org_name: orgName.trim(),
        org_domain: normalizedDomain,
        admin_user_id: userId,
      });
      data = retryWithoutPlan.data;
      rpcError = retryWithoutPlan.error;
    }

    if (rpcError) {
      setLoading(false);
      if (String(rpcError.message).includes("Could not find the function public.create_enterprise_org")) {
        setError(
          "Database function is missing. Please run migrations up to 0011 and retry."
        );
      } else {
        setError(rpcError.message);
      }
      return;
    }

    const createdOrgId = data?.id;
    if (!createdOrgId) {
      setLoading(false);
      setError("Organisation setup returned no id. Please retry.");
      return;
    }

    const logoResult = await uploadBusinessLogo(createdOrgId);
    const logoPath = logoResult.path;

    const { error: metadataError } = await supabase
      .from("organisations")
      .update({
        estimated_team_size: staffSize ? Number(staffSize) : null,
        work_locations: [businessAddress.trim()],
        settings: {
          industry: effectiveIndustry,
          business_phone: businessPhone.trim() || null,
          hear_about_us: effectiveHearAbout,
          logo_path: logoPath,
        },
      })
      .eq("id", createdOrgId);

    setLoading(false);
    if (metadataError) {
      setError(metadataError.message);
      return;
    }

    if (logoResult.error && logoUri) {
      showAlert(
        "Logo not uploaded",
        `Your workplace network is ready. The logo did not save (${logoResult.error}). You can add it later from admin settings.`
      );
    }

    await refreshProfile();
    router.replace("/(admin)/org-paywall");
  }

  function goBack() {
    clearError();
    setStep((s) => s - 1);
  }

  const selectedPlanData = PLANS.find((p) => p.key === selectedPlan)!;
  const progressWidth = `${(step / 4) * 100}%` as const;

  // ─── Step 1: Admin Details ───
  function renderStep1() {
    return (
      <>
        <Text style={styles.stepTitle}>Carpool Program Admin Details</Text>
        <Text style={styles.stepSubtitle}>
          Confirm administrator details before creating your network
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full name</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="person-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Jane Smith"
              placeholderTextColor={Colors.textTertiary}
              value={fullName}
              onChangeText={(t) => { clearError(); setFullName(t); }}
              autoCapitalize="words"
              autoComplete="name"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="mail-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="you@company.com"
              placeholderTextColor={Colors.textTertiary}
              value={email}
              onChangeText={(t) => { clearError(); setEmail(t); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>
        </View>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleStep1Continue}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </>
    );
  }

  // ─── Step 2: Organisation Setup ───
  function renderStep2() {
    return (
      <>
        <Text style={styles.stepTitle}>Business profile</Text>
        <Text style={styles.stepSubtitle}>
          Tell us about your organisation before selecting a plan
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Company / organisation name</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="business-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Acme Corp"
              placeholderTextColor={Colors.textTertiary}
              value={orgName}
              onChangeText={(t) => { clearError(); setOrgName(t); }}
              autoCapitalize="words"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email domain</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="globe-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="company.com"
              placeholderTextColor={Colors.textTertiary}
              value={orgDomain}
              onChangeText={(t) => { clearError(); setOrgDomain(t); }}
              keyboardType="url"
              autoCapitalize="none"
            />
          </View>
          <Text style={styles.domainHint}>
            Colleagues with @{orgDomain || "domain"} emails will auto-link to
            this network.
          </Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Industry</Text>
          <TouchableOpacity
            style={styles.dropdownBtn}
            onPress={() => setShowIndustryOptions((prev) => !prev)}
            activeOpacity={0.8}
          >
            <Ionicons name="briefcase-outline" size={20} color={Colors.textTertiary} style={styles.inputIcon} />
            <Text style={styles.dropdownValue}>{industry}</Text>
            <Ionicons
              name={showIndustryOptions ? "chevron-up-outline" : "chevron-down-outline"}
              size={18}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
          {showIndustryOptions ? (
            <View style={styles.dropdownList}>
              {INDUSTRY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={styles.dropdownItem}
                  onPress={() => {
                    clearError();
                    setIndustry(option);
                    setShowIndustryOptions(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {industry === "Other" ? (
            <View style={[styles.inputWrapper, { marginTop: Spacing.sm }]}>
              <Ionicons name="create-outline" size={20} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter industry"
                placeholderTextColor={Colors.textTertiary}
                value={otherIndustry}
                onChangeText={setOtherIndustry}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business address</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="location-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="HQ or primary office address"
              placeholderTextColor={Colors.textTertiary}
              value={businessAddress}
              onChangeText={(t) => {
                clearError();
                setBusinessAddress(t);
              }}
              onBlur={() => {
                addressBlurClearTimer.current = setTimeout(() => {
                  setAddressSuggestions([]);
                  setSearchingAddress(false);
                  addressBlurClearTimer.current = null;
                }, 250);
              }}
              onFocus={() => {
                if (addressBlurClearTimer.current) {
                  clearTimeout(addressBlurClearTimer.current);
                  addressBlurClearTimer.current = null;
                }
              }}
              autoCapitalize="words"
            />
          </View>
          {searchingAddress ? (
            <Text style={styles.logoSelected}>Searching Google Maps...</Text>
          ) : null}
          {addressSuggestions.length > 0 ? (
            <View style={styles.dropdownList}>
              {addressSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion}
                  style={styles.dropdownItem}
                  onPress={() => {
                    if (addressBlurClearTimer.current) {
                      clearTimeout(addressBlurClearTimer.current);
                      addressBlurClearTimer.current = null;
                    }
                    addressJustSelectedFromList.current = true;
                    setBusinessAddress(suggestion);
                    setAddressSuggestions([]);
                    setSearchingAddress(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>{suggestion}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {!process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ? (
            <Text style={styles.errorHint}>
              Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env to enable address autofill.
            </Text>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Business phone (optional)</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="call-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="+27 12 345 6789"
              placeholderTextColor={Colors.textTertiary}
              value={businessPhone}
              onChangeText={setBusinessPhone}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Staff size (approx.)</Text>
          <View style={styles.inputWrapper}>
            <Ionicons
              name="people-outline"
              size={20}
              color={Colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="e.g. 50"
              placeholderTextColor={Colors.textTertiary}
              value={staffSize}
              onChangeText={setStaffSize}
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>How did you hear about us?</Text>
          <TouchableOpacity
            style={styles.dropdownBtn}
            onPress={() => setShowReferralOptions((prev) => !prev)}
            activeOpacity={0.8}
          >
            <Ionicons name="megaphone-outline" size={20} color={Colors.textTertiary} style={styles.inputIcon} />
            <Text style={styles.dropdownValue}>{hearAboutUs}</Text>
            <Ionicons
              name={showReferralOptions ? "chevron-up-outline" : "chevron-down-outline"}
              size={18}
              color={Colors.textTertiary}
            />
          </TouchableOpacity>
          {showReferralOptions ? (
            <View style={styles.dropdownList}>
              {HEAR_ABOUT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={styles.dropdownItem}
                  onPress={() => {
                    setHearAboutUs(option);
                    setShowReferralOptions(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {hearAboutUs === "Other" ? (
            <View style={[styles.inputWrapper, { marginTop: Spacing.sm }]}>
              <Ionicons name="create-outline" size={20} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Tell us where you heard about Poolyn"
                placeholderTextColor={Colors.textTertiary}
                value={otherHearAbout}
                onChangeText={setOtherHearAbout}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Logo upload (optional)</Text>
          <TouchableOpacity style={styles.logoPicker} onPress={handlePickLogo} activeOpacity={0.8}>
            <Ionicons name="image-outline" size={18} color={Colors.primary} />
            <Text style={styles.logoPickerText}>
              {logoUri ? "Change logo image" : "Upload logo image"}
            </Text>
          </TouchableOpacity>
          {logoUri ? <Image source={{ uri: logoUri }} style={styles.logoPreview} /> : null}
          {logoUri ? (
            <Text style={styles.logoSelected}>Logo selected. It uploads when you finish creating your network.</Text>
          ) : null}
          {uploadingLogo ? <Text style={styles.logoSelected}>Uploading logo...</Text> : null}
        </View>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}

        <TouchableOpacity
          style={styles.button}
          onPress={handleStep2Continue}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </>
    );
  }

  // ─── Step 3: Plan Selection ───
  function renderStep3() {
    return (
      <>
        <Text style={styles.stepTitle}>Choose a managed plan</Text>
        <Text style={styles.stepSubtitle}>
          Managed networks get priority matching, analytics, and controls.
        </Text>

        <View style={styles.planGrid}>
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.key;
            return (
              <TouchableOpacity
                key={plan.key}
                style={[
                  styles.planCard,
                  isSelected && styles.planCardSelected,
                ]}
                onPress={() => setSelectedPlan(plan.key)}
                activeOpacity={0.7}
              >
                <View style={styles.planHeader}>
                  <Text
                    style={[
                      styles.planName,
                      isSelected && styles.planNameSelected,
                    ]}
                  >
                    {plan.name}
                  </Text>
                  {isSelected && (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color={Colors.primary}
                    />
                  )}
                </View>
                <Text
                  style={[
                    styles.planPrice,
                    isSelected && styles.planPriceSelected,
                  ]}
                >
                  {plan.price}
                </Text>
                {plan.features.map((f) => (
                  <View key={f} style={styles.planFeatureRow}>
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={isSelected ? Colors.primary : Colors.textTertiary}
                    />
                    <Text
                      style={[
                        styles.planFeatureText,
                        isSelected && styles.planFeatureTextSelected,
                      ]}
                    >
                      {f}
                    </Text>
                  </View>
                ))}
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.button}
          onPress={handleStep3Continue}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </>
    );
  }

  // ─── Step 4: Review & Create ───
  function renderStep4() {
    return (
      <>
        <Text style={styles.stepTitle}>Review & create</Text>
        <Text style={styles.stepSubtitle}>
          Confirm your organisation details
        </Text>

        <View style={styles.reviewCard}>
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Organisation</Text>
            <Text style={styles.reviewValue}>{orgName}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Domain</Text>
            <Text style={styles.reviewValue}>{orgDomain}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Industry</Text>
            <Text style={styles.reviewValue}>{effectiveIndustry || "-"}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Address</Text>
            <Text style={styles.reviewValue}>{businessAddress || "-"}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Phone</Text>
            <Text style={styles.reviewValue}>{businessPhone || "Not provided"}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Staff size</Text>
            <Text style={styles.reviewValue}>{staffSize || "-"}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>How you heard about us</Text>
            <Text style={styles.reviewValue}>{effectiveHearAbout || "-"}</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewRow}>
            <Text style={styles.reviewLabel}>Plan</Text>
            <Text style={styles.reviewValue}>
              {selectedPlanData.name} ({selectedPlanData.price})
            </Text>
          </View>
        </View>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleCreateOrg}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.buttonText}>Set up organisation</Text>
          )}
        </TouchableOpacity>
      </>
    );
  }

  const stepRenderers: Record<number, () => React.JSX.Element> = {
    1: renderStep1,
    2: renderStep2,
    3: renderStep3,
    4: renderStep4,
  };

  if (isLoading) {
    return (
      <View style={styles.loadingCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!session?.user) {
    return (
      <View style={styles.authGateContainer}>
        <View style={styles.authGateCard}>
          <Ionicons name="business-outline" size={44} color={Colors.primary} />
          <Text style={styles.authGateTitle}>Welcome to Network Setup</Text>
          <Text style={styles.authGateBody}>
            To keep networks secure, sign in with your verified account first.
            Then you can create your managed workplace network in a few steps.
          </Text>
          <View style={styles.authGateHint}>
            <Ionicons name="checkmark-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.authGateHintText}>No code needed to get started</Text>
          </View>
          <View style={styles.authGateHint}>
            <Ionicons name="checkmark-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.authGateHintText}>You can invite your team after setup</Text>
          </View>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace("/(auth)/sign-in?next=business-sign-up")}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Go to sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace("/(auth)/sign-up?next=business-sign-up")}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>Create account</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (session?.user && !profile?.id) {
    return (
      <View style={styles.authGateContainer}>
        <View style={styles.authGateCard}>
          <Ionicons name="time-outline" size={42} color={Colors.primary} />
          <Text style={styles.authGateTitle}>Preparing your account</Text>
          <Text style={styles.authGateBody}>
            Your profile is still loading. Please refresh and try again.
          </Text>
          <TouchableOpacity style={styles.button} onPress={refreshProfile} activeOpacity={0.8}>
            <Text style={styles.buttonText}>Retry</Text>
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
        {/* Top navigation row */}
        <View style={styles.topRow}>
          {step > 1 ? (
            <TouchableOpacity
              style={styles.backButton}
              onPress={goBack}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={24} color={Colors.text} />
            </TouchableOpacity>
          ) : step === 1 ? (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={24} color={Colors.text} />
            </TouchableOpacity>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
          <Text style={styles.stepIndicator}>Step {step} of 4</Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: progressWidth }]} />
        </View>

        {stepRenderers[step]()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loadingCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  authGateContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  authGateCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    alignItems: "center",
    ...Shadow.md,
  },
  authGateTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  authGateBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.base,
  },
  authGateHint: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  authGateHintText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["3xl"],
  },

  // ── Top bar ──
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 60,
    marginBottom: Spacing.base,
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
  backPlaceholder: {
    width: 40,
  },
  stepIndicator: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },

  // ── Progress ──
  progressTrack: {
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    marginBottom: Spacing.xl,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },

  // ── Headings ──
  stepTitle: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  stepSubtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginBottom: Spacing["2xl"],
    lineHeight: 22,
  },

  // ── Inputs ──
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
  multilineWrapper: {
    alignItems: "flex-start",
    minHeight: 88,
    paddingTop: Spacing.sm,
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
  multilineInput: {
    minHeight: 70,
    textAlignVertical: "top",
  },
  dropdownBtn: {
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
  dropdownValue: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  dropdownList: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  dropdownItemText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  logoPicker: {
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.xs,
  },
  logoPickerText: {
    fontSize: FontSize.sm,
    color: Colors.primaryDark,
    fontWeight: FontWeight.semibold,
  },
  logoSelected: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  logoPreview: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorHint: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  domainHint: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    marginTop: Spacing.xs,
  },
  inlineError: {
    fontSize: FontSize.sm,
    color: Colors.error,
    backgroundColor: Colors.errorLight,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.base,
    overflow: "hidden",
  },

  // ── Button ──
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
  secondaryButton: {
    borderRadius: BorderRadius.md,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    width: "100%",
  },
  secondaryButtonText: {
    color: Colors.text,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },

  // ── Plan cards ──
  planGrid: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  planCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  planName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  planNameSelected: {
    color: Colors.primaryDark,
  },
  planPrice: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  planPriceSelected: {
    color: Colors.primaryDark,
  },
  planFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  planFeatureText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  planFeatureTextSelected: {
    color: Colors.primaryDark,
  },

  // ── Review ──
  reviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadow.sm,
  },
  reviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  reviewLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  reviewValue: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    flexShrink: 1,
    textAlign: "right",
  },
  reviewDivider: {
    height: 1,
    backgroundColor: Colors.divider,
  },

  // ── Success / invite ──
  successContainer: {
    alignItems: "center",
    paddingTop: Spacing.xl,
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
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.base,
  },
  bold: {
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  codeBox: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.base,
    ...Shadow.sm,
  },
  codeText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: 2,
    textAlign: "center",
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryLight,
    marginBottom: Spacing.md,
  },
  copyButtonText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  shareHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing["2xl"],
  },
});
