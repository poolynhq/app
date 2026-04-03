import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors, Spacing, BorderRadius, FontSize, FontWeight, Shadow,
} from "@/constants/theme";

type FaqItem = { q: string; a: string };
type FaqSection = { title: string; icon: keyof typeof Ionicons.glyphMap; items: FaqItem[] };

const FAQ_SECTIONS: FaqSection[] = [
  {
    title: "Getting started",
    icon: "rocket-outline",
    items: [
      {
        q: "What is Poolyn?",
        a: "Poolyn is a smart commute-sharing platform that connects people who travel similar routes at similar times. It's built for teams and organisations to reduce commuting costs, parking demand, and carbon emissions, while making the daily commute more social.",
      },
      {
        q: "How do I find ride matches?",
        a: "Once your profile, home location, work location, and schedule are set up, Poolyn automatically identifies potential matches within your organisation's network. Head to the Discover tab to browse your matches and send or accept ride requests.",
      },
      {
        q: "Do I need to be part of an organisation?",
        a: "You can join as an independent member and discover nearby commuters. However, joining through your organisation gives you access to a verified network of colleagues, improving the quality of your matches and overall trust.",
      },
    ],
  },
  {
    title: "Rides & matching",
    icon: "car-outline",
    items: [
      {
        q: "How does the matching algorithm work?",
        a: "Poolyn matches you based on route similarity, departure time overlap, and your flexibility window. Drivers set how much extra time they allow for pickups; optional gender rules apply when you drive. Colleagues from your organisation are prioritised first.",
      },
      {
        q: "Can I be both a driver and a passenger?",
        a: "Yes. Set your role to 'Both' in your profile. You can drive on some days and ride as a passenger on others. The app will surface relevant matches for each role depending on your availability.",
      },
      {
        q: "What if my plans change last minute?",
        a: "You can cancel a confirmed ride using a Flex Credit. Flex Credits are your buffer for life's unpredictability. You receive a monthly allowance, and you can earn more through consistent commuting. Use them responsibly to keep the network reliable.",
      },
      {
        q: "How far in advance should I book a ride?",
        a: "Poolyn works best when you have a regular schedule set up. For recurring commutes, matches are suggested in advance. For ad-hoc trips, you can create a ride request and Poolyn will attempt to find a match within your flexibility window.",
      },
    ],
  },
  {
    title: "Points & Flex Credits",
    icon: "star-outline",
    items: [
      {
        q: "What are Points?",
        a: "Points are your commuting reputation score. You earn them by driving others (reducing cars on the road), maintaining a reliable schedule, and receiving positive ratings. Points unlock benefits such as priority matching and recognition badges.",
      },
      {
        q: "What are Flex Credits?",
        a: "Flex Credits allow you to cancel or change rides without penalising your reliability score. You receive a set number each month. If you use one, it's deducted from your balance. You can earn extra credits through consistent, punctual commuting.",
      },
      {
        q: "What happens if I run out of Flex Credits?",
        a: "Cancellations without a Flex Credit affect your reliability score, which influences your match priority. Your organisation admin may also be able to grant additional credits. Credits refresh monthly.",
      },
    ],
  },
  {
    title: "Safety & privacy",
    icon: "shield-checkmark-outline",
    items: [
      {
        q: "Is my home address shared with other users?",
        a: "No. Your exact home address is never shared. Poolyn only uses a general area (geohash) to calculate route proximity. Other users see your commute origin zone, not your precise location.",
      },
      {
        q: "Who can I be matched with?",
        a: "By default, matching stays within your organisation. On Discover you can choose to widen visibility when your org allows it; cross-network options are always explicit.",
      },
      {
        q: "How do I report a safety concern?",
        a: "After a completed ride, you'll have the option to rate your co-commuter and submit a report if something went wrong. For urgent concerns, contact your organisation admin or local emergency services immediately.",
      },
      {
        q: "What should I add emergency contacts for?",
        a: "Emergency contacts are trusted people who can be notified if something goes wrong during a ride. We recommend adding at least one contact: a partner, family member, or trusted colleague.",
      },
    ],
  },
  {
    title: "Account & settings",
    icon: "settings-outline",
    items: [
      {
        q: "How do I update my commute location?",
        a: "Open Profile → Commute & pickup → Home & work locations. That reopens the location editor so you can move your pins; we rebuild your commute route for matching.",
      },
      {
        q: "Can I change my schedule after onboarding?",
        a: "Yes. Go to Profile → Schedule to update your commute days and times. Changes take effect immediately and will influence new match suggestions.",
      },
      {
        q: "How do I delete my account?",
        a: "To request account deletion, please contact your organisation admin or reach out to Poolyn support at support@poolyn.com. All personal data will be removed in accordance with our Privacy Policy.",
      },
    ],
  },
];

export default function HelpFaqScreen() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggle(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.hero}>
          <Ionicons name="help-buoy-outline" size={40} color={Colors.primary} />
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSubtitle}>
            Find answers to common questions about Poolyn below. Can't find what you need? Contact us at{" "}
            <Text style={styles.link}>support@poolyn.com</Text>
          </Text>
        </View>

        {FAQ_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <Ionicons name={section.icon} size={18} color={Colors.primary} />
              </View>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <View style={styles.card}>
              {section.items.map((item, i) => {
                const key = `${section.title}-${i}`;
                const open = expanded[key] ?? false;
                return (
                  <View key={key}>
                    {i > 0 && <View style={styles.divider} />}
                    <TouchableOpacity
                      style={styles.question}
                      onPress={() => toggle(key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.questionText, open && { color: Colors.primary }]}>
                        {item.q}
                      </Text>
                      <Ionicons
                        name={open ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={open ? Colors.primary : Colors.textTertiary}
                      />
                    </TouchableOpacity>
                    {open && (
                      <Text style={styles.answer}>{item.a}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.contactBox}>
          <Ionicons name="mail-outline" size={22} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>Still have questions?</Text>
            <Text style={styles.contactBody}>Email us at <Text style={styles.link}>support@poolyn.com</Text> and we'll get back to you within one business day.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  hero: { alignItems: "center", paddingVertical: Spacing.xl, marginBottom: Spacing.xl },
  heroTitle: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, color: Colors.text, marginTop: Spacing.md, marginBottom: Spacing.sm },
  heroSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", lineHeight: 20, maxWidth: 320 },
  link: { color: Colors.primary, fontWeight: FontWeight.medium },
  section: { marginBottom: Spacing.xl },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md },
  sectionIconWrap: { width: 32, height: 32, borderRadius: BorderRadius.sm, backgroundColor: Colors.primaryLight, justifyContent: "center", alignItems: "center" },
  sectionTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.text },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, overflow: "hidden", ...Shadow.sm },
  divider: { height: 1, backgroundColor: Colors.borderLight },
  question: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.base },
  questionText: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.text, lineHeight: 22 },
  answer: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22, paddingHorizontal: Spacing.base, paddingBottom: Spacing.base, marginTop: -4 },
  contactBox: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md, backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.lg, padding: Spacing.base, borderWidth: 1, borderColor: Colors.border },
  contactTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.primaryDark, marginBottom: 4 },
  contactBody: { fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
});
