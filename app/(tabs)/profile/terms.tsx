import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "@/constants/theme";

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView style={styles.page} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: 2026-03-30</Text>

        <Section title="Important notice">
          Poolyn is a coordination platform that helps users discover and arrange shared commutes.
          Poolyn does not provide transportation services, does not employ drivers, and does not
          operate as a carrier, taxi, rideshare operator, or transport insurer.
        </Section>

        <Section title="1. Platform role and no transport warranty">
          Users independently decide whether to drive, ride, or decline any match. Poolyn does not
          guarantee trip availability, punctuality, route safety, rider behavior, or trip completion.
          All travel decisions are made at the user's own risk.
        </Section>

        <Section title="2. Driver and passenger responsibility">
          Drivers are solely responsible for holding valid licenses, complying with laws, maintaining
          roadworthy vehicles, and carrying legally required insurance. Passengers are solely
          responsible for assessing trip suitability and personal safety before joining any ride.
        </Section>

        <Section title="3. Insurance and liability disclaimer">
          Poolyn does not provide motor vehicle insurance, accident coverage, workers' compensation,
          medical insurance, or personal injury coverage for users. To the fullest extent permitted by
          law, Poolyn disclaims liability for accidents, injuries, losses, theft, delays, disputes,
          property damage, or consequential damages arising from use of the platform.
        </Section>

        <Section title="4. No employer or university agency">
          Where organisations use Poolyn, the platform does not create employment, agency, joint
          venture, or partnership relationships between Poolyn, organisations, drivers, or riders.
          Organisations remain responsible for their own commuting policies and legal compliance.
        </Section>

        <Section title="5. User conduct and prohibited behaviour">
          Users must provide accurate information, comply with applicable law, and treat others
          respectfully. Illegal conduct, harassment, discrimination, impaired driving, fraud, or any
          unsafe behaviour is prohibited and may lead to suspension or account removal.
        </Section>

        <Section title="6. Matching, availability, and service interruptions">
          Matching results are probabilistic and may change due to supply, demand, location, or timing.
          Poolyn does not warrant uninterrupted availability and may modify, suspend, or discontinue
          features at any time.
        </Section>

        <Section title="7. Data, privacy, and location">
          Poolyn uses provided data (including approximate commute information) to generate matches
          and analytics. Exact address handling is controlled by product privacy settings; users are
          responsible for reviewing in-app privacy controls before sharing information. Please review
          our Privacy Policy for full details on how we collect and use data.
        </Section>

        <Section title="8. Points, Flex Credits, and virtual assets">
          Points and Flex Credits have no monetary value and cannot be redeemed for cash. They are
          awarded and governed by Poolyn at its discretion. Poolyn reserves the right to modify or
          discontinue these programs at any time with reasonable notice.
        </Section>

        <Section title="9. Limitation of liability">
          To the maximum extent allowed by law, Poolyn's aggregate liability for any claim relating
          to the platform is limited to the amount paid by the relevant organisation (if any) for the
          prior 3 months, or AUD $100 for individual free users, whichever is greater.
        </Section>

        <Section title="10. Indemnity">
          You agree to indemnify and hold harmless Poolyn, its officers, employees, and contractors
          from claims, losses, liabilities, damages, and costs arising from your use of the platform,
          your trips, your vehicle, or your breach of these terms.
        </Section>

        <Section title="11. Changes to these terms">
          Poolyn may update these Terms & Conditions from time to time. Material changes will be
          notified in-app or via email. Continued use of the platform after changes constitutes
          acceptance of the updated terms.
        </Section>

        <Section title="12. Governing law">
          These terms are governed by the laws of Victoria, Australia, unless local mandatory consumer
          protections apply in your jurisdiction.
        </Section>

        <Section title="13. Contact">
          Questions about these terms can be directed to: legal@poolyn.com
        </Section>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>Legal note</Text>
          <Text style={styles.noticeText}>
            This is a product implementation draft and should be reviewed by qualified legal
            counsel before production use.
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
  updated: { color: Colors.textTertiary, marginBottom: Spacing.xl, fontSize: FontSize.sm },
  section: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.md },
  sectionTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.xs },
  sectionBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
  noticeBox: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.lg, padding: Spacing.lg, marginTop: Spacing.md },
  noticeTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.primaryDark, marginBottom: Spacing.xs },
  noticeText: { fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
});
