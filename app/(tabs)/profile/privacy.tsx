import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "@/constants/theme";

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: 2026-03-30</Text>

        <View style={styles.summary}>
          <Ionicons name="shield-checkmark-outline" size={28} color={Colors.primary} />
          <Text style={styles.summaryTitle}>Your privacy matters</Text>
          <Text style={styles.summaryBody}>
            Poolyn is built around trust. We collect only what&apos;s necessary to connect you with
            compatible commuters, and we never sell your personal data.
          </Text>
        </View>

        <Section title="1. Who we are">
          Poolyn is a commute-sharing coordination platform operated by Poolyn Pty Ltd (ABN to be
          registered), based in Melbourne, Australia. We act as the data controller for personal
          information collected through our mobile app and web platform.
        </Section>

        <Section title="2. What data we collect">
          {"We collect:\n\n" +
          "• Account data: name, email address, phone number\n" +
          "• Profile data: gender, commute role (driver/passenger), driver settings when you offer rides\n" +
          "• Location data: approximate home and work area (stored as geohash, not exact address)\n" +
          "• Schedule data: commute days and times you set in the app\n" +
          "• Vehicle data: make, model, colour, number plate, and seat count\n" +
          "• Usage data: rides created, matched, completed, and any in-app messages\n" +
          "• Device data: app version, device type, and push notification tokens (if enabled)"}
        </Section>

        <Section title="3. How we use your data">
          {"We use your data to:\n\n" +
          "• Match you with compatible co-commuters based on route, timing, and preferences\n" +
          "• Send you ride notifications, reminders, and match updates\n" +
          "• Calculate your Points balance and Flex Credit transactions\n" +
          "• Improve the matching algorithm using anonymised, aggregated analytics\n" +
          "• Provide your organisation's admin with anonymised commute analytics\n" +
          "• Comply with our legal obligations and enforce our Terms & Conditions"}
        </Section>

        <Section title="4. Location data">
          Your exact home and work addresses are never stored or shared with other users. We convert
          your address into a geohash (a geographic zone) which is used for matching calculations.
          Other users see only your general commute zone, not your precise location. Live location
          sharing (if enabled during a ride) is temporary and deleted automatically after the ride ends.
        </Section>

        <Section title="5. Who we share your data with">
          {"We do not sell your personal data. We share data only:\n\n" +
          "• With your matched co-commuters: your name, profile photo, and approximate pickup zone\n" +
          "• With your organisation admin: anonymised commute analytics only (no personal trip details)\n" +
          "• With Supabase (our database infrastructure provider) under a Data Processing Agreement\n" +
          "• With service providers (e.g. mapping, push notifications) under strict confidentiality obligations\n" +
          "• Where required by law, court order, or regulatory authority"}
        </Section>

        <Section title="6. Data retention">
          We retain your account data for as long as your account is active. If you request deletion,
          your personal data is removed within 30 days. Anonymised and aggregated analytics data may
          be retained indefinitely. Ride records required for safety investigations may be retained
          for up to 7 years in accordance with Australian law.
        </Section>

        <Section title="7. Your rights">
          {"Under Australian Privacy Act 1988 and applicable regulations, you have the right to:\n\n" +
          "• Access the personal data we hold about you\n" +
          "• Correct inaccurate or incomplete data\n" +
          "• Request deletion of your account and personal data\n" +
          "• Object to certain processing activities\n" +
          "• Lodge a complaint with the Office of the Australian Information Commissioner (OAIC)\n\n" +
          "To exercise these rights, email privacy@poolyn.com."}
        </Section>

        <Section title="8. Security">
          We implement industry-standard security measures including encrypted data transmission
          (TLS), encrypted storage of sensitive credentials, and role-based access controls.
          Authentication is handled by Supabase Auth with secure session management. We conduct
          regular security reviews and promptly address any identified vulnerabilities.
        </Section>

        <Section title="9. Children's privacy">
          Poolyn is not intended for users under 18 years of age. We do not knowingly collect
          personal data from children. If we become aware that a child has registered, we will
          promptly delete their account and associated data.
        </Section>

        <Section title="10. International data transfers">
          Your data may be stored and processed on servers located outside Australia (including in
          the United States). We ensure appropriate safeguards are in place for any international
          transfers in accordance with Australian Privacy Principles.
        </Section>

        <Section title="11. Changes to this policy">
          We may update this Privacy Policy from time to time. Material changes will be communicated
          in-app or via email at least 14 days before they take effect. Continued use of Poolyn after
          the effective date constitutes acceptance of the updated policy.
        </Section>

        <Section title="12. Contact us">
          For privacy enquiries, data access requests, or complaints:
          {"\n\n"}Email: privacy@poolyn.com{"\n"}
          Address: Poolyn Pty Ltd, Melbourne, Victoria, Australia
        </Section>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>Legal note</Text>
          <Text style={styles.noticeText}>
            This is a product implementation draft and should be reviewed by qualified legal
            counsel and a privacy professional before production use.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  page: { flex: 1 },
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.base, paddingBottom: Spacing["4xl"] },
  updated: { color: Colors.textTertiary, marginBottom: Spacing.lg, fontSize: FontSize.sm },
  summary: { alignItems: "center", backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.xl, padding: Spacing.xl, marginBottom: Spacing.xl, gap: Spacing.sm },
  summaryTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.primaryDark, textAlign: "center" },
  summaryBody: { fontSize: FontSize.sm, color: Colors.primaryDark, textAlign: "center", lineHeight: 22, maxWidth: 320 },
  section: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.md },
  sectionTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.xs },
  sectionBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
  noticeBox: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginTop: Spacing.md },
  noticeTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.primaryDark, marginBottom: Spacing.xs },
  noticeText: { fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
});
