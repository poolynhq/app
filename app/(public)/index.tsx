import { useRef, useState } from "react";
import { Link } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type SectionKey = "how" | "teams" | "individuals";

export default function LandingPage() {
  const scrollRef = useRef<ScrollView>(null);
  const [sections, setSections] = useState<Record<SectionKey, number>>({
    how: 0,
    teams: 0,
    individuals: 0,
  });

  function markSection(key: SectionKey, e: LayoutChangeEvent) {
    setSections((prev) => ({ ...prev, [key]: e.nativeEvent.layout.y }));
  }

  function jumpTo(key: SectionKey) {
    scrollRef.current?.scrollTo({ y: Math.max(0, sections[key] - 90), animated: true });
  }

  return (
    <ScrollView ref={scrollRef} style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.navbar}>
        <View style={styles.logoWrap}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>RG</Text>
          </View>
          <Text style={styles.logoText}>Poolyn</Text>
        </View>
        <View style={styles.navLinks}>
          <TouchableOpacity onPress={() => jumpTo("how")}><Text style={styles.navLink}>How it works</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => jumpTo("teams")}><Text style={styles.navLink}>For teams</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => jumpTo("individuals")}><Text style={styles.navLink}>For individuals</Text></TouchableOpacity>
          <Link href="/(auth)/sign-in" asChild><TouchableOpacity><Text style={styles.navLink}>Sign in</Text></TouchableOpacity></Link>
        </View>
        <Link href="/(auth)/business-sign-up" asChild>
          <TouchableOpacity style={styles.navCta}><Text style={styles.navCtaText}>Start a Network</Text></TouchableOpacity>
        </Link>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Stop driving alone. Start commuting smarter.</Text>
        <Text style={styles.heroSubtitle}>
          Poolyn connects people heading the same way at the same time, helping teams
          save money, reduce parking pressure, and make commuting more social.
        </Text>
        <View style={styles.heroButtons}>
          <Link href="/(auth)/business-sign-up" asChild>
            <TouchableOpacity style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Start a Network</Text></TouchableOpacity>
          </Link>
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Join & Explore</Text></TouchableOpacity>
          </Link>
        </View>
        <Text style={styles.supportLine}>
          ✔ Verified work & university emails{"\n"}
          ✔ Your exact address is never shared{"\n"}
          ✔ Flexible plans with built-in backup options
        </Text>
      </View>

      <View style={styles.launchTag}>
        <Text style={styles.launchTitle}>Launching in Melbourne 🚀</Text>
        <Text style={styles.launchBody}>Be among the first teams to transform commuting.</Text>
      </View>

      <View onLayout={(e) => markSection("how", e)} style={styles.section}>
        <Text style={styles.sectionTitle}>How it works</Text>
        <Text style={styles.sectionItem}>1. Set your commute: add home, work, and schedule.</Text>
        <Text style={styles.sectionItem}>2. Get matched with people on similar routes and times.</Text>
        <Text style={styles.sectionItem}>3. Share the ride: drive, ride, or switch anytime.</Text>
        <Text style={styles.smallNote}>Flex Credits keep everything flexible when plans change.</Text>
      </View>

      <View onLayout={(e) => markSection("individuals", e)} style={styles.section}>
        <Text style={styles.sectionTitle}>For individuals</Text>
        <Text style={styles.sectionItem}>• Save fuel and parking costs</Text>
        <Text style={styles.sectionItem}>• Ride with people from your organization</Text>
        <Text style={styles.sectionItem}>• Stay flexible with changing schedules</Text>
        <Text style={styles.sectionItem}>• Discover nearby commuters when needed</Text>
        <Link href="/(auth)/sign-up" asChild>
          <TouchableOpacity style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Join & Explore</Text></TouchableOpacity>
        </Link>
      </View>

      <View onLayout={(e) => markSection("teams", e)} style={styles.section}>
        <Text style={styles.sectionTitle}>For teams & organizations</Text>
        <Text style={styles.sectionItem}>• Reduce parking demand and congestion</Text>
        <Text style={styles.sectionItem}>• Improve employee satisfaction</Text>
        <Text style={styles.sectionItem}>• Support sustainability goals (CO₂ insights)</Text>
        <Text style={styles.sectionItem}>• Build stronger workplace connections</Text>
        <Link href="/(auth)/business-sign-up" asChild>
          <TouchableOpacity style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Start a Network</Text></TouchableOpacity>
        </Link>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trust & safety</Text>
        <Text style={styles.sectionItem}>• Verified work & university emails only</Text>
        <Text style={styles.sectionItem}>• Your exact home address is never shared</Text>
        <Text style={styles.sectionItem}>• Colleagues first, then nearby fallback</Text>
        <Text style={styles.sectionItem}>• Optional preferences for comfort and safety</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Product preview</Text>
        <View style={styles.previewCard}>
          <Ionicons name="map-outline" size={20} color={Colors.primary} />
          <Text style={styles.previewText}>Onboarding: schedule + location</Text>
        </View>
        <View style={styles.previewCard}>
          <Ionicons name="grid-outline" size={20} color={Colors.primary} />
          <Text style={styles.previewText}>Dashboard: matches, stats, and route signals</Text>
        </View>
        <View style={styles.previewCard}>
          <Ionicons name="people-outline" size={20} color={Colors.primary} />
          <Text style={styles.previewText}>“X people near your route” real-time insight</Text>
        </View>
        <Text style={styles.smallNote}>See who&apos;s heading your way before you even ask.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Smart matching</Text>
        <Text style={styles.sectionItem}>• Route, timing, and flexibility-aware matching</Text>
        <Text style={styles.sectionItem}>• Automatic driver/rider balancing</Text>
        <Text style={styles.sectionItem}>• Fair rotation across available drivers</Text>
        <Text style={styles.sectionItem}>• Works daily without constant group coordination</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Plans change. We built for that.</Text>
        <Text style={styles.sectionItem}>• Flex Credits let people adjust responsibly</Text>
        <Text style={styles.sectionItem}>• Leave early, cancel, or switch roles when needed</Text>
        <Text style={styles.sectionItem}>• No rigid commitments</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Simple pricing for growing teams</Text>
        <Text style={styles.sectionItem}>Plans for organizations start from $49/month.</Text>
        <Text style={styles.smallNote}>Individuals can join and explore for free.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Already have colleagues nearby?</Text>
        <Text style={styles.sectionItem}>
          We&apos;ll show you who&apos;s commuting along your route and help you connect fast.
        </Text>
      </View>

      <View style={styles.finalCta}>
        <Text style={styles.finalTitle}>Ready to change how your team commutes?</Text>
        <View style={styles.heroButtons}>
          <Link href="/(auth)/business-sign-up" asChild>
            <TouchableOpacity style={styles.primaryBtn}><Text style={styles.primaryBtnText}>Start a Network</Text></TouchableOpacity>
          </Link>
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>Join & Explore</Text></TouchableOpacity>
          </Link>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>About</Text>
        <Link href="/(public)/terms" asChild><TouchableOpacity><Text style={styles.footerLink}>Privacy</Text></TouchableOpacity></Link>
        <Link href="/(public)/terms" asChild><TouchableOpacity><Text style={styles.footerLink}>Terms</Text></TouchableOpacity></Link>
        <Text style={styles.footerText}>Contact</Text>
        <Text style={styles.footerTag}>Poolyn: smarter commuting for modern teams.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: Spacing["4xl"] },
  navbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingTop: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  logoWrap: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  logoMark: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primary,
    justifyContent: "center", alignItems: "center",
  },
  logoMarkText: { color: Colors.textOnPrimary, fontWeight: FontWeight.bold, fontSize: 11 },
  logoText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text },
  navLinks: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  navLink: { color: Colors.textSecondary, fontSize: FontSize.sm },
  navCta: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 10,
  },
  navCtaText: { color: Colors.textOnPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  hero: { paddingHorizontal: Spacing["2xl"], paddingTop: Spacing["2xl"], paddingBottom: Spacing.xl },
  heroTitle: { fontSize: 40, lineHeight: 46, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.base },
  heroSubtitle: { fontSize: FontSize.lg, color: Colors.textSecondary, lineHeight: 28, maxWidth: 900 },
  heroButtons: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.lg, marginBottom: Spacing.base },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 12, paddingHorizontal: 18 },
  primaryBtnText: { color: Colors.textOnPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.base },
  secondaryBtn: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 18 },
  secondaryBtnText: { color: Colors.text, fontWeight: FontWeight.semibold, fontSize: FontSize.base },
  supportLine: { color: Colors.textSecondary, lineHeight: 22, marginTop: Spacing.sm },
  launchTag: {
    marginHorizontal: Spacing["2xl"], backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.xl,
  },
  launchTitle: { color: Colors.primaryDark, fontWeight: FontWeight.bold, fontSize: FontSize.base },
  launchBody: { color: Colors.primaryDark, marginTop: 4 },
  section: {
    marginHorizontal: Spacing["2xl"], marginBottom: Spacing.lg, backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, ...Shadow.sm,
  },
  sectionTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.sm },
  sectionItem: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 24, marginBottom: 4 },
  smallNote: { fontSize: FontSize.sm, color: Colors.textTertiary, marginTop: Spacing.sm },
  previewCard: {
    flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.base,
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: Spacing.sm,
  },
  previewText: { color: Colors.textSecondary, fontSize: FontSize.base },
  finalCta: {
    marginHorizontal: Spacing["2xl"], marginTop: Spacing.sm, marginBottom: Spacing.xl,
    padding: Spacing.xl, borderRadius: BorderRadius.lg, backgroundColor: Colors.primaryLight,
  },
  finalTitle: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, color: Colors.primaryDark },
  footer: {
    marginHorizontal: Spacing["2xl"], borderTopWidth: 1, borderTopColor: Colors.borderLight,
    paddingTop: Spacing.lg, flexDirection: "row", alignItems: "center", gap: Spacing.base, flexWrap: "wrap",
  },
  footerText: { color: Colors.textSecondary },
  footerLink: { color: Colors.primary, fontWeight: FontWeight.semibold },
  footerTag: { marginLeft: "auto", color: Colors.textTertiary, fontSize: FontSize.sm },
});
