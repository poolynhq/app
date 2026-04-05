import { useRef, useState } from "react";
import {
  ImageBackground,
  LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
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
import { LandingIcon } from "@/components/landing/LandingIcon";
import { WaitlistModal } from "@/components/landing/WaitlistModal";
import type { WaitlistIntent } from "@/lib/waitlistSignup";

type SectionKey =
  | "how"
  | "features"
  | "diff"
  | "impact"
  | "community"
  | "orgs";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1544620347-c4fd4a3d595f?auto=format&fit=crop&w=2000&q=80";

export default function MarketingLanding() {
  const { width } = useWindowDimensions();
  const isWide = width >= 880;
  const isMedium = width >= 560;
  const scrollRef = useRef<ScrollView>(null);
  const [ys, setYs] = useState<Record<SectionKey, number>>({
    how: 0,
    features: 0,
    diff: 0,
    impact: 0,
    community: 0,
    orgs: 0,
  });
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistIntent, setWaitlistIntent] = useState<WaitlistIntent | undefined>(
    undefined
  );

  function mark(key: SectionKey, e: LayoutChangeEvent) {
    setYs((p) => ({ ...p, [key]: e.nativeEvent.layout.y }));
  }

  function jump(key: SectionKey) {
    scrollRef.current?.scrollTo({
      y: Math.max(0, ys[key] - (isWide ? 84 : 64)),
      animated: true,
    });
  }

  function openWaitlist(intent?: WaitlistIntent) {
    setWaitlistIntent(intent);
    setWaitlistOpen(true);
  }

  const contentPad = isWide ? 56 : 24;
  const maxPage = isWide ? { maxWidth: 1140, width: "100%" as const } : {};

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={[
          styles.pageContent,
          Platform.OS === "web" && maxPage,
        ]}
      >
        {/* —— Nav (B: light bar + strong CTA) + links aligned to combined IA —— */}
        <View style={[styles.nav, { paddingHorizontal: contentPad }]}>
          <View style={styles.navLeft}>
            <View style={styles.logoMark} accessibilityLabel="Poolyn">
              <Ionicons name="leaf" size={18} color={Landing.white} />
            </View>
            <Text style={styles.logo}>Poolyn</Text>
          </View>
          {isMedium ? (
            <View style={styles.navMid}>
              <Pressable onPress={() => jump("how")} hitSlop={6}>
                <Text style={styles.navLink}>How it works</Text>
              </Pressable>
              <Pressable onPress={() => jump("features")} hitSlop={6}>
                <Text style={styles.navLink}>Features</Text>
              </Pressable>
              <Pressable onPress={() => jump("impact")} hitSlop={6}>
                <Text style={styles.navLink}>Impact</Text>
              </Pressable>
              <Pressable onPress={() => jump("community")} hitSlop={6}>
                <Text style={styles.navLink}>Community</Text>
              </Pressable>
              <Pressable onPress={() => jump("orgs")} hitSlop={6}>
                <Text style={styles.navLink}>Organizations</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.navRight}>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable hitSlop={6}>
                <Text style={styles.navLinkMuted}>Sign in</Text>
              </Pressable>
            </Link>
            <Pressable
              style={styles.navCta}
              onPress={() => openWaitlist()}
            >
              <Text style={styles.navCtaText}>Join the waitlist</Text>
            </Pressable>
          </View>
        </View>

        {/* —— Hero: B photo + gradient + A headline clarity + B badges & metrics —— */}
        <View style={styles.heroWrap}>
          <ImageBackground
            source={{ uri: HERO_IMAGE }}
            style={styles.heroBg}
            imageStyle={styles.heroBgImage}
          >
            <LinearGradient
              colors={[
                "rgba(8, 40, 32, 0.94)",
                "rgba(12, 55, 44, 0.78)",
                "rgba(15, 61, 46, 0.5)",
              ]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={[styles.heroInner, { paddingHorizontal: contentPad }]}>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Ionicons name="shield-checkmark-outline" size={15} color={Landing.tealBright} />
                  <Text style={styles.badgeText}>Verified professionals</Text>
                </View>
                <View style={styles.badge}>
                  <Ionicons name="leaf-outline" size={15} color={Landing.tealBright} />
                  <Text style={styles.badgeText}>Lower carbon commuting</Text>
                </View>
              </View>
              <Text style={styles.heroKicker}>Smart corporate carpooling</Text>
              <Text style={styles.heroTitle}>
                Stop driving alone.{"\n"}
                <Text style={styles.heroTitleAccent}>Start commuting smarter.</Text>
              </Text>
              <Text style={styles.heroSub}>
                Poolyn connects verified professionals who share routes and
                schedules — cutting costs, congestion, and carbon. Aligned by
                route. Synced by schedule.
              </Text>
              <View style={styles.heroBtnRow}>
                <Pressable
                  style={styles.heroPrimary}
                  onPress={() => openWaitlist()}
                >
                  <Text style={styles.heroPrimaryText}>Join the waitlist</Text>
                  <Ionicons name="arrow-forward" size={18} color={Landing.forestDeep} />
                </Pressable>
                <Pressable
                  style={styles.heroGhost}
                  onPress={() => jump("how")}
                >
                  <Text style={styles.heroGhostText}>See how it works</Text>
                </Pressable>
              </View>
              <View style={[styles.metrics, !isWide && styles.metricsStack]}>
                <Metric num="40%" label="Less commute cost" />
                <View style={[styles.metricRule, !isWide && styles.metricRuleH]} />
                <Metric num="3.2t" label="CO₂ saved / rider / yr" />
                <View style={[styles.metricRule, !isWide && styles.metricRuleH]} />
                <Metric num="0" label="Awkward cash splits" />
              </View>
            </View>
          </ImageBackground>
        </View>

        {/* —— How it works: A 3-step horizontal (cleaner than 4-up) —— */}
        <View
          onLayout={(e) => mark("how", e)}
          style={[styles.sectionLight, { paddingHorizontal: contentPad }]}
        >
          <Text style={styles.eyebrow}>How it works</Text>
          <Text style={styles.sectionH1}>Three steps to smarter commuting</Text>
          <View style={[styles.stepsRow, !isWide && styles.stepsCol]}>
            <Step
              n="01"
              title="Set your route & schedule"
              body="Tell Poolyn where you go and when. It takes about a minute."
              icon="location-outline"
            />
            <StepConnector show={isWide} />
            <Step
              n="02"
              title="Get matched with aligned commuters"
              body="We find professionals on your route, at your time — colleagues first."
              icon="people-outline"
            />
            <StepConnector show={isWide} />
            <Step
              n="03"
              title="Drive or ride — switch anytime"
              body="Flexible roles. Drive today, ride tomorrow. You're always in control."
              icon="swap-horizontal-outline"
            />
          </View>
        </View>

        {/* —— Features: B 6-card grid + featured verification card —— */}
        <View
          onLayout={(e) => mark("features", e)}
          style={[styles.sectionAlt, { paddingHorizontal: contentPad }]}
        >
          <Text style={styles.eyebrow}>Features</Text>
          <Text style={styles.sectionH1}>
            Built for professionals.{" "}
            <Text style={styles.sectionH1Accent}>Designed for trust.</Text>
          </Text>
          <Text style={styles.sectionLead}>
            Every feature is crafted to make carpooling safe, fair, and genuinely
            enjoyable.
          </Text>
          <View style={styles.featureGrid}>
            <FeatureCard
              highlight
              icon="shield-checkmark-outline"
              title="Work email verification"
              body="Only verified professionals with corporate or university emails join your network."
            />
            <FeatureCard
              icon="business-outline"
              title="Organization networks"
              body="Private commuting groups for your company — or aligned individuals on similar routes."
            />
            <FeatureCard
              icon="pulse-outline"
              title="Real-time supply & demand"
              body="See live commuter demand so you can choose to drive or ride with confidence."
            />
            <FeatureCard
              icon="calculator-outline"
              title="Transparent cost sharing"
              body="Fair splits that account for distance, detours, tolls, and passenger count."
            />
            <FeatureCard
              icon="ribbon-outline"
              title="Poolyn credits for drivers"
              body="Driving earns credits for future rides — flexible, not awkward."
            />
            <FeatureCard
              icon="happy-outline"
              title="Community & gamification"
              body="Icebreakers, playlists, and light gamification that make rides human."
            />
          </View>
        </View>

        {/* —— Core differentiators: A 2×2 “coordinated commuting” —— */}
        <View
          onLayout={(e) => mark("diff", e)}
          style={[styles.sectionLight, { paddingHorizontal: contentPad }]}
        >
          <Text style={styles.eyebrow}>Core differentiators</Text>
          <Text style={styles.sectionH1Center}>
            Not just carpooling.{" "}
            <Text style={styles.sectionH1Accent}>Coordinated commuting.</Text>
          </Text>
          <View style={styles.diffGrid}>
            <DiffCard
              icon="git-network-outline"
              title="Smart matching engine"
              body="Route + schedule syncing. Intelligent alignment from real commuting patterns — not random pairing."
            />
            <DiffCard
              icon="analytics-outline"
              title="Real-time supply & demand"
              body="See who's heading your way and decide whether to drive or ride."
            />
            <DiffCard
              icon="calculator-outline"
              title="Fair cost sharing"
              body="Transparent math: distance, detours, passengers, and tolls. Everyone pays their fair share."
            />
            <DiffCard
              icon="disc-outline"
              title="Poolyn credits"
              body="Drivers earn credits for future rides — seamless ledger, no cash in the car."
            />
          </View>
        </View>

        {/* —— Impact: A outcomes grid + B dark “why it matters” band —— */}
        <View onLayout={(e) => mark("impact", e)}>
          <View style={[styles.sectionLight, { paddingHorizontal: contentPad }]}>
            <Text style={styles.eyebrow}>Why Poolyn</Text>
            <Text style={styles.sectionH1}>Outcomes, not just features</Text>
            <Text style={styles.sectionLead}>
              Every shared ride creates a ripple of positive impact.
            </Text>
            <View style={styles.outcomeGrid}>
              <OutcomeCard icon="flame-outline" stat="Up to 50%" text="Reduce fuel costs" />
              <OutcomeCard icon="warning-outline" stat="Fewer cars" text="Less congestion" />
              <OutcomeCard icon="car-outline" stat="Shared miles" text="Less wear on vehicles" />
              <OutcomeCard icon="person-outline" stat="Fill every ride" text="Fewer empty seats" />
              <OutcomeCard icon="leaf-outline" stat="Green impact" text="Lower CO₂ emissions" />
              <OutcomeCard icon="location-outline" stat="Shared spots" text="Less parking stress" />
            </View>
          </View>

          <LinearGradient
            colors={[Landing.forestDeep, Landing.forest]}
            style={[styles.impactBand, { paddingHorizontal: contentPad }]}
          >
            <Text style={styles.eyebrowOnDark}>Why it matters</Text>
            <Text style={styles.impactTitle}>
              Stop wasting money.{" "}
              <Text style={styles.impactTitleAccent}>Start sharing smarter.</Text>
            </Text>
            <Text style={styles.impactSub}>
              Every empty seat is a missed opportunity.
            </Text>
            <View style={styles.impactGrid}>
              <ImpactItem icon="car-outline" title="Reduce road congestion" body="Fewer single-occupancy vehicles on peak corridors." />
              <ImpactItem icon="flame-outline" title="Reduce fuel costs" body="Share fuel expenses instead of absorbing them alone." />
              <ImpactItem icon="construct-outline" title="Reduce vehicle wear" body="Split miles across your carpool — maintenance adds up." />
              <ImpactItem icon="globe-outline" title="Reduce environmental impact" body="Measurable CO₂ savings your team can report." />
              <ImpactItem icon="pin-outline" title="Reduce parking hassle" body="Less circling, less stress at the office." />
              <ImpactItem icon="cash-outline" title="Stop paying for empty seats" body="Fair, transparent splits — no awkward Venmo chains." />
            </View>
          </LinearGradient>
        </View>

        {/* —— Community: B storytelling + A 3-column experience (condensed) —— */}
        <View
          onLayout={(e) => mark("community", e)}
          style={[styles.sectionLight, { paddingHorizontal: contentPad }]}
        >
          <View style={[styles.commRow, !isWide && styles.commCol]}>
            <View style={styles.commCopy}>
              <Text style={styles.eyebrow}>Community</Text>
              <Text style={styles.sectionH1}>
                More than a ride.{" "}
                <Text style={styles.sectionH1Accent}>A daily ritual.</Text>
              </Text>
              <Text style={styles.sectionLead}>
                Poolyn turns your commute into a social experience — without forcing
                small talk.
              </Text>
              <View style={styles.commMiniGrid}>
                <CommMini icon="dice-outline" title="Spin the wheel" body="Multiple drivers? Let the app pick fairly." />
                <CommMini icon="chatbubbles-outline" title="Talking points" body="Optional icebreakers for meaningful conversations." />
                <CommMini icon="musical-notes-outline" title="Shared audio" body="Vote on playlists and podcasts together." />
                <CommMini icon="game-controller-outline" title="Gamified rides" body="Badges and perks the more you ride together." />
              </View>
            </View>
            <LinearGradient
              colors={["rgba(13,148,136,0.07)", Landing.white]}
              style={styles.commArt}
            >
              <View style={styles.commArtStack}>
                <LandingIcon
                  name="people-outline"
                  size={22}
                  box={50}
                  tone="surfaceOutline"
                  rounded="pill"
                />
                <Ionicons
                  name="car-sport-outline"
                  size={76}
                  color={Landing.forest}
                  style={styles.commArtCar}
                />
                <LandingIcon
                  name="chatbubble-ellipses-outline"
                  size={20}
                  box={42}
                  tone="surface"
                  rounded="tile"
                />
              </View>
              <Text style={styles.commArtCaption}>Your carpool, elevated</Text>
            </LinearGradient>
          </View>

          <Text style={[styles.eyebrow, { marginTop: Spacing["4xl"] }]}>
            Community & experience
          </Text>
          <Text style={[styles.sectionH1, { marginBottom: Spacing.xl }]}>
            Make your commute the best part of the day
          </Text>
          <View style={styles.triRow}>
            <TriCol
              icon="musical-note-outline"
              title="Shared music & podcasts"
              body="Discover favorites from people you actually respect."
            />
            <TriCol
              icon="chatbox-ellipses-outline"
              title="Conversation prompts"
              body="Optional prompts keep rides enjoyable — not awkward silence."
            />
            <TriCol
              icon="trophy-outline"
              title="Gamification & fun"
              body="Spin the wheel, earn badges, unlock perks as a group."
            />
          </View>
        </View>

        {/* —— Organizations: A split + dashboard preview card —— */}
        <View
          onLayout={(e) => mark("orgs", e)}
          style={[styles.sectionAlt, { paddingHorizontal: contentPad }]}
        >
          <View style={[styles.orgRow, !isWide && styles.commCol]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>For organizations</Text>
              <Text style={styles.sectionH1}>Turn commuting into a company benefit</Text>
              <Text style={styles.sectionLead}>
                Reduce parking demand, boost morale, and hit sustainability targets
                with real commute data.
              </Text>
              <OrgBullet
                icon="git-network-outline"
                title="Private commuting networks"
                body="An exclusive carpool layer for your team and domain."
              />
              <OrgBullet
                icon="heart-outline"
                title="Better employee experience"
                body="Happier commutes build stronger, more connected teams."
              />
              <OrgBullet
                icon="leaf-outline"
                title="Sustainability goals"
                body="Measurable CO₂ insights to support ESG reporting."
              />
              <Pressable
                style={styles.secondaryOutline}
                onPress={() => openWaitlist("organization")}
              >
                <Text style={styles.secondaryOutlineText}>Join as an organization</Text>
              </Pressable>
              <Link href="/(auth)/business-sign-up" asChild>
                <Pressable style={styles.textLinkWrap}>
                  <Text style={styles.textLink}>Already setting up a network? Enterprise signup →</Text>
                </Pressable>
              </Link>
            </View>
            <View style={styles.dashCard}>
              <View style={styles.dashAccent} />
              <Text style={styles.dashTitle}>Network snapshot</Text>
              <DashRow label="Active riders" value="2,340" />
              <DashRow label="CO₂ saved this month" value="12.4 t" />
              <DashRow label="Rides completed" value="8,920" />
              <Text style={styles.dashNote}>Illustrative preview — your dashboard when you launch.</Text>
            </View>
          </View>
        </View>

        {/* —— Final CTA: A closing band —— */}
        <LinearGradient
          colors={[Landing.forestDeep, Landing.forestInk]}
          style={[styles.finalBand, { paddingHorizontal: contentPad }]}
        >
          <Text style={styles.finalTitle}>
            Your commute is already shared. You&apos;re just not using it yet.
          </Text>
          <Text style={styles.finalSub}>
            Be among the first to experience smarter commuting with Poolyn.
          </Text>
          <Pressable
            style={styles.finalCta}
            onPress={() => openWaitlist()}
          >
            <Text style={styles.finalCtaText}>Join the waitlist</Text>
          </Pressable>
        </LinearGradient>

        <View style={[styles.footer, { paddingHorizontal: contentPad }]}>
          <Text style={styles.footerMuted}>
            Launching in Melbourne first. Individuals explore free · Team plans from $49/mo.
          </Text>
          <View style={styles.footerRow}>
            <Link href="/(public)/terms" asChild>
              <Pressable><Text style={styles.footerLink}>Privacy & Terms</Text></Pressable>
            </Link>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => Linking.openURL("mailto:hello@poolyn.com")}>
              <Text style={styles.footerLink}>hello@poolyn.com</Text>
            </Pressable>
          </View>
          <Text style={styles.footerTag}>Poolyn — smarter commuting for modern teams.</Text>
        </View>
      </ScrollView>

      <WaitlistModal
        visible={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        defaultIntent={waitlistIntent}
      />
    </>
  );
}

function Metric({ num, label }: { num: string; label: string }) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricNum}>{num}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StepConnector({ show }: { show: boolean }) {
  if (!show) return null;
  return <View style={styles.stepLine} />;
}

function Step({
  n,
  title,
  body,
  icon,
}: {
  n: string;
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIconSlot}>
        <LandingIcon name={icon} size={26} box={72} tone="surface" rounded="pill" />
      </View>
      <Text style={styles.stepN}>{n}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

function FeatureCard({
  highlight,
  icon,
  title,
  body,
}: {
  highlight?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={[styles.featCard, highlight && styles.featCardHi]}>
      <View style={styles.featIconSlot}>
        <LandingIcon
          name={icon}
          size={22}
          box={48}
          tone={highlight ? "onForest" : "surfaceOutline"}
          rounded="tile"
        />
      </View>
      <Text style={[styles.featTitle, highlight && styles.featTitleHi]}>{title}</Text>
      <Text style={[styles.featBody, highlight && styles.featBodyHi]}>{body}</Text>
    </View>
  );
}

function DiffCard({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.diffCard}>
      <View style={styles.diffIconSlot}>
        <LandingIcon name={icon} size={22} box={48} tone="surfaceOutline" rounded="tile" />
      </View>
      <Text style={styles.diffTitle}>{title}</Text>
      <Text style={styles.diffBody}>{body}</Text>
    </View>
  );
}

function OutcomeCard({
  icon,
  stat,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  stat: string;
  text: string;
}) {
  return (
    <View style={styles.outcomeCard}>
      <View style={styles.outcomeIconSlot}>
        <LandingIcon name={icon} size={22} box={52} tone="surfaceOutline" rounded="pill" />
      </View>
      <Text style={styles.outcomeStat}>{stat}</Text>
      <Text style={styles.outcomeText}>{text}</Text>
    </View>
  );
}

function ImpactItem({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.impactCard}>
      <View style={styles.impactIconSlot}>
        <LandingIcon name={icon} size={20} box={42} tone="onDark" rounded="tile" />
      </View>
      <Text style={styles.impactCardTitle}>{title}</Text>
      <Text style={styles.impactCardBody}>{body}</Text>
    </View>
  );
}

function CommMini({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.commMini}>
      <LandingIcon name={icon} size={20} box={40} tone="surfaceOutline" rounded="tile" />
      <View style={{ flex: 1 }}>
        <Text style={styles.commMiniTitle}>{title}</Text>
        <Text style={styles.commMiniBody}>{body}</Text>
      </View>
    </View>
  );
}

function TriCol({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.triCol}>
      <View style={styles.triIconSlot}>
        <LandingIcon name={icon} size={24} box={56} tone="surface" rounded="pill" />
      </View>
      <Text style={styles.triTitle}>{title}</Text>
      <Text style={styles.triBody}>{body}</Text>
    </View>
  );
}

function OrgBullet({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.orgBullet}>
      <LandingIcon name={icon} size={20} box={44} tone="surfaceOutline" rounded="tile" />
      <View style={{ flex: 1 }}>
        <Text style={styles.orgBulletTitle}>{title}</Text>
        <Text style={styles.orgBulletBody}>{body}</Text>
      </View>
    </View>
  );
}

function DashRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dashRow}>
      <Text style={styles.dashLabel}>{label}</Text>
      <Text style={styles.dashValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Landing.pageBg },
  pageContent: { paddingBottom: Spacing["5xl"] },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    backgroundColor: Landing.navBg,
    borderBottomWidth: 1,
    borderBottomColor: Landing.navHairline,
    gap: Spacing.md,
    flexWrap: "wrap",
  },
  navLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Landing.forest,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xl,
    color: Landing.forest,
    letterSpacing: Platform.OS === "web" ? -0.45 : -0.2,
  },
  navMid: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
    flex: 1,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  navLink: {
    fontFamily: LandingFont.bodyMedium,
    fontSize: FontSize.sm,
    color: Landing.muted,
  },
  navLinkMuted: {
    fontFamily: LandingFont.bodyMedium,
    fontSize: FontSize.sm,
    color: Landing.subtle,
  },
  navRight: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  navCta: {
    backgroundColor: Landing.teal,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: BorderRadius.full,
    ...Platform.select({
      web: { boxShadow: "0 6px 20px rgba(13, 148, 136, 0.28)" } as object,
      default: {},
    }),
  },
  navCtaText: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.sm,
    color: Landing.forestDeep,
  },

  heroWrap: { minHeight: 580 },
  heroBg: { minHeight: 580, width: "100%", justifyContent: "flex-end" },
  heroBgImage: { resizeMode: "cover" },
  heroInner: { paddingTop: 56, paddingBottom: 48 },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  badgeText: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.xs,
    color: Landing.white,
  },
  heroKicker: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealBright,
    fontSize: 11,
    letterSpacing: 1.45,
    textTransform: "uppercase",
    marginBottom: Spacing.md,
  },
  heroTitle: {
    fontFamily: LandingFont.displayBold,
    color: Landing.white,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: Platform.OS === "web" ? -1.1 : -0.3,
  },
  heroTitleAccent: { color: Landing.tealBright },
  heroSub: {
    fontFamily: LandingFont.body,
    color: "rgba(255,255,255,0.9)",
    fontSize: FontSize.lg,
    lineHeight: 28,
    marginTop: Spacing.lg,
    maxWidth: 560,
  },
  heroBtnRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
    marginTop: Spacing["2xl"],
  },
  heroPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Landing.teal,
    paddingHorizontal: 24,
    paddingVertical: 15,
    borderRadius: BorderRadius.lg,
    ...Platform.select({
      web: { boxShadow: "0 10px 28px rgba(13, 148, 136, 0.35)" } as object,
      default: {},
    }),
  },
  heroPrimaryText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.forestDeep,
    fontSize: FontSize.base,
  },
  heroGhost: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 24,
    paddingVertical: 15,
    borderRadius: BorderRadius.lg,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  heroGhostText: {
    fontFamily: LandingFont.bodySemi,
    color: Landing.white,
    fontSize: FontSize.base,
  },
  metrics: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing["4xl"],
    paddingTop: Spacing.xl,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
  },
  metricsStack: { flexDirection: "column", alignItems: "stretch" },
  metricCell: { flex: 1, alignItems: "center", paddingVertical: Spacing.md },
  metricNum: {
    fontFamily: LandingFont.displayBold,
    fontSize: 30,
    color: Landing.tealBright,
    letterSpacing: Platform.OS === "web" ? -0.6 : -0.2,
  },
  metricLabel: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: "rgba(255,255,255,0.78)",
    marginTop: 6,
    textAlign: "center",
    lineHeight: 20,
  },
  metricRule: { width: 1, height: 44, backgroundColor: "rgba(255,255,255,0.2)" },
  metricRuleH: { width: "60%", height: 1, alignSelf: "center" },

  sectionLight: { paddingVertical: 72, backgroundColor: Landing.white },
  sectionAlt: { paddingVertical: 72, backgroundColor: Landing.sectionAlt },
  eyebrow: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealDark,
    fontSize: 11,
    letterSpacing: 1.45,
    textTransform: "uppercase",
    marginBottom: Spacing.md,
  },
  eyebrowOnDark: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealOnDark,
    fontSize: 11,
    letterSpacing: 1.45,
    textTransform: "uppercase",
    marginBottom: Spacing.md,
  },
  sectionH1: {
    fontFamily: LandingFont.displayBold,
    fontSize: 32,
    lineHeight: 38,
    color: Landing.forest,
    marginBottom: Spacing.lg,
    letterSpacing: Platform.OS === "web" ? -0.7 : -0.2,
  },
  sectionH1Center: {
    fontFamily: LandingFont.displayBold,
    fontSize: 32,
    lineHeight: 38,
    color: Landing.forest,
    marginBottom: Spacing["3xl"],
    textAlign: "center",
    letterSpacing: Platform.OS === "web" ? -0.7 : -0.2,
  },
  sectionH1Accent: { color: Landing.tealDark },
  sectionLead: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.lg,
    color: Landing.muted,
    lineHeight: 28,
    marginBottom: Spacing["3xl"],
    maxWidth: 680,
  },

  stepsRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.xl },
  stepsCol: { flexDirection: "column", gap: Spacing["2xl"] },
  step: { flex: 1, alignItems: "center", paddingHorizontal: Spacing.xs },
  stepIconSlot: { marginBottom: Spacing.md },
  stepN: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealDark,
    fontSize: FontSize.sm,
    marginBottom: 6,
  },
  stepTitle: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.forest,
    fontSize: FontSize.base,
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 22,
  },
  stepBody: {
    fontFamily: LandingFont.body,
    color: Landing.muted,
    fontSize: FontSize.sm,
    textAlign: "center",
    lineHeight: 22,
  },
  stepLine: {
    width: 48,
    height: 2,
    backgroundColor: Landing.tealLine,
    marginTop: 56,
    borderRadius: 1,
    opacity: 0.85,
  },

  featIconSlot: { marginBottom: Spacing.md },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing["2xl"] },
  featCard: {
    width: Platform.OS === "web" ? "31%" : "100%",
    minWidth: Platform.OS === "web" ? 260 : undefined,
    flexGrow: 1,
    backgroundColor: Landing.white,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Landing.tealLine,
    ...Platform.select({
      web: {
        boxShadow: "0 12px 32px rgba(15, 61, 46, 0.07)",
      } as object,
      default: Shadow.md,
    }),
  },
  featCardHi: {
    backgroundColor: Landing.forest,
    borderColor: "rgba(255,255,255,0.2)",
    ...Platform.select({
      web: { boxShadow: "0 16px 40px rgba(10, 40, 34, 0.35)" } as object,
      default: {},
    }),
  },
  featTitle: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.base,
    color: Landing.forest,
    marginBottom: 8,
    lineHeight: 22,
  },
  featTitleHi: { color: Landing.white },
  featBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 22,
  },
  featBodyHi: { color: "rgba(255,255,255,0.88)" },

  diffGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing["2xl"] },
  diffCard: {
    width: Platform.OS === "web" ? "47%" : "100%",
    backgroundColor: Landing.white,
    borderRadius: BorderRadius.xl,
    padding: Spacing["2xl"],
    borderWidth: 1,
    borderColor: Landing.tealLine,
    ...Platform.select({
      web: { boxShadow: "0 16px 40px rgba(15, 61, 46, 0.08)" } as object,
      default: Shadow.md,
    }),
  },
  diffIconSlot: { marginBottom: Spacing.lg },
  diffTitle: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.lg,
    color: Landing.ink,
    marginBottom: Spacing.md,
    lineHeight: 26,
  },
  diffBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 24,
  },

  outcomeGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xl },
  outcomeCard: {
    width: Platform.OS === "web" ? "31%" : "100%",
    minWidth: Platform.OS === "web" ? 200 : undefined,
    flexGrow: 1,
    alignItems: "center",
    backgroundColor: Landing.white,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Landing.tealLine,
    ...Platform.select({
      web: { boxShadow: "0 8px 24px rgba(15, 61, 46, 0.06)" } as object,
      default: Shadow.sm,
    }),
  },
  outcomeIconSlot: { marginBottom: Spacing.md },
  outcomeStat: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xl,
    color: Landing.tealDark,
    letterSpacing: Platform.OS === "web" ? -0.45 : -0.15,
  },
  outcomeText: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 20,
  },

  impactBand: { paddingVertical: 72 },
  impactTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: 32,
    lineHeight: 38,
    color: Landing.white,
    marginBottom: Spacing.md,
    letterSpacing: Platform.OS === "web" ? -0.6 : -0.15,
  },
  impactTitleAccent: { color: Landing.tealBright },
  impactSub: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.lg,
    color: "rgba(220,240,232,0.92)",
    lineHeight: 28,
    marginBottom: Spacing["3xl"],
  },
  impactGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xl },
  impactCard: {
    width: Platform.OS === "web" ? "31%" : "100%",
    minWidth: Platform.OS === "web" ? 240 : undefined,
    flexGrow: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  impactIconSlot: { marginBottom: Spacing.md },
  impactCardTitle: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.base,
    color: Landing.white,
    marginBottom: 8,
    lineHeight: 22,
  },
  impactCardBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: "rgba(220,240,232,0.9)",
    lineHeight: 22,
  },

  commRow: { flexDirection: "row", gap: 48, alignItems: "stretch" },
  commCol: { flexDirection: "column", gap: Spacing["2xl"] },
  commCopy: { flex: 1 },
  commMiniGrid: { gap: Spacing.lg, marginTop: Spacing.xl },
  commMini: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "flex-start",
    backgroundColor: Landing.pageBg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  commMiniTitle: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.forest,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  commMiniBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    marginTop: 4,
    lineHeight: 22,
  },
  commArt: {
    flex: 1,
    minHeight: 320,
    borderRadius: BorderRadius.xl,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Landing.tealLine,
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
    ...Platform.select({
      web: { boxShadow: "0 20px 48px rgba(13, 148, 136, 0.12)" } as object,
      default: {},
    }),
  },
  commArtStack: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    flexWrap: "wrap",
    marginBottom: Spacing.sm,
  },
  commArtCar: { opacity: 0.88 },
  commArtCaption: {
    fontFamily: LandingFont.bodyMedium,
    marginTop: Spacing.md,
    color: Landing.forest,
    fontSize: FontSize.sm,
    letterSpacing: 0.15,
  },

  triRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 40,
    justifyContent: "space-between",
  },
  triCol: { flex: 1, minWidth: 220, alignItems: "center", paddingHorizontal: Spacing.md },
  triIconSlot: { marginBottom: Spacing.lg },
  triTitle: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.forest,
    fontSize: FontSize.base,
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 22,
  },
  triBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    textAlign: "center",
    lineHeight: 22,
  },

  orgRow: { flexDirection: "row", gap: 48, alignItems: "flex-start" },
  orgBullet: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
    alignItems: "flex-start",
  },
  orgBulletTitle: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.ink,
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  orgBulletBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    marginTop: 4,
    lineHeight: 22,
  },
  secondaryOutline: {
    alignSelf: "flex-start",
    marginTop: Spacing.md,
    borderWidth: 1.5,
    borderColor: Landing.tealDark,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    backgroundColor: "rgba(13, 148, 136, 0.06)",
  },
  secondaryOutlineText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealDark,
    fontSize: FontSize.base,
  },
  textLinkWrap: { marginTop: Spacing.lg },
  textLink: {
    fontFamily: LandingFont.bodySemi,
    color: Landing.tealDark,
    fontSize: FontSize.sm,
  },

  dashCard: {
    flex: 1,
    backgroundColor: Landing.white,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    paddingTop: 0,
    overflow: "hidden",
    maxWidth: 360,
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: Landing.tealLine,
    ...Platform.select({
      web: { boxShadow: "0 20px 50px rgba(15, 61, 46, 0.1)" } as object,
      default: Shadow.lg,
    }),
  },
  dashAccent: {
    height: 4,
    width: "100%",
    backgroundColor: Landing.teal,
    marginBottom: Spacing.lg,
  },
  dashTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.lg,
    color: Landing.ink,
    marginBottom: Spacing.lg,
    letterSpacing: Platform.OS === "web" ? -0.35 : -0.1,
  },
  dashRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  dashLabel: {
    fontFamily: LandingFont.body,
    color: Landing.muted,
    fontSize: FontSize.base,
  },
  dashValue: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealDark,
    fontSize: FontSize.base,
    letterSpacing: Platform.OS === "web" ? -0.3 : 0,
  },
  dashNote: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.subtle,
    marginTop: Spacing.lg,
    lineHeight: 18,
  },

  finalBand: {
    paddingVertical: 72,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  finalTitle: {
    fontFamily: LandingFont.displayBold,
    color: Landing.white,
    fontSize: 28,
    textAlign: "center",
    maxWidth: 640,
    lineHeight: 36,
    letterSpacing: Platform.OS === "web" ? -0.5 : -0.1,
  },
  finalSub: {
    fontFamily: LandingFont.body,
    color: "rgba(255,255,255,0.86)",
    fontSize: FontSize.lg,
    lineHeight: 28,
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  finalCta: {
    backgroundColor: Landing.teal,
    paddingHorizontal: 32,
    paddingVertical: 15,
    borderRadius: BorderRadius.lg,
    ...Platform.select({
      web: { boxShadow: "0 12px 32px rgba(13, 148, 136, 0.35)" } as object,
      default: {},
    }),
  },
  finalCtaText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.forestDeep,
    fontSize: FontSize.base,
  },

  footer: { paddingTop: Spacing["3xl"], paddingBottom: Spacing["4xl"], alignItems: "center" },
  footerMuted: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  footerLink: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.sm,
    color: Landing.tealDark,
  },
  footerDot: { color: Landing.subtle },
  footerTag: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.subtle,
  },
});
