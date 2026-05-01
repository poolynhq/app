import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Linking,
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
  formatWaitlistSignupError,
  logWaitlistSignupFailure,
} from "@/lib/waitlistSignupErrors";
import { waitlistWorkEmailRejectReason } from "@/constants/consumerEmailDomains";
import { markWaitlistJoinedInSession } from "@/lib/waitlistSessionFlags";
import {
  submitWaitlistSignup,
  type WaitlistIntent,
} from "@/lib/waitlistSignup";

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultIntent?: WaitlistIntent;
};

type ModalPhase = "path_select" | "commuter" | "org" | "done";

// Commuter: 0=benefits 1=pain 2=cost 3=days 4=trust 5=role 6=form
const COMMUTER_TOTAL = 7;
// Org: 0=challenge 1=size 2=subsidy 3=form
const ORG_TOTAL = 4;

// ─── Data ─────────────────────────────────────────────────────────────────────

const COMMUTER_BENEFITS = [
  { stat: "40%", desc: "average reduction in annual commute costs", icon: "cash-outline" as const },
  { stat: "200+", desc: "hours reclaimed per year on shared rides", icon: "time-outline" as const },
  { stat: "0", desc: "awkward cash splits or payment drama", icon: "happy-outline" as const },
];

const COMMUTER_PAIN = [
  { key: "parking", label: "🅿️  Finding and paying for parking every single day" },
  { key: "traffic", label: "🚗  Too many cars, too much congestion" },
  { key: "cost", label: "💸  Money disappearing on fuel, tolls, and servicing" },
  { key: "stress", label: "😤  The stress of driving every single morning" },
  { key: "lonely", label: "😔  Getting lonely and bored driving alone" },
  { key: "other", label: "✏️  Other" },
];

const COMMUTER_COST = [
  { key: "under250", label: "Under $250, I'm managing" },
  { key: "250to600", label: "$250-$600, a significant chunk of my income" },
  { key: "over600", label: "$600+, basically a second car payment" },
];

const COMMUTER_DAYS = [
  { key: "1-2", label: "1-2 days" },
  { key: "3", label: "3 days" },
  { key: "4-5", label: "4-5 days" },
];

const COMMUTER_TRUST = [
  { key: "dont_know", label: "Not knowing them well enough personally" },
  { key: "schedule", label: "Worrying about schedule flexibility" },
  { key: "awkward", label: "Concerns about awkward conversations" },
  { key: "nothing", label: "Nothing. I'd try it tomorrow." },
  { key: "carpooled", label: "I've carpooled before, just no good platform" },
  { key: "other", label: "✏️  Other" },
];

const COMMUTER_ROLE = [
  { key: "ev", label: "⚡  I drive an EV and want to offer rides" },
  { key: "standard", label: "🚗  I drive a standard vehicle and want to split costs" },
  { key: "passenger", label: "👋  I'd prefer to be a passenger for now" },
  { key: "other", label: "✏️  Other" },
];

const ORG_CHALLENGE = [
  { key: "parking", label: "🅿️  Not enough parking spaces for staff" },
  { key: "esg", label: "🌍  Reduce and track Scope 3 / ESG emissions" },
  { key: "rto", label: "🏢  Return-to-Office (RTO) friction from staff" },
  { key: "cost", label: "💸  High cost of subsidizing employee parking or transit" },
];

const ORG_SIZE = [
  { key: "under50", label: "Under 50" },
  { key: "50to250", label: "50-250" },
  { key: "250to1000", label: "250-1,000" },
  { key: "over1000", label: "1,000+" },
];

const ORG_SUBSIDY = [
  { key: "yes", label: "Yes, and it's expensive" },
  { key: "no", label: "No, but we're actively looking for solutions" },
  { key: "transit", label: "We offer transit passes, but utilization is low" },
];

const STAT_BUBBLES: Record<string, string> = {
  "commuter-1":
    "Parking and fuel should not feel like a second rent payment. Poolyn commuters split costs and guarantee their spot.",
  "commuter-2":
    "The average driver spends over $1,000/year just on maintenance. Poolyn drivers can cut those costs by up to 50% by sharing the journey.",
  "commuter-4":
    "Every one of these is exactly why we built Poolyn. Our gated, professional-only network is designed for your peace of mind, with built-in tools to break the ice on the ride.",
  "org-0":
    "Every empty seat in an employee's car is a wasted parking spot and an unnecessary carbon footprint.",
};

const STEP_TITLES: Record<string, string[]> = {
  commuter: [
    "Here's what changes.",
    "Be honest. What's the worst part of your commute?",
    "What is your commute actually costing each month?",
    "How many days a week do you head into the office?",
    "What would make you hesitate to share a ride?",
    "How would you like to contribute?",
    "Your professional network is forming.",
  ],
  org: [
    "What's your organization's biggest commuting challenge?",
    "How many employees commute to your primary location?",
    "Does your company currently offer commuting subsidies?",
    "Let's fix your parking demand.",
  ],
};

const STEP_SUBS: Record<string, string[]> = {
  commuter: [
    "Real numbers from professionals who made the switch.",
    "Select all that apply.",
    "Think fuel, tolls, parking, servicing, and wear-and-tear.",
    "This helps us understand your route's peak demand.",
    "Select all that apply.",
    "This helps us build the right network for you.",
    "Early members get priority route matching when we launch.",
  ],
  org: [
    "Select the challenge closest to your current reality.",
    "This helps us understand the scale of your need.",
    "Understanding your current setup helps us tailor the right solution.",
    "Request an enterprise pilot and we'll be in touch within 48 hours.",
  ],
};

const CTA_LABELS: Record<string, string[]> = {
  commuter: [
    "Sounds good. Show me more",
    "Continue",
    "Continue",
    "Continue",
    "Continue",
    "Almost there",
    "Claim early access",
  ],
  org: ["Continue", "Continue", "Continue", "Request Enterprise Pilot"],
};

// ─── Profile label maps for success screen ────────────────────────────────────

const PAIN_LABELS: Record<string, string> = {
  parking: "Parking costs",
  traffic: "Road congestion",
  cost: "The cost",
  stress: "Daily driving stress",
  lonely: "Commuting alone",
  other: "Other",
};

const PAIN_ORDER = ["parking", "traffic", "cost", "stress", "lonely", "other"];

const COST_LABELS: Record<string, string> = {
  under250: "Under $250 / mo",
  "250to600": "$250-$600 / mo",
  over600: "Over $600 / mo",
};

const DAYS_LABELS: Record<string, string> = {
  "1-2": "1-2 days / week",
  "3": "3 days / week",
  "4-5": "4-5 days / week",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basicEmailOk(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function toggleSet(s: Set<string>, key: string): Set<string> {
  const n = new Set(s);
  if (n.has(key)) n.delete(key);
  else n.add(key);
  return n;
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBubble({ text }: { text: string }) {
  return (
    <View style={styles.statBubble}>
      <Ionicons
        name="information-circle-outline"
        size={15}
        color={Landing.tealDark}
        style={{ flexShrink: 0, marginTop: 2 }}
      />
      <Text style={styles.statBubbleText}>{text}</Text>
    </View>
  );
}

function OptionChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.optionChip, selected && styles.optionChipOn]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      <Text style={[styles.optionChipText, selected && styles.optionChipTextOn]}>
        {label}
      </Text>
      <View style={[styles.optionCheck, selected && styles.optionCheckOn]}>
        {selected ? <Ionicons name="checkmark" size={11} color={Landing.white} /> : null}
      </View>
    </Pressable>
  );
}

function ProfileRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileRowLabel}>{label}</Text>
      <Text style={[styles.profileRowValue, highlight && styles.profileRowValueHighlight]}>
        {value}
      </Text>
    </View>
  );
}

function NextStepBadge({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.stepBadgeRow}>
      <View style={styles.stepBadgeCircle}>
        <Text style={styles.stepBadgeNum}>{n}</Text>
      </View>
      <Text style={styles.stepBadgeText}>{text}</Text>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WaitlistModal({ visible, onClose, defaultIntent }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurSuburbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<ModalPhase>("path_select");
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [completedPath, setCompletedPath] = useState<"commuter" | "org">("commuter");

  // Commuter survey
  const [commPains, setCommPains] = useState<Set<string>>(new Set());
  const [commPainOther, setCommPainOther] = useState("");
  const [commCost, setCommCost] = useState<string | null>(null);
  const [commDays, setCommDays] = useState<string | null>(null);
  const [commTrust, setCommTrust] = useState<Set<string>>(new Set());
  const [commTrustOther, setCommTrustOther] = useState("");
  const [commRole, setCommRole] = useState<string | null>(null);
  const [commRoleOther, setCommRoleOther] = useState("");

  // Org survey
  const [orgChallenge, setOrgChallenge] = useState<string | null>(null);
  const [orgSize, setOrgSize] = useState<string | null>(null);
  const [orgSubsidy, setOrgSubsidy] = useState<string | null>(null);

  // Forms
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [suburb, setSuburb] = useState("");
  const [suburbSuggestions, setSuburbSuggestions] = useState<string[]>([]);
  const [suburbFocused, setSuburbFocused] = useState(false);
  const [workLocation, setWorkLocation] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  // Submission
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState("");

  useEffect(() => {
    return () => {
      if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
      if (blurSuburbTimer.current) clearTimeout(blurSuburbTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (defaultIntent === "organization") {
      setPhase("org");
      setStep(0);
    } else if (defaultIntent === "individual") {
      setPhase("commuter");
      setStep(0);
    }
  }, [visible, defaultIntent]);

  function reset() {
    setPhase("path_select");
    setStep(0);
    setDone(false);
    setCommPains(new Set());
    setCommPainOther("");
    setCommCost(null);
    setCommDays(null);
    setCommTrust(new Set());
    setCommTrustOther("");
    setCommRole(null);
    setCommRoleOther("");
    setOrgChallenge(null);
    setOrgSize(null);
    setOrgSubsidy(null);
    setEmail("");
    setEmailHint(null);
    setFullName("");
    setSuburb("");
    setSuburbSuggestions([]);
    setSuburbFocused(false);
    setWorkLocation("");
    setCompanyName("");
    setJobTitle("");
    setLoading(false);
    setError(null);
    setConfirmedEmail("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  function scrollTop() {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function goBack() {
    setError(null);
    if (step === 0) {
      setPhase("path_select");
    } else {
      setStep((s) => s - 1);
    }
    scrollTop();
  }

  function goNext() {
    setError(null);
    setStep((s) => s + 1);
    scrollTop();
  }

  function selectPath(p: "commuter" | "org") {
    setPhase(p);
    setStep(0);
    scrollTop();
  }

  // Real-time corporate email hint — debounced 700ms
  function onEmailChange(text: string) {
    setEmail(text);
    setEmailHint(null);
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    if (!text.trim() || text.length < 6) return;
    emailCheckTimer.current = setTimeout(() => {
      if (!basicEmailOk(text)) return;
      const reason = waitlistWorkEmailRejectReason(text);
      if (reason) setEmailHint(reason);
    }, 700);
  }

  // Suburb autocomplete (require 2+ chars before showing suggestions)
  function onSuburbChange(text: string) {
    setSuburb(text);
    setSuburbSuggestions(text.trim().length >= 2 ? filterMetroAreas(text) : []);
  }

  function onSuburbFocus() {
    if (blurSuburbTimer.current) clearTimeout(blurSuburbTimer.current);
    setSuburbFocused(true);
    if (suburb.trim()) setSuburbSuggestions(filterMetroAreas(suburb));
  }

  function onSuburbBlur() {
    blurSuburbTimer.current = setTimeout(() => {
      setSuburbFocused(false);
      setSuburbSuggestions([]);
    }, 200);
  }

  function pickSuburb(value: string) {
    if (blurSuburbTimer.current) clearTimeout(blurSuburbTimer.current);
    setSuburb(value);
    setSuburbSuggestions([]);
    setSuburbFocused(false);
    Keyboard.dismiss();
  }

  // Share handlers
  function handleShareLinkedIn() {
    Linking.openURL(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://poolyn.com")}`
    );
  }

  function handleShareEmail() {
    const subject = "Join me on Poolyn, smarter professional commuting";
    const body = `I just reserved my spot on Poolyn. It matches verified professionals on the same commute route, cutting costs and making the journey way better. Reserve yours: https://poolyn.com`;
    Linking.openURL(
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    );
  }

  function handleShareWhatsApp() {
    const text = `I just reserved my spot on Poolyn! Join me and let's make our commute smarter together: https://poolyn.com`;
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
  }

  const isCommuterForm = phase === "commuter" && step === 6;
  const isOrgForm = phase === "org" && step === 3;
  const isFormStep = isCommuterForm || isOrgForm;

  function canAdvance(): boolean {
    if (phase === "commuter") {
      if (step === 0) return true;
      if (step === 1) return commPains.size > 0;
      if (step === 2) return commCost !== null;
      if (step === 3) return commDays !== null;
      if (step === 4) return commTrust.size > 0;
      if (step === 5) return commRole !== null;
      if (step === 6)
        return basicEmailOk(email) && !emailHint && suburb.trim().length > 0;
    }
    if (phase === "org") {
      if (step === 0) return orgChallenge !== null;
      if (step === 1) return orgSize !== null;
      if (step === 2) return orgSubsidy !== null;
      if (step === 3)
        return (
          basicEmailOk(email) &&
          !emailHint &&
          companyName.trim().length > 0 &&
          jobTitle.trim().length > 0
        );
    }
    return false;
  }

  async function onSubmit() {
    setError(null);
    if (!basicEmailOk(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    const workErr = waitlistWorkEmailRejectReason(email);
    if (workErr) {
      setError(workErr);
      return;
    }
    setLoading(true);
    const intent: WaitlistIntent = phase === "org" ? "organization" : "individual";
    const metroArea = phase === "commuter" ? suburb.trim() || undefined : undefined;
    const nameField =
      phase === "commuter"
        ? fullName.trim() || undefined
        : `${companyName.trim()}, ${jobTitle.trim()}` || undefined;

    const { error: insertError } = await submitWaitlistSignup({
      email,
      fullName: nameField,
      metroArea,
      intent,
      source: `landing_modal_${phase}`,
      // Commuter survey answers
      ...(phase === "commuter" ? {
        commutePainKeys:  Array.from(commPains),
        commutePainOther: commPainOther.trim() || undefined,
        commuteCost:      commCost ?? undefined,
        commuteDays:      commDays ?? undefined,
        commuteTrustKeys: Array.from(commTrust),
        commuteTrustOther: commTrustOther.trim() || undefined,
        commuteRole:      commRole ?? undefined,
        commuteRoleOther: commRoleOther.trim() || undefined,
        workLocation:     workLocation.trim() || undefined,
      } : {}),
      // Organisation survey answers
      ...(phase === "org" ? {
        orgChallenge: orgChallenge ?? undefined,
        orgSize:      orgSize ?? undefined,
        orgSubsidy:   orgSubsidy ?? undefined,
        companyName:  companyName.trim() || undefined,
        jobTitle:     jobTitle.trim() || undefined,
      } : {}),
    });
    setLoading(false);
    if (insertError) {
      logWaitlistSignupFailure({
        code: insertError.code,
        message: insertError.message,
        details: insertError.details ?? null,
        hint: insertError.hint ?? null,
      });
      if (insertError.code === "23505") {
        markWaitlistJoinedInSession();
        setError("That email is already on the list. We'll be in touch.");
      } else {
        setError(formatWaitlistSignupError(insertError));
      }
      return;
    }
    markWaitlistJoinedInSession();
    setCompletedPath(phase === "org" ? "org" : "commuter");
    setConfirmedEmail(email.trim().toLowerCase());
    setDone(true);
    scrollTop();
  }

  // ── Computed ────────────────────────────────────────────────────────────────

  const totalSteps =
    phase === "commuter" ? COMMUTER_TOTAL : phase === "org" ? ORG_TOTAL : 0;

  const stepTitle =
    phase !== "path_select" && phase !== "done"
      ? (STEP_TITLES[phase]?.[step] ?? "")
      : "";

  const stepSub =
    phase !== "path_select" && phase !== "done"
      ? (STEP_SUBS[phase]?.[step] ?? "")
      : "";

  const ctaLabel =
    phase !== "path_select" && phase !== "done"
      ? (CTA_LABELS[phase]?.[step] ?? "Continue")
      : "";

  const statText = STAT_BUBBLES[`${phase}-${step}`] ?? null;
  const showBack = !done && phase !== "path_select";

  // Success screen computed display values (derived from survey state before reset)
  const primaryPainKey = PAIN_ORDER.find((k) => commPains.has(k)) ?? null;
  const painLabel = primaryPainKey ? (PAIN_LABELS[primaryPainKey] ?? "Other") : "Not specified";
  const costLabel = commCost ? (COST_LABELS[commCost] ?? commCost) : "Not specified";
  const daysLabel = commDays ? (DAYS_LABELS[commDays] ?? commDays) : "Not specified";

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderCTA() {
    const disabled = !canAdvance() || loading;
    return (
      <Pressable
        style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
        onPress={isFormStep ? onSubmit : goNext}
        disabled={disabled}
      >
        {loading ? (
          <ActivityIndicator color={Landing.white} />
        ) : (
          <>
            <Text style={styles.primaryBtnText}>{ctaLabel}</Text>
            <Ionicons name="arrow-forward" size={17} color={Landing.white} />
          </>
        )}
      </Pressable>
    );
  }

  function renderMultiSelect(
    options: { key: string; label: string }[],
    selected: Set<string>,
    onToggle: (k: string) => void,
    otherVal?: string,
    onOtherChange?: (t: string) => void
  ) {
    return (
      <View style={styles.optionList}>
        {options.map((o) => (
          <OptionChip
            key={o.key}
            label={o.label}
            selected={selected.has(o.key)}
            onPress={() => onToggle(o.key)}
          />
        ))}
        {selected.has("other") && onOtherChange ? (
          <TextInput
            style={[styles.input, styles.otherInput]}
            placeholder="Tell us more..."
            placeholderTextColor={Landing.subtle}
            value={otherVal ?? ""}
            onChangeText={onOtherChange}
            multiline
          />
        ) : null}
      </View>
    );
  }

  function renderSingleSelect(
    options: { key: string; label: string }[],
    selected: string | null,
    onSelect: (k: string) => void,
    otherVal?: string,
    onOtherChange?: (t: string) => void
  ) {
    return (
      <View style={styles.optionList}>
        {options.map((o) => (
          <OptionChip
            key={o.key}
            label={o.label}
            selected={selected === o.key}
            onPress={() => onSelect(o.key)}
          />
        ))}
        {selected === "other" && onOtherChange ? (
          <TextInput
            style={[styles.input, styles.otherInput]}
            placeholder="Tell us more..."
            placeholderTextColor={Landing.subtle}
            value={otherVal ?? ""}
            onChangeText={onOtherChange}
            multiline
          />
        ) : null}
      </View>
    );
  }

  // ── Screen renderers ────────────────────────────────────────────────────────

  function renderPathSelect() {
    return (
      <View>
        <Text style={styles.stepHeading}>How are you looking{"\n"}to use Poolyn?</Text>
        <Text style={styles.stepSubtitle}>Choose your path to get started.</Text>
        <View style={styles.pathCards}>
          <Pressable style={styles.pathCard} onPress={() => selectPath("commuter")}>
            <View style={styles.pathCardIcon}>
              <Ionicons name="person-outline" size={26} color={Landing.forest} />
            </View>
            <View style={styles.pathCardCopy}>
              <Text style={styles.pathCardLabel}>👤  For myself</Text>
              <Text style={styles.pathCardSub}>
                I want a better, cheaper daily commute.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Landing.subtle} />
          </Pressable>
          <Pressable
            style={[styles.pathCard, styles.pathCardOrg]}
            onPress={() => selectPath("org")}
          >
            <View style={[styles.pathCardIcon, styles.pathCardIconOrg]}>
              <Ionicons name="business-outline" size={26} color={Landing.forest} />
            </View>
            <View style={styles.pathCardCopy}>
              <Text style={styles.pathCardLabel}>🏢  For my organization</Text>
              <Text style={styles.pathCardSub}>
                Solve employee parking and hit ESG targets.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Landing.subtle} />
          </Pressable>
        </View>
      </View>
    );
  }

  function renderBenefits() {
    return (
      <View>
        <Text style={styles.stepHeading}>{stepTitle}</Text>
        <Text style={styles.stepSubtitle}>{stepSub}</Text>
        <View style={styles.benefitList}>
          {COMMUTER_BENEFITS.map((b) => (
            <View key={b.stat} style={styles.benefitCard}>
              <View style={styles.benefitIconWrap}>
                <Ionicons name={b.icon} size={22} color={Landing.forest} />
              </View>
              <View style={styles.benefitTextWrap}>
                <Text style={styles.benefitStat}>{b.stat}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.benefitTaglineRow}>
          <Ionicons name="shield-checkmark-outline" size={14} color={Landing.tealDark} />
          <Text style={styles.benefitTagline}>
            Only verified professionals with corporate emails join your network.
          </Text>
        </View>
        {renderCTA()}
      </View>
    );
  }

  function renderDaysStep() {
    return (
      <View>
        <Text style={styles.stepHeading}>{stepTitle}</Text>
        <Text style={styles.stepSubtitle}>{stepSub}</Text>
        <View style={styles.daysRow}>
          {COMMUTER_DAYS.map((o) => (
            <Pressable
              key={o.key}
              style={[styles.dayChip, commDays === o.key && styles.dayChipOn]}
              onPress={() => setCommDays(o.key)}
            >
              <Text
                style={[styles.dayChipText, commDays === o.key && styles.dayChipTextOn]}
              >
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {renderCTA()}
      </View>
    );
  }

  function renderCommuterForm() {
    const showSuburbDropdown =
      suburbFocused && suburb.trim().length > 0 && suburbSuggestions.length > 0;

    return (
      <View>
        <Text style={styles.stepHeading}>{stepTitle}</Text>
        <Text style={styles.stepSubtitle}>{stepSub}</Text>

        <Text style={[styles.label, styles.labelFirst]}>Work email *</Text>
        <Text style={styles.hint}>
          Use your company address. Personal inboxes (Gmail, Outlook, iCloud, etc.) cannot
          join the waitlist.
        </Text>
        <TextInput
          style={[styles.input, emailHint ? styles.inputWarn : undefined]}
          placeholder="you@company.com"
          placeholderTextColor={Landing.subtle}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={onEmailChange}
        />
        {emailHint ? (
          <View style={styles.emailHintRow}>
            <Ionicons name="warning-outline" size={14} color={Landing.orange} style={{ flexShrink: 0, marginTop: 1 }} />
            <Text style={styles.emailHintText}>{emailHint}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Your name (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Alex Chen"
          placeholderTextColor={Landing.subtle}
          value={fullName}
          onChangeText={setFullName}
        />

        <Text style={styles.label}>Home suburb *</Text>
        <Text style={styles.hint}>Used to match you with people on the same route.</Text>
        <View style={styles.suburbWrap}>
          <TextInput
            style={[styles.input, showSuburbDropdown && styles.inputOpenTop]}
            placeholder="e.g. San Francisco, CA, USA"
            placeholderTextColor={Landing.subtle}
            value={suburb}
            onChangeText={onSuburbChange}
            onFocus={onSuburbFocus}
            onBlur={onSuburbBlur}
            autoCorrect={false}
          />
          {showSuburbDropdown ? (
            <View style={styles.suggestionsInline}>
              {suburbSuggestions.map((s) => (
                <Pressable
                  key={s}
                  style={styles.suggestionItem}
                  onPress={() => pickSuburb(s)}
                >
                  <Ionicons
                    name="location-outline"
                    size={15}
                    color={Landing.tealDark}
                    style={{ flexShrink: 0 }}
                  />
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Text style={styles.label}>Work location (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Company name or business park"
          placeholderTextColor={Landing.subtle}
          value={workLocation}
          onChangeText={setWorkLocation}
          autoCorrect={false}
        />

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {renderCTA()}
      </View>
    );
  }

  function renderOrgForm() {
    return (
      <View>
        <Text style={styles.stepHeading}>{stepTitle}</Text>
        <Text style={styles.stepSubtitle}>{stepSub}</Text>

        <Text style={[styles.label, styles.labelFirst]}>Work email *</Text>
        <Text style={styles.hint}>
          Use your company address. Personal inboxes cannot register for the enterprise pilot.
        </Text>
        <TextInput
          style={[styles.input, emailHint ? styles.inputWarn : undefined]}
          placeholder="you@company.com"
          placeholderTextColor={Landing.subtle}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={onEmailChange}
        />
        {emailHint ? (
          <View style={styles.emailHintRow}>
            <Ionicons name="warning-outline" size={14} color={Landing.orange} style={{ flexShrink: 0, marginTop: 1 }} />
            <Text style={styles.emailHintText}>{emailHint}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Company name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Acme Corp"
          placeholderTextColor={Landing.subtle}
          value={companyName}
          onChangeText={setCompanyName}
          autoCorrect={false}
        />

        <Text style={styles.label}>Your role *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. HR Manager, Facilities Director, Operations"
          placeholderTextColor={Landing.subtle}
          value={jobTitle}
          onChangeText={setJobTitle}
          autoCorrect={false}
        />

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {renderCTA()}
      </View>
    );
  }

  function renderCurrentStep() {
    if (phase === "path_select") return renderPathSelect();

    if (phase === "commuter") {
      if (step === 0) return renderBenefits();
      if (step === 3) return renderDaysStep();
      if (step === 6) return renderCommuterForm();

      let options: React.ReactElement | null = null;
      if (step === 1) {
        options = renderMultiSelect(
          COMMUTER_PAIN,
          commPains,
          (k) => setCommPains((s) => toggleSet(s, k)),
          commPainOther,
          setCommPainOther
        );
      } else if (step === 2) {
        options = renderSingleSelect(COMMUTER_COST, commCost, setCommCost);
      } else if (step === 4) {
        options = renderMultiSelect(
          COMMUTER_TRUST,
          commTrust,
          (k) => setCommTrust((s) => toggleSet(s, k)),
          commTrustOther,
          setCommTrustOther
        );
      } else if (step === 5) {
        options = renderSingleSelect(
          COMMUTER_ROLE,
          commRole,
          setCommRole,
          commRoleOther,
          setCommRoleOther
        );
      }

      return (
        <View>
          <Text style={styles.stepHeading}>{stepTitle}</Text>
          <Text style={styles.stepSubtitle}>{stepSub}</Text>
          {options}
          {statText ? <StatBubble text={statText} /> : null}
          {renderCTA()}
        </View>
      );
    }

    if (phase === "org") {
      if (step === 3) return renderOrgForm();

      let options: React.ReactElement | null = null;
      if (step === 0) {
        options = renderSingleSelect(ORG_CHALLENGE, orgChallenge, setOrgChallenge);
      } else if (step === 1) {
        options = renderSingleSelect(ORG_SIZE, orgSize, setOrgSize);
      } else if (step === 2) {
        options = renderSingleSelect(ORG_SUBSIDY, orgSubsidy, setOrgSubsidy);
      }

      return (
        <View>
          <Text style={styles.stepHeading}>{stepTitle}</Text>
          <Text style={styles.stepSubtitle}>{stepSub}</Text>
          {options}
          {statText ? <StatBubble text={statText} /> : null}
          {renderCTA()}
        </View>
      );
    }

    return null;
  }

  function renderSuccess() {
    if (completedPath === "org") {
      return (
        <View style={styles.successBlock}>
          <View style={styles.orgSuccessHero}>
            <Ionicons name="checkmark-circle" size={52} color={Landing.forest} />
            <Text style={styles.orgSuccessTitle}>Enterprise pilot request confirmed.</Text>
          </View>
          <Text style={styles.successEmail} selectable>
            {confirmedEmail}
          </Text>
          <Text style={styles.successBodyCenter}>
            Our team will reach out within 48 hours to discuss your organization's commuting
            data and pilot configuration.
          </Text>
          <View style={styles.orgNextStepsWrap}>
            <Text style={styles.nextStepsLabel}>WHAT HAPPENS NEXT</Text>
            <NextStepBadge
              n={1}
              text="We review your organization size and commuting challenge."
            />
            <NextStepBadge n={2} text="Our team sends a tailored pilot proposal." />
            <NextStepBadge
              n={3}
              text="You onboard your team and start tracking real commute data."
            />
          </View>
          <Pressable style={styles.successCloseBtn} onPress={handleClose}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </Pressable>
        </View>
      );
    }

    // Rich commuter success screen
    const displaySuburb = suburb.trim() || "your area";

    return (
      <View style={styles.commuterSuccessWrap}>
        {/* Hero banner */}
        <View style={styles.successHeroCard}>
          <View style={styles.successHeroTopRow}>
            <View style={styles.successHeroDot} />
            <Text style={styles.successHeroBrand}>POOLYN</Text>
          </View>
          <Text style={styles.successHeroTitle}>Your interest in a better commute</Text>
          <Text style={styles.successHeroAccent}>is recorded.</Text>
        </View>

        {/* Status row */}
        <View style={styles.successStatusRow}>
          <View style={styles.successStatusIcon}>
            <Ionicons name="checkmark" size={22} color={Landing.white} />
          </View>
          <View style={styles.successStatusCopy}>
            <Text style={styles.successStatusTitle}>
              You're on the list. We'll take it from here.
            </Text>
            <Text style={styles.successStatusBody}>
              Your details are safely recorded. We'll reach out as soon as Poolyn is
              ready to launch in your area.
            </Text>
          </View>
        </View>

        {/* Commute profile table */}
        <View style={styles.profileTable}>
          <Text style={styles.profileTableTitle}>YOUR COMMUTE SNAPSHOT</Text>
          <ProfileRow label="Biggest pain point" value={painLabel} />
          <ProfileRow label="Monthly commute spend" value={costLabel} highlight />
          <ProfileRow label="Days in office" value={daysLabel} />
          <ProfileRow label="Joining as" value="Commuter" />
        </View>

        {/* Area note */}
        <View style={styles.areaWarningBox}>
          <Text style={styles.areaWarningTitle}>Your area: {displaySuburb}</Text>
          <Text style={styles.areaWarningBody}>
            We're building verified professional networks area by area. The more people
            from{" "}
            <Text style={styles.areaWarningEm}>{displaySuburb}</Text>{" "}
            who sign up, the sooner your corridor goes live.
          </Text>
        </View>

        {/* What happens next */}
        <View style={styles.nextStepsSection}>
          <Text style={styles.nextStepsLabel}>WHAT HAPPENS NEXT</Text>
          <NextStepBadge
            n={1}
            text="We grow your area. As more professionals from your region sign up, we build potential routes."
          />
          <NextStepBadge
            n={2}
            text="You get a launch notification. When your area reaches critical mass, you'll be emailed first with match options."
          />
          <NextStepBadge
            n={3}
            text="Your first shared commute. Confirm a match, agree a pickup point, and Poolyn handles the rest."
          />
        </View>

        {/* Share section */}
        <View style={styles.shareSection}>
          <Text style={styles.shareIntro}>
            Help your area launch sooner. Share Poolyn with colleagues on your route.
          </Text>
          <View style={styles.socialShareRow}>
            <Pressable style={styles.socialShareBtn} onPress={handleShareLinkedIn}>
              <Ionicons name="logo-linkedin" size={22} color={Landing.forest} />
              <Text style={styles.socialShareLabel}>LinkedIn</Text>
            </Pressable>
            <Pressable style={styles.socialShareBtn} onPress={handleShareEmail}>
              <Ionicons name="mail-outline" size={22} color={Landing.forest} />
              <Text style={styles.socialShareLabel}>Email a colleague</Text>
            </Pressable>
            <Pressable style={styles.socialShareBtn} onPress={handleShareWhatsApp}>
              <Ionicons name="logo-whatsapp" size={22} color={Landing.forest} />
              <Text style={styles.socialShareLabel}>WhatsApp</Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={[styles.successCloseBtn, { marginTop: Spacing.xl }]} onPress={handleClose}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

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
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {/* Header */}
            <View style={styles.sheetHeader}>
              {showBack ? (
                <Pressable onPress={goBack} hitSlop={12} accessibilityLabel="Back">
                  <Ionicons name="arrow-back" size={22} color={Landing.forest} />
                </Pressable>
              ) : (
                <View style={styles.headerSpacer} />
              )}
              <Text style={styles.sheetTitle}>
                {done
                  ? completedPath === "org"
                    ? "Enterprise pilot"
                    : "You're in."
                  : phase === "org"
                  ? "Enterprise pilot"
                  : "Reserve your spot"}
              </Text>
              <Pressable onPress={handleClose} hitSlop={12} accessibilityLabel="Close">
                <Ionicons name="close" size={26} color={Landing.ink} />
              </Pressable>
            </View>

            {/* Progress bar */}
            {!done && phase !== "path_select" ? (
              <View style={styles.progressBar}>
                {Array.from({ length: totalSteps }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.progressSeg,
                      i < step && styles.progressSegDone,
                      i === step && styles.progressSegActive,
                    ]}
                  />
                ))}
              </View>
            ) : null}

            {/* Content */}
            {done ? renderSuccess() : renderCurrentStep()}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Sheet ──────────────────────────────────────────────────────────────────
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
    maxWidth: 520,
    width: "100%",
    maxHeight: "92%",
    alignSelf: "center",
    ...Shadow.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  headerSpacer: { width: 22 },
  sheetTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.lg,
    color: Landing.ink,
    letterSpacing: -0.3,
    flex: 1,
    textAlign: "center",
    marginHorizontal: Spacing.sm,
  },

  // ── Progress bar ───────────────────────────────────────────────────────────
  progressBar: {
    flexDirection: "row",
    gap: 5,
    marginBottom: Spacing.xl,
  },
  progressSeg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
  },
  progressSegActive: { backgroundColor: Landing.tealDark },
  progressSegDone: { backgroundColor: Landing.forest },

  // ── Path selection ─────────────────────────────────────────────────────────
  pathCards: { gap: 12, marginTop: 8 },
  pathCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Landing.mintInput,
  },
  pathCardOrg: {
    borderColor: Landing.tealLine,
    backgroundColor: "rgba(11, 132, 87, 0.05)",
  },
  pathCardIcon: {
    width: 50,
    height: 50,
    borderRadius: 13,
    backgroundColor: Landing.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pathCardIconOrg: {
    backgroundColor: "rgba(11, 132, 87, 0.12)",
  },
  pathCardCopy: { flex: 1 },
  pathCardLabel: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.base,
    color: Landing.ink,
    marginBottom: 3,
  },
  pathCardSub: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 18,
  },

  // ── Step shared ────────────────────────────────────────────────────────────
  stepHeading: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize["2xl"],
    color: Landing.ink,
    letterSpacing: -0.4,
    marginBottom: Spacing.sm,
    lineHeight: 30,
  },
  stepSubtitle: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },

  // ── Benefits ───────────────────────────────────────────────────────────────
  benefitList: { gap: Spacing.md, marginBottom: Spacing.lg },
  benefitCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.base,
    backgroundColor: Landing.mintInput,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.base,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: Landing.tealLine,
  },
  benefitIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Landing.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  benefitTextWrap: { flex: 1 },
  benefitStat: {
    fontFamily: LandingFont.displayBold,
    fontSize: 26,
    color: Landing.forest,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  benefitDesc: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 20,
    marginTop: 2,
  },
  benefitTaglineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.xs,
  },
  benefitTagline: {
    flex: 1,
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.tealDark,
    lineHeight: 18,
  },

  // ── Option chips ───────────────────────────────────────────────────────────
  optionList: { gap: 8, marginBottom: Spacing.sm },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Landing.mintInput,
    gap: 10,
  },
  optionChipOn: {
    borderColor: Landing.forest,
    backgroundColor: Landing.tealMuted,
  },
  optionChipText: {
    flex: 1,
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 20,
  },
  optionChipTextOn: {
    fontFamily: LandingFont.bodySemi,
    color: Landing.forest,
  },
  optionCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  optionCheckOn: {
    backgroundColor: Landing.forest,
    borderColor: Landing.forest,
  },

  // ── Stat bubble ────────────────────────────────────────────────────────────
  statBubble: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(11, 132, 87, 0.07)",
    borderRadius: 12,
    padding: 14,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Landing.tealLine,
  },
  statBubbleText: {
    flex: 1,
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.forest,
    lineHeight: 18,
    fontStyle: "italic",
  },

  // ── Days selector ──────────────────────────────────────────────────────────
  daysRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: Spacing.lg,
  },
  dayChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Landing.mintInput,
  },
  dayChipOn: {
    borderColor: Landing.forest,
    backgroundColor: Landing.tealMuted,
  },
  dayChipText: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    textAlign: "center",
  },
  dayChipTextOn: {
    fontFamily: LandingFont.bodySemi,
    color: Landing.forest,
  },

  // ── Form fields ────────────────────────────────────────────────────────────
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
  inputWarn: {
    borderColor: Landing.orange,
    borderWidth: 1.5,
  },
  otherInput: {
    marginTop: 8,
    minHeight: 72,
    textAlignVertical: "top",
  },
  emailHintRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  emailHintText: {
    flex: 1,
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.orange,
    lineHeight: 18,
  },
  suburbWrap: {},
  // Input style modifier when the suggestions list is open below it
  inputOpenTop: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  // Suggestions rendered inline (not absolutely positioned) to avoid z-index/overflow issues
  suggestionsInline: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Landing.tealLine,
    borderBottomLeftRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.lg,
    backgroundColor: Landing.white,
    overflow: "hidden",
    marginBottom: 2,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: Spacing.base,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  suggestionText: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.ink,
    flex: 1,
  },
  err: {
    fontFamily: LandingFont.body,
    color: Colors.error,
    fontSize: FontSize.sm,
    marginTop: Spacing.md,
    lineHeight: 20,
  },

  // ── Primary CTA ────────────────────────────────────────────────────────────
  primaryBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Landing.forest,
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.white,
    fontSize: FontSize.base,
  },

  // ── Success: shared ────────────────────────────────────────────────────────
  successBlock: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    width: "100%",
  },
  successEmail: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.base,
    color: Landing.forest,
    textAlign: "center",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  successCloseBtn: {
    backgroundColor: Landing.forest,
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
    paddingHorizontal: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    width: "100%",
    minHeight: 48,
    flexDirection: "row",
  },

  // ── Success: org ───────────────────────────────────────────────────────────
  orgSuccessHero: {
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  orgSuccessTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xl,
    color: Landing.ink,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  successBodyCenter: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.base,
    color: Landing.muted,
    textAlign: "center",
    marginTop: Spacing.md,
    lineHeight: 24,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  orgNextStepsWrap: { width: "100%", gap: 12, marginBottom: Spacing.xl },

  // ── Success: commuter ──────────────────────────────────────────────────────
  commuterSuccessWrap: { width: "100%", paddingBottom: Spacing.md },

  successHeroCard: {
    backgroundColor: Landing.forest,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginBottom: 18,
  },
  successHeroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },
  successHeroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Landing.leaf,
  },
  successHeroBrand: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xs,
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 1.8,
  },
  successHeroTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: 22,
    color: Landing.white,
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  successHeroAccent: {
    fontFamily: LandingFont.displayBold,
    fontSize: 22,
    color: Landing.orange,
    letterSpacing: -0.3,
    lineHeight: 28,
  },

  successStatusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  },
  successStatusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Landing.forest,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  successStatusCopy: { flex: 1 },
  successStatusTitle: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.base,
    color: Landing.ink,
    marginBottom: 4,
    lineHeight: 22,
  },
  successStatusBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 20,
  },

  // Profile table
  profileTable: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 16,
  },
  profileTableTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xs,
    color: Landing.muted,
    letterSpacing: 0.8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: Landing.mintInput,
  },
  profileRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  profileRowLabel: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    flex: 1,
  },
  profileRowValue: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.sm,
    color: Landing.ink,
    textAlign: "right",
    flexShrink: 0,
    marginLeft: 8,
  },
  profileRowValueHighlight: {
    color: Landing.orange,
  },

  // Area warning
  areaWarningBox: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.28)",
    padding: 14,
    marginBottom: 16,
  },
  areaWarningTitle: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.sm,
    color: Landing.ink,
    marginBottom: 5,
  },
  areaWarningBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.muted,
    lineHeight: 18,
  },
  areaWarningEm: {
    fontFamily: LandingFont.bodySemi,
    color: "#D97706",
  },


  // What happens next
  nextStepsSection: { marginBottom: 20 },
  nextStepsLabel: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xs,
    color: Landing.muted,
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  stepBadgeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  stepBadgeCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Landing.forest,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepBadgeNum: {
    fontFamily: LandingFont.displayBold,
    fontSize: 12,
    color: Landing.white,
  },
  stepBadgeText: {
    flex: 1,
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 20,
  },

  // Share
  shareSection: { marginBottom: 8 },
  shareIntro: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.muted,
    lineHeight: 18,
    marginBottom: 10,
  },
  socialShareRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  socialShareBtn: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Landing.tealLine,
    borderRadius: 10,
    backgroundColor: Landing.mintInput,
  },
  socialShareLabel: {
    fontFamily: LandingFont.body,
    fontSize: 10,
    color: Landing.forest,
    textAlign: "center",
  },
});
