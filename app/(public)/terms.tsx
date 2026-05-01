import React from "react";
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "@/constants/theme";

export default function TermsPage() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Pressable style={styles.backBtn} onPress={() => { window.location.href = "/"; }}>
        <Ionicons name="arrow-back" size={16} color={Colors.primary} />
        <Text style={styles.backText}>Back to Poolyn</Text>
      </Pressable>

      <Text style={styles.title}>Terms and Conditions</Text>
      <Text style={styles.meta}>Version 1.0, Effective 1 May 2026</Text>
      <Text style={styles.meta}>
        Jurisdiction coverage: Australia · United States · European Union / United Kingdom
      </Text>

      <NoticeBox>
        Poolyn is a ride-coordination platform only. It is not a transport provider, carrier,
        insurer, or rideshare operator. By creating an account or using any feature of the
        Poolyn platform, you agree to be bound by these Terms in their entirety. If you do
        not agree, do not use the platform.
      </NoticeBox>

      <StripeBox>
        Poolyn uses Stripe Connect to facilitate cost-sharing transfers between users. Poolyn
        does not hold, disburse, or profit from user funds. All payment processing is subject
        to Stripe's own Terms of Service and relevant financial services regulations. Drivers
        may never earn a profit; cost-sharing amounts are strictly limited to documented
        running costs.
      </StripeBox>

      <Section title="1. Definitions">
        <Para>In these Terms, the following words have the following meanings:</Para>
        <DefList items={[
          ['"Platform"', 'The Poolyn website, mobile application, API, and all related services operated by Poolyn Pty Ltd.'],
          ['"User"', 'Any individual who creates an account on the Platform, whether as a Driver, Rider, or Organisation representative.'],
          ['"Driver"', 'A User who offers seats in their private vehicle to Riders for a shared commute.'],
          ['"Rider"', 'A User who accepts an offer to travel in a Driver\'s vehicle.'],
          ['"Organisation"', 'An employer, university, or other entity that registers on the Platform to enable its members to use Poolyn.'],
          ['"Cost-Share Payment"', 'The portion of documented vehicle running costs (fuel, tolls, parking) transferred from a Rider to a Driver via Stripe Connect. It does not constitute a fare, wage, or income.'],
          ['"Corporate Email"', 'An email address issued by a verified Organisation domain, used to authenticate User identity.'],
          ['"Match"', 'A system-generated suggestion that two or more Users share a commute route and schedule.'],
          ['"Stripe Connect"', 'The third-party payment processing service operated by Stripe, Inc., used by Poolyn to facilitate Cost-Share Payments between Users.'],
          ['"Applicable Law"', 'All laws, regulations, and regulatory guidance applicable to a User\'s jurisdiction, including but not limited to the Australian Consumer Law (ACL), the Privacy Act 1988 (Cth), the California Consumer Privacy Act (CCPA), the EU General Data Protection Regulation (GDPR), and relevant transport and financial services legislation.'],
        ]} />
      </Section>

      <Section title="2. Platform Role and Nature of Service">
        <SubSec title="2.1 Coordination Platform Only">
          Poolyn is a software platform that enables Users to discover, coordinate, and arrange
          shared commutes with verified colleagues. Poolyn does not:
        </SubSec>
        <BulletList items={[
          'provide, operate, or procure transportation services;',
          'employ, engage, or direct Drivers in any capacity;',
          'act as a carrier, taxi operator, rideshare operator, transport network company (TNC), or public transport provider;',
          'hold a transport operator licence in any jurisdiction;',
          'underwrite, arrange, or provide motor vehicle, accident, travel, or personal injury insurance; or',
          'guarantee the completion, safety, punctuality, or availability of any trip.',
        ]} />
        <SubSec title="2.2 Independent Decisions">
          All decisions to offer, accept, or decline a trip are made independently and
          voluntarily by Users. Poolyn's role ends at the point of coordination. Users
          acknowledge that Poolyn exercises no control over the physical trip, the vehicle,
          or User behaviour during transit.
        </SubSec>
        <SubSec title="2.3 Not a Regulated Transport or Financial Service">
          Poolyn is not a regulated transport service under Australian state transport
          legislation, the Transportation Network Companies Act (applicable US states), or
          any equivalent European transport directive. Poolyn does not hold or manage user
          funds and is not a payment service provider under PSD2 (EU) or equivalent
          Australian legislation.
        </SubSec>
      </Section>

      <Section title="3. Eligibility and Account Registration">
        <SubSec title="3.1 Age Requirement">
          You must be at least 18 years of age to use the Platform. By registering, you
          represent and warrant that you meet this requirement. Poolyn reserves the right to
          immediately suspend or terminate any account reasonably believed to belong to a
          person under 18.
        </SubSec>
        <SubSec title="3.2 Corporate Email Verification">
          Access to the Platform requires registration with a valid Corporate Email address.
          You represent that: (a) you are an employee, contractor, or authorised member of
          the Organisation associated with your Corporate Email domain; (b) your use of the
          Platform complies with your Organisation's policies; and (c) you will promptly
          notify Poolyn if your employment or association with that Organisation ends.
        </SubSec>
        <SubSec title="3.3 Accurate Information">
          You agree to provide accurate, complete, and current information at registration
          and to promptly update that information if it changes. Providing false information,
          including impersonating another person or misrepresenting your employer, constitutes
          a material breach of these Terms.
        </SubSec>
        <SubSec title="3.4 Account Security">
          You are responsible for maintaining the confidentiality of your account credentials.
          Notify Poolyn immediately at security@poolyn.com if you become aware of any
          unauthorised access. Poolyn is not liable for any loss resulting from unauthorised
          use of your account where such loss arises from your failure to safeguard your
          credentials.
        </SubSec>
      </Section>

      <Section title="4. Driver Obligations and Representations">
        <Para>
          If you use the Platform as a Driver, you represent, warrant, and agree that at all
          times while operating a vehicle in connection with a Poolyn-coordinated trip:
        </Para>
        <SubSec title="4.1 Licensing and Legal Compliance">
          You hold a valid, current, and unrestricted motor vehicle driver's licence; your
          licence authorises you to drive the class of vehicle used; you comply with all
          applicable road rules and traffic laws; and you are not operating under any
          disqualification that would prevent you from lawfully driving.
        </SubSec>
        <SubSec title="4.2 Vehicle Roadworthiness">
          Your vehicle is registered, roadworthy, and maintained in a safe condition; you
          carry out reasonable pre-trip checks; and you do not operate an unsafe vehicle.
        </SubSec>
        <SubSec title="4.3 Insurance (Critical Obligation)">
          This is one of the most important obligations in these Terms. You must:
        </SubSec>
        <BulletList items={[
          'hold a valid Compulsory Third Party (CTP) insurance policy (or equivalent) as required by your jurisdiction;',
          'hold a comprehensive or third-party property motor vehicle insurance policy that covers the use of your vehicle for private purposes including social, domestic, and commuting use;',
          'BEFORE using the Platform as a Driver, contact your insurer to confirm that cost-sharing arrangements do not void, suspend, or limit your policy coverage;',
          'promptly notify your insurer of your participation in Poolyn if required by your policy; and',
          'not represent to Riders that Poolyn provides any form of passenger insurance.',
        ]} />
        <WarningBox title="Insurance Warning: Australia">
          Some Australian personal motor vehicle policies exclude or limit coverage when passengers
          make any financial contribution to running costs. CTP insurance covers personal injury
          only. Drivers are strongly advised to obtain written confirmation from their insurer
          before accepting Cost-Share Payments. Poolyn accepts no responsibility for coverage gaps.
        </WarningBox>
        <WarningBox title="Insurance Warning: USA">
          Personal auto insurance policies in most US states exclude commercial or rideshare use.
          Cost-sharing arrangements may be treated differently by insurers depending on the state.
          Drivers should consult their insurer or broker before proceeding.
        </WarningBox>
        <WarningBox title="Insurance Warning: EU / UK">
          Drivers must comply with the Motor Vehicles (Compulsory Insurance) Directive
          (2009/103/EC) and national implementing legislation. Cost contributions may affect
          the classification of use under your policy.
        </WarningBox>
        <SubSec title="4.4 Fitness to Drive">
          You are not under the influence of alcohol, cannabis, prescription medication that
          impairs driving, or any illicit substance while operating a vehicle; you are
          sufficiently rested and alert to drive safely; and you will immediately cancel a
          trip if you become unfit to drive.
        </SubSec>
        <SubSec title="4.5 No Profit Principle (Mandatory)">
          Drivers may only collect Cost-Share Payments that represent a fair and proportionate
          share of actual, documented running costs (fuel, tolls, parking, and wear) for the
          specific trip. Drivers must not:
        </SubSec>
        <BulletList items={[
          'set a Cost-Share Payment that exceeds their proportionate share of actual running costs;',
          'collect payment for time, labour, or any service beyond vehicle running costs;',
          'use the Platform to operate a commercial transport, taxi, or rideshare service of any kind; or',
          'earn a profit, surplus, or financial benefit beyond strict cost recovery.',
        ]} />
        <Para>
          Breach of the No Profit Principle may constitute unlicensed transport operation under
          Applicable Law and will result in immediate account termination.
        </Para>
      </Section>

      <Section title="5. Rider Obligations">
        <Para>If you use the Platform as a Rider, you agree that:</Para>
        <BulletList items={[
          'you independently assess the suitability, safety, and comfort of any proposed trip before accepting a Match;',
          'you arrive at the agreed pickup location punctually and notify the Driver promptly if you need to cancel;',
          'you wear a seatbelt at all times during the trip;',
          'you do not request or encourage the Driver to violate traffic laws;',
          "you treat the Driver's vehicle with respect and accept liability for any damage you cause to it;",
          "you pay the agreed Cost-Share Payment promptly via the Platform's Stripe Connect facility; and",
          "you do not arrange off-platform payments designed to circumvent Poolyn's No Profit oversight.",
        ]} />
      </Section>

      <Section title="6. Stripe Connect and Cost-Share Payments">
        <SubSec title="6.1 Role of Stripe">
          Poolyn uses Stripe Connect to facilitate Cost-Share Payments between Drivers and
          Riders. Stripe, Inc. is an independent third-party payment processor. By using the
          payment features of the Platform, you also agree to Stripe's Terms of Service and
          Connected Account Agreement, available at stripe.com/legal.
        </SubSec>
        <SubSec title="6.2 Poolyn's Payment Role">
          Poolyn acts solely as a technology intermediary that initiates payment instructions
          on behalf of Users. Poolyn does not hold User funds in its own accounts, does not
          set or profit from Cost-Share Payment amounts beyond any disclosed platform service
          fee, and is not a payment service provider, authorised deposit-taking institution,
          electronic money institution, or money transmitter in any jurisdiction.
        </SubSec>
        <SubSec title="6.3 Pre-Authorisation and Capture">
          When a Rider confirms a trip, Poolyn (via Stripe) may place a pre-authorisation
          hold on the Rider's payment method. The hold will be captured upon trip completion
          or released if the trip is cancelled in accordance with these Terms.
        </SubSec>
        <SubSec title="6.4 Refunds and Disputes">
          Driver cancellation before the trip: full refund to Rider. Rider cancellation with
          adequate notice: full refund. Rider no-show or late cancellation: subject to the
          cancellation policy displayed at booking. Disputed completed trips must be raised
          via support@poolyn.com within 48 hours; Poolyn's decision is final for amounts
          under AUD $200 / USD $150 / EUR 130.
        </SubSec>
        <SubSec title="6.5 Platform Service Fee">
          Poolyn may charge a platform service fee as disclosed at the time of booking. All
          fees are inclusive of applicable taxes (including GST in Australia and VAT in the
          EU/UK) where required by law. Fees are non-refundable except where required by
          Applicable Law or these Terms.
        </SubSec>
        <SubSec title="6.6 Tax Obligations">
          Users are solely responsible for determining and meeting their tax obligations
          arising from Cost-Share Payments received. Poolyn does not provide tax advice and
          does not withhold tax on behalf of Users. Seek independent tax advice relevant to
          your jurisdiction.
        </SubSec>
      </Section>

      <Section title="7. Prohibited Conduct">
        <Para>
          The following conduct is strictly prohibited and may result in immediate account
          suspension, permanent termination, reporting to relevant authorities, and/or legal action:
        </Para>
        <BulletList items={[
          'Providing false, misleading, or fraudulent information to Poolyn or other Users;',
          'Using the Platform to operate an unlicensed commercial transport, taxi, or rideshare service;',
          'Accepting Cost-Share Payments that exceed documented running costs;',
          'Harassment, bullying, verbal abuse, threatening conduct, or physical violence toward any User;',
          'Discrimination on the basis of race, colour, national origin, religion, sex, gender identity, sexual orientation, disability, pregnancy, age, or any other protected characteristic under Applicable Law;',
          'Driving under the influence of alcohol, illicit substances, or impairing medication;',
          'Recording, photographing, or filming other Users without their explicit consent;',
          'Soliciting personal contact details or arranging trips off-platform to avoid safety or payment features;',
          "Attempting to access, scrape, reverse-engineer, or interfere with the Platform's systems or data;",
          'Creating multiple accounts or sharing account access with another person; and',
          'Using the Platform for any purpose other than legitimate commute coordination.',
        ]} />
      </Section>

      <Section title="8. Liability, Disclaimer, and Indemnity">
        <SubSec title="8.1 Disclaimer of Warranties">
          To the maximum extent permitted by Applicable Law, the Platform is provided "as is"
          and "as available". Poolyn makes no representations or warranties, express or implied,
          regarding the safety or conduct of any Driver or Rider, the accuracy of any Match, or
          the availability, reliability, or fitness for purpose of the Platform.
        </SubSec>
        <SubSec title="8.2 Australian Consumer Law">
          Nothing in these Terms excludes, restricts, or modifies any right or remedy implied
          or imposed by the Australian Consumer Law (Schedule 2, Competition and Consumer Act
          2010 (Cth)) or equivalent legislation that cannot lawfully be excluded. Where
          statutory guarantees cannot be excluded, Poolyn's liability is limited to
          re-supplying the relevant service or paying the cost of having it re-supplied.
        </SubSec>
        <SubSec title="8.3 European Consumer Rights">
          For Users in the EEA or United Kingdom, nothing in these Terms limits rights
          available under Directive 2011/83/EU (Consumer Rights Directive), Directive
          93/13/EEC (Unfair Contract Terms), or applicable national consumer protection
          legislation.
        </SubSec>
        <SubSec title="8.4 US State Consumer Protections">
          For Users in the United States, these Terms do not exclude rights under applicable
          state consumer protection statutes, including the California Consumers Legal Remedies
          Act (CLRA), California Unfair Competition Law (UCL), or equivalent statutes.
        </SubSec>
        <SubSec title="8.5 Limitation of Liability">
          Subject to clauses 8.2-8.4, to the maximum extent permitted by Applicable Law,
          Poolyn's total aggregate liability to any User for all claims is limited to the
          greater of: the total platform service fees paid by that User to Poolyn in the 3
          months preceding the event; or AUD $100 / USD $75 / EUR 65. Poolyn is not liable
          for any indirect, special, incidental, punitive, or consequential loss or damage,
          including loss of profits, loss of data, personal injury, or property damage.
        </SubSec>
        <SubSec title="8.6 User-to-User Liability">
          Disputes arising between Users (including accidents, property damage, personal
          injury, or financial loss) are matters solely between those Users. Poolyn is not
          a party to such disputes and accepts no liability for their resolution.
        </SubSec>
        <SubSec title="8.7 Indemnity">
          You agree to defend, indemnify, and hold harmless Poolyn, its officers, directors,
          employees, and contractors from and against any claims, liabilities, damages,
          losses, costs, and expenses (including reasonable legal fees) arising from: your
          use of the Platform; any trip you participate in as a Driver or Rider; your breach
          of these Terms or any Applicable Law; your vehicle, its condition, registration,
          insurance, or operation; or any false or misleading information you provide to Poolyn.
        </SubSec>
      </Section>

      <Section title="9. Data, Privacy, and Location">
        <SubSec title="9.1 Privacy Policy">
          Poolyn's collection, use, storage, and disclosure of personal information is governed
          by its Privacy Policy, available at poolyn.com/privacy, which is incorporated into
          these Terms by reference.
        </SubSec>
        <SubSec title="9.2 Australian Privacy Act">
          Poolyn complies with the Privacy Act 1988 (Cth) and the Australian Privacy Principles
          (APPs). Users have the right to access, correct, and complain about the handling of
          their personal information by contacting privacy@poolyn.com.
        </SubSec>
        <SubSec title="9.3 GDPR (EU/UK)">
          For Users in the EEA or UK, Poolyn processes personal data as a data controller under
          the GDPR. Legal bases for processing include: contract performance (Art. 6(1)(b)),
          legitimate interests (Art. 6(1)(f)) for fraud prevention and platform safety, and
          consent (Art. 6(1)(a)) for marketing. EEA/UK Users have the right to access, rectify,
          erase, restrict, and port their personal data, and to lodge a complaint with their
          national supervisory authority. Contact: privacy@poolyn.com.
        </SubSec>
        <SubSec title="9.4 US Privacy Rights (CCPA)">
          For Users in California and other applicable US states, you have the right to know
          what personal information Poolyn collects; the right to delete personal information
          (subject to exceptions); the right to opt out of the sale of personal information
          (Poolyn does not sell personal information); and the right to non-discrimination for
          exercising your privacy rights. To exercise CCPA rights: privacy@poolyn.com.
        </SubSec>
        <SubSec title="9.5 Location Data">
          The Platform uses approximate location data to generate Matches. Exact home and work
          addresses are controlled by Users through in-app privacy settings. Poolyn does not
          share precise location data with other Users without your consent and does not sell
          location data to third parties.
        </SubSec>
        <SubSec title="9.6 Corporate Email and Organisational Data">
          When you register with a Corporate Email, your registration domain may be visible to
          your Organisation's administrator on Poolyn. Personal information shared with your
          Organisation is limited to what is necessary for administration, as described in the
          Privacy Policy and any applicable Organisation agreement with Poolyn.
        </SubSec>
      </Section>

      <Section title="10. Organisation Accounts">
        <SubSec title="10.1 Relationship">
          Organisations that register on the Platform do so as independent entities. Use of the
          Platform by an Organisation's employees or members does not create an employment,
          agency, joint venture, or partnership relationship between Poolyn and the Organisation.
          Organisations are solely responsible for their internal commuting policies and legal
          compliance.
        </SubSec>
        <SubSec title="10.2 Organisation Administrator Responsibilities">
          Organisation administrators agree to: use administrator access only for legitimate
          commute coordination purposes; not access, disclose, or misuse User personal data
          beyond what is necessary for administration; comply with applicable data protection
          law; and promptly notify Poolyn of any suspected misuse of the Platform by their
          members.
        </SubSec>
        <SubSec title="10.3 Domain Restriction">
          Organisations may request that Poolyn restrict Platform access to their registered
          domain. Poolyn will implement domain restrictions in good faith but does not guarantee
          that access controls are impenetrable and accepts no liability for unauthorised domain
          access resulting from factors outside Poolyn's reasonable control.
        </SubSec>
      </Section>

      <Section title="11. Intellectual Property">
        <Para>
          All intellectual property rights in the Platform, including its software, design,
          trademarks, content, algorithms, and underlying technology, are owned by or licensed
          to Poolyn Pty Ltd. Nothing in these Terms grants you any right, title, or interest in
          the Platform's intellectual property beyond a limited, non-exclusive, non-transferable,
          revocable licence to use the Platform for its intended purpose.
        </Para>
        <Para>
          You grant Poolyn a non-exclusive, royalty-free, worldwide licence to use, reproduce,
          and process content you submit to the Platform (including commute data, reviews, and
          feedback) for the purpose of operating, improving, and promoting the Platform, in
          accordance with the Privacy Policy.
        </Para>
      </Section>

      <Section title="12. Suspension and Termination">
        <SubSec title="12.1 By Poolyn">
          Poolyn may suspend or terminate your account immediately and without notice if: you
          breach any provision of these Terms; Poolyn reasonably believes your account poses a
          safety risk to other Users; you provide false or fraudulent information; required by
          Applicable Law or a regulatory authority; or the Platform ceases to operate in your
          jurisdiction. Poolyn may also terminate accounts with 30 days' notice for any other
          reason, including discontinuation of the Platform or service in your area.
        </SubSec>
        <SubSec title="12.2 By You">
          You may close your account at any time through the account settings. Closing your
          account does not affect any outstanding obligations, including pending Cost-Share
          Payments or claims arising before the closure date.
        </SubSec>
        <SubSec title="12.3 Effect of Termination">
          On termination, your licence to use the Platform immediately ceases. Poolyn will
          handle your personal data in accordance with the Privacy Policy and Applicable Law.
          Clauses relating to liability, indemnity, intellectual property, dispute resolution,
          and governing law survive termination.
        </SubSec>
      </Section>

      <Section title="13. Modifications to Terms and Platform">
        <Para>
          Poolyn reserves the right to modify these Terms at any time. Where modifications are
          material, Poolyn will provide at least 14 days' notice via email to your registered
          address or via a prominent in-platform notification before the changes take effect.
          Your continued use of the Platform after the notice period constitutes acceptance of
          the modified Terms.
        </Para>
        <Para>
          Poolyn may modify, suspend, or discontinue any feature of the Platform at any time.
          Where practical, Poolyn will provide reasonable notice of material changes to the
          Platform's functionality.
        </Para>
      </Section>

      <Section title="14. Dispute Resolution">
        <SubSec title="14.1 Informal Resolution">
          Before commencing formal legal proceedings, Users agree to attempt to resolve any
          dispute with Poolyn informally by contacting legal@poolyn.com with a written
          description of the dispute. Poolyn will respond within 14 business days and the
          parties will attempt to resolve the dispute in good faith within 30 days.
        </SubSec>
        <SubSec title="14.2 Mediation">
          If informal resolution fails, either party may refer the dispute to mediation
          administered by the Resolution Institute (Australia), the American Arbitration
          Association (USA), or the Centre for Effective Dispute Resolution (CEDR) (UK/EU),
          as applicable. The costs of mediation will be shared equally unless the mediator
          determines otherwise.
        </SubSec>
        <SubSec title="14.3 Jurisdiction">
          Subject to clause 14.4 and mandatory consumer protections, any legal proceedings
          that are not resolved by mediation will be determined by the courts of Victoria,
          Australia, and you submit to the non-exclusive jurisdiction of those courts.
        </SubSec>
        <SubSec title="14.4 EU Consumer ADR">
          For Users in the EEA, Poolyn acknowledges the EU Online Dispute Resolution platform
          at ec.europa.eu/consumers/odr. EEA consumers retain the right to bring proceedings
          before their local courts and consumer protection authorities.
        </SubSec>
        <SubSec title="14.5 Class Action Waiver (USA)">
          For Users in the United States, to the extent permitted by Applicable Law, you agree
          to resolve disputes individually and waive any right to participate in a class action,
          collective action, or representative proceeding against Poolyn.
        </SubSec>
      </Section>

      <Section title="15. Governing Law">
        <Para>
          These Terms are governed by and construed in accordance with the laws of Victoria,
          Australia, without regard to conflict of law principles. However, Australian Consumer
          Law mandatory provisions apply to all Australian Users; GDPR and applicable EU/UK
          consumer law applies to all EEA and UK Users; and applicable US state consumer
          protection statutes apply to Users in those states.
        </Para>
      </Section>

      <Section title="16. General Provisions">
        <DefList items={[
          ['Entire Agreement', 'These Terms, together with the Privacy Policy and any applicable Organisation agreement, constitute the entire agreement between you and Poolyn in relation to the Platform.'],
          ['Severability', 'If any provision of these Terms is found to be invalid, illegal, or unenforceable, it will be modified to the minimum extent necessary to make it enforceable, or severed if modification is not possible. The remaining provisions continue in full force.'],
          ['Waiver', "Poolyn's failure to enforce any right under these Terms does not constitute a waiver of that right."],
          ['Assignment', "Poolyn may assign these Terms to a successor entity in connection with a merger, acquisition, or sale of substantially all assets, with 30 days' notice to Users. You may not assign your rights without Poolyn's prior written consent."],
          ['Force Majeure', 'Poolyn is not liable for any failure or delay in performance caused by circumstances beyond its reasonable control, including natural disasters, pandemic, government action, cyberattacks, or third-party service failures.'],
          ['Language', 'These Terms are published in English. Where a translation is provided, the English version prevails in the event of inconsistency.'],
        ]} />
      </Section>

      <Section title="17. Contact and Regulatory Information">
        <Para>Poolyn Pty Ltd is registered in Victoria, Australia.</Para>
        <DefList items={[
          ['General enquiries and support', 'hello@poolyn.com'],
          ['Legal, compliance and privacy', 'legal@poolyn.com'],
          ['Security incidents', 'security@poolyn.com'],
          ['Website', 'www.poolyn.com'],
        ]} />
      </Section>

      <View style={styles.reviewBox}>
        <Text style={styles.reviewTitle}>Legal Review Required</Text>
        <Text style={styles.reviewText}>
          This document is an operational draft prepared to cover known legal considerations
          across Australian, US, and EU jurisdictions. It has not been reviewed or approved by
          qualified legal counsel. It must be reviewed by a lawyer with expertise in transport
          law, financial services regulation, data protection, and consumer law in each
          applicable jurisdiction before being relied upon as Poolyn's binding terms of service.
        </Text>
      </View>

      <Text style={styles.copyright}>
        {"\u00A9"} 2026 Poolyn Pty Ltd. All rights reserved.
      </Text>
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NoticeBox({ children }: { children: string }) {
  return (
    <View style={styles.importantBox}>
      <Text style={styles.importantTitle}>Important Notice</Text>
      <Text style={styles.importantText}>{children}</Text>
    </View>
  );
}

function StripeBox({ children }: { children: string }) {
  return (
    <View style={styles.stripeBox}>
      <Text style={styles.stripeTitle}>Stripe Payments Notice</Text>
      <Text style={styles.stripeText}>{children}</Text>
    </View>
  );
}

function WarningBox({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.warningBox}>
      <Text style={styles.warningTitle}>{title}</Text>
      <Text style={styles.warningText}>{children}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SubSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.subSec}>
      <Text style={styles.subSecTitle}>{title}</Text>
      {typeof children === "string" ? (
        <Text style={styles.bodyText}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return typeof children === "string" ? (
    <Text style={[styles.bodyText, styles.paraMb]}>{children}</Text>
  ) : (
    <View style={styles.paraMb}>{children}</View>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View style={styles.bulletList}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bullet}>{"\u2022"}</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function DefList({ items }: { items: [string, string][] }) {
  return (
    <View style={styles.defList}>
      {items.map(([term, def], i) => (
        <View key={i} style={styles.defRow}>
          <Text style={styles.defTerm}>{term}</Text>
          <Text style={styles.defBody}>{def}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 26,
    paddingBottom: 56,
    gap: Spacing.md,
    maxWidth: 860,
    alignSelf: "center",
    width: "100%",
  },

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
  },
  title: {
    fontSize: 34,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  meta: {
    color: Colors.textTertiary,
    fontSize: FontSize.xs,
    lineHeight: 18,
  },

  // Notice boxes
  importantBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  importantTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.xs,
  },
  importantText: {
    fontSize: FontSize.sm,
    color: Colors.primaryDark,
    lineHeight: 21,
  },

  stripeBox: {
    backgroundColor: "#F0F7FF",
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: "#3B82F6",
  },
  stripeTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: "#1E40AF",
    marginBottom: Spacing.xs,
  },
  stripeText: {
    fontSize: FontSize.sm,
    color: "#1E40AF",
    lineHeight: 21,
  },

  warningBox: {
    backgroundColor: "#FFFBEB",
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    marginTop: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: "#F59E0B",
  },
  warningTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: "#92400E",
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  warningText: {
    fontSize: FontSize.xs,
    color: "#78350F",
    lineHeight: 19,
  },

  reviewBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  reviewTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.xs,
  },
  reviewText: {
    fontSize: FontSize.sm,
    color: Colors.primaryDark,
    lineHeight: 21,
  },

  // Sections
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },

  subSec: { marginBottom: Spacing.md },
  subSecTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },

  bodyText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  paraMb: { marginBottom: Spacing.sm },

  bulletList: { marginTop: Spacing.xs, marginBottom: Spacing.sm, gap: 4 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bullet: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    lineHeight: 22,
    flexShrink: 0,
    marginTop: 1,
  },
  bulletText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
  },

  defList: { gap: 8, marginTop: Spacing.xs },
  defRow: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    paddingBottom: 8,
  },
  defTerm: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: 2,
  },
  defBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  copyright: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
});
