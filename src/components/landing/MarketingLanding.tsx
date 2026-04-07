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
import {
  Landing,
  LandingGradients,
  LandingWebShadow,
  landingImpactPatternWeb,
} from "@/constants/landingTheme";
import { LandingFont } from "@/constants/landingTypography";
import { CommunityHubAnimation } from "@/components/landing/CommunityHubAnimation";
import { LandingIcon } from "@/components/landing/LandingIcon";
import { WaitlistExitIntentModal } from "@/components/landing/WaitlistExitIntentModal";
import { WaitlistModal } from "@/components/landing/WaitlistModal";
import { useAccountSignupBlockedOnWeb } from "@/lib/marketingWebRestrictions";
import type { WaitlistIntent } from "@/lib/waitlistSignup";

type SectionKey = "how" | "features" | "impact" | "community" | "orgs";

const heroBackground = require("../../../assets/hero-bg-poolyn.jpg");

export default function MarketingLanding() {
  const { width } = useWindowDimensions();
  const isWide = width >= 880;
  const isMedium = width >= 560;
  const scrollRef = useRef<ScrollView>(null);
  const [ys, setYs] = useState<Record<SectionKey, number>>({
    how: 0,
    features: 0,
    impact: 0,
    community: 0,
    orgs: 0,
  });
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistIntent, setWaitlistIntent] = useState<WaitlistIntent | undefined>(
    undefined
  );
  const signupBlockedOnWeb = useAccountSignupBlockedOnWeb();

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
  // Web: max-width column must be centered; otherwise it stays left with empty space on the right.
  const webContentLayout =
    Platform.OS === "web"
      ? isWide
        ? ({
            maxWidth: 1140,
            width: "100%",
            alignSelf: "center",
          } as const)
        : ({ width: "100%" } as const)
      : null;

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={[
          styles.pageContent,
          webContentLayout,
        ]}
      >
        {/* Hero (nav overlays image) */}
        <View style={styles.heroWrap}>
          <ImageBackground
            source={heroBackground}
            style={styles.heroBg}
            imageStyle={styles.heroBgImage}
          >
            <LinearGradient
              colors={LandingGradients.heroPhotoOverlay}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={[styles.heroNav, { paddingHorizontal: contentPad }]}>
              <View style={styles.navLeft}>
                <View style={styles.logoMark} accessibilityLabel="Poolyn">
                  <Ionicons name="leaf" size={18} color={Landing.white} />
                </View>
                <Text style={styles.logoOnHero}>Poolyn</Text>
              </View>
              {isMedium ? (
                <View style={styles.navMid}>
                  <Pressable onPress={() => jump("how")} hitSlop={6}>
                    <Text style={styles.navLinkOnHero}>How it works</Text>
                  </Pressable>
                  <Pressable onPress={() => jump("features")} hitSlop={6}>
                    <Text style={styles.navLinkOnHero}>Differentiators</Text>
                  </Pressable>
                  <Pressable onPress={() => jump("impact")} hitSlop={6}>
                    <Text style={styles.navLinkOnHero}>Impact</Text>
                  </Pressable>
                  <Pressable onPress={() => jump("community")} hitSlop={6}>
                    <Text style={styles.navLinkOnHero}>Community</Text>
                  </Pressable>
                  <Pressable onPress={() => jump("orgs")} hitSlop={6}>
                    <Text style={styles.navLinkOnHero}>Organizations</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.navRight}>
                <Link href="/(auth)/sign-in" asChild>
                  <Pressable hitSlop={6}>
                    <Text style={styles.navLinkMutedOnHero}>Sign in</Text>
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
            <View style={[styles.heroInner, { paddingHorizontal: contentPad }]}>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Ionicons name="shield-checkmark-outline" size={15} color={Landing.white} />
                  <Text style={styles.badgeText}>Verified professionals</Text>
                </View>
                <View style={styles.badge}>
                  <Ionicons name="leaf-outline" size={15} color={Landing.white} />
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
                schedules, cutting costs, congestion, and carbon. Aligned by
                route. Synced by schedule.
              </Text>
              <View style={styles.heroBtnRow}>
                <Pressable
                  style={styles.heroPrimary}
                  onPress={() => openWaitlist()}
                >
                  <Text style={styles.heroPrimaryText}>Join the waitlist</Text>
                  <Ionicons name="arrow-forward" size={18} color={Landing.onOrange} />
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

        {/* How it works */}
        <View
          onLayout={(e) => mark("how", e)}
          style={[styles.sectionLight, { paddingHorizontal: contentPad }]}
        >
          <Text style={[styles.eyebrow, styles.eyebrowCenter]}>How it works</Text>
          <Text style={[styles.sectionH1, styles.sectionH1CenterText]}>
            Four steps to a{" "}
            <Text style={styles.sectionH1Leaf}>smarter commute</Text>
          </Text>
          <View style={[styles.stepsRow, !isWide && styles.stepsCol]}>
            <Step
              n="01"
              title="Sign up with your work email"
              body="Verify your professional identity in seconds. Your company domain is your trust badge."
              icon="mail-outline"
            />
            <StepConnector show={isWide} />
            <Step
              n="02"
              title="Set your route & schedule"
              body="Tell us where you're headed and when. We'll match you with professionals on similar routes."
              icon="git-network-outline"
            />
            <StepConnector show={isWide} />
            <Step
              n="03"
              title="Ride or drive: your choice"
              body="Check real-time supply and demand. Choose to drive and earn credits, or ride and save."
              icon="car-outline"
            />
            <StepConnector show={isWide} />
            <Step
              n="04"
              title="Fair cost sharing, zero hassle"
              body="Our transparent calculator splits costs fairly. Drivers earn Poolyn Credits for future rides."
              icon="cash-outline"
            />
          </View>
        </View>

        {/* Core differentiators (feature grid) */}
        <View
          onLayout={(e) => mark("features", e)}
          style={[styles.sectionAlt, { paddingHorizontal: contentPad }]}
        >
          <Text style={[styles.eyebrow, styles.eyebrowCenter]}>
            Core differentiators
          </Text>
          <Text style={[styles.sectionH1, styles.sectionH1CenterText]}>
            Built for professionals.{" "}
            <Text style={styles.sectionH1Forest}>Designed for trust.</Text>
          </Text>
          <Text style={[styles.sectionLead, styles.sectionLeadCenter]}>
            Every feature is crafted to make carpooling safe, fair, and genuinely
            enjoyable.
          </Text>
          <View style={styles.featureGrid}>
            <FeatureCard
              icon="shield-checkmark-outline"
              title="Work email verification"
              body="Only verified professionals with corporate or university emails join your network."
            />
            <FeatureCard
              icon="business-outline"
              title="Organization networks"
              body="Private commuting groups for your company, or aligned other professionals on same route."
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
              body="Driving earns in-app Poolyn credits for future rides: flexible, not awkward."
            />
            <FeatureCard
              icon="happy-outline"
              title="Community & gamification"
              body="Icebreakers, shared music playlists, and light gamification that make rides human."
            />
          </View>
        </View>

        {/* Impact */}
        <View onLayout={(e) => mark("impact", e)}>
          <LinearGradient
            colors={LandingGradients.impactBand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.impactBand, { paddingHorizontal: contentPad }]}
          >
            {Platform.OS === "web" ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject, landingImpactPatternWeb]}
              />
            ) : null}
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
              <ImpactItem icon="construct-outline" title="Reduce vehicle wear" body="Split miles across your carpool; maintenance adds up." />
              <ImpactItem icon="globe-outline" title="Reduce environmental impact" body="Measurable CO₂ savings your team can report." />
              <ImpactItem icon="pin-outline" title="Reduce parking hassle" body="Less circling, less stress at the office." />
              <ImpactItem icon="cash-outline" title="Stop paying for empty seats" body="Fair, transparent splits, no awkward Venmo chains." />
            </View>
          </LinearGradient>
        </View>

        {/* Community */}
        <View
          onLayout={(e) => mark("community", e)}
          style={[styles.sectionLight, { paddingHorizontal: contentPad }]}
        >
          <View style={[styles.commRow, !isWide && styles.commCol]}>
            <View style={[styles.commCopy, !isWide && styles.commCopyNarrow]}>
              <Text style={styles.eyebrow}>Community</Text>
              <Text style={styles.sectionH1}>
                More than a ride.{" "}
                <Text style={styles.sectionH1Leaf}>A daily ritual.</Text>
              </Text>
              <Text style={styles.sectionLead}>
                Poolyn turns your commute into a social experience without forcing
                small talk.
              </Text>
              {isWide ? (
                <View style={styles.commMiniGrid}>
                  <CommMini icon="dice-outline" title="Roll the dice or spin the wheel" body="Multiple drivers? Let the app pick fairly." />
                  <CommMini icon="chatbubbles-outline" title="Talking points" body="Optional icebreakers for meaningful conversations." />
                  <CommMini icon="musical-notes-outline" title="Shared audio" body="Vote on playlists and podcasts together." />
                  <CommMini icon="game-controller-outline" title="Gamified rides" body="Badges and perks the more you ride together." />
                </View>
              ) : null}
            </View>
            <LinearGradient
              colors={LandingGradients.commArt}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.commArt, !isWide && styles.commArtStacked]}
            >
              <CommunityHubAnimation />
              <Text style={styles.commArtCaption}>Your carpool, elevated</Text>
            </LinearGradient>
            {!isWide ? (
              <View style={[styles.commMiniGrid, styles.commMiniGridBelowArt]}>
                <CommMini icon="dice-outline" title="Roll the dice or spin the wheel" body="Multiple drivers? Let the app pick fairly." />
                <CommMini icon="chatbubbles-outline" title="Talking points" body="Optional icebreakers for meaningful conversations." />
                <CommMini icon="musical-notes-outline" title="Shared audio" body="Vote on playlists and podcasts together." />
                <CommMini icon="game-controller-outline" title="Gamified rides" body="Badges and perks the more you ride together." />
              </View>
            ) : null}
          </View>
        </View>

        {/* Organizations */}
        <View
          onLayout={(e) => mark("orgs", e)}
          style={[styles.sectionAlt, { paddingHorizontal: contentPad }]}
        >
          <View style={[styles.orgRow, !isWide && styles.commCol]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>For organizations</Text>
              <Text style={[styles.sectionH1, styles.sectionH1ForestAll]}>
                Turn commuting into a company benefit
              </Text>
              <Text style={styles.sectionLead}>
                Reduce parking demand, boost morale, and hit sustainability targets
                with real commute data.
              </Text>
              <Text style={styles.orgPricingNote}>
                Team plans from $49/mo · individuals explore free
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
              {!signupBlockedOnWeb ? (
                <Link href="/(auth)/business-sign-up" asChild>
                  <Pressable style={styles.textLinkWrap}>
                    <Text style={styles.textLink}>
                      Already setting up a network? Enterprise signup →
                    </Text>
                  </Pressable>
                </Link>
              ) : (
                <Text style={styles.textLinkMuted}>
                  Enterprise onboarding opens with your invite — join the waitlist to hear first.
                </Text>
              )}
            </View>
            <View style={styles.dashCard}>
              <View style={styles.dashAccent} />
              <View style={styles.dashTitleRow}>
                <Text style={styles.dashTitle}>ESG commute snapshot</Text>
                <View style={styles.dashIllustrativePill}>
                  <Text style={styles.dashIllustrativePillText}>Sample</Text>
                </View>
              </View>
              <Text style={styles.dashSubtitle}>
                Preview signals teams use for CSR packs and GHG inventories
              </Text>
              <View style={styles.dashEsgIconRow}>
                <Ionicons name="leaf" size={17} color={Landing.tealDark} />
                <Ionicons name="analytics-outline" size={17} color={Landing.tealDark} />
                <Ionicons name="document-text-outline" size={17} color={Landing.tealDark} />
                <Text style={styles.dashEsgIconLabel}>Export · audit trail</Text>
              </View>
              <View style={styles.dashMiniChart}>
                <Text style={styles.dashMiniChartLabel}>
                  Scope 3 commute — avoided emissions (t CO₂e, MTD)
                </Text>
                <View style={styles.dashBars}>
                  {[16, 24, 20, 36, 32, 40].map((h, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dashBar,
                        { height: h, opacity: 0.35 + i * 0.1 },
                      ]}
                    />
                  ))}
                </View>
              </View>
              <DashRow label="Participation (pilot cohort)" value="68%" />
              <DashRow label="Single-occupancy trips replaced" value="3,420" />
              <DashRow label="Report alignment" value="GRI 305 · ISO 14064*" />
              <DashRow label="Data export" value="CSV · PDF summary" />
              <Text style={styles.dashNote}>
                *Illustrative labels for planning and ESG conversations — not live
                data.
              </Text>
            </View>
          </View>
        </View>

        {/* Final CTA */}
        <View style={[styles.finalBandLight, { paddingHorizontal: contentPad }]}>
          <Text style={styles.finalTitleLight}>
            Your commute is already shared. You&apos;re just not using it yet.
          </Text>
          <Text style={styles.finalSubLight}>
            Be among the first to experience smarter commuting with Poolyn.
          </Text>
          <Pressable
            style={styles.finalCtaSolid}
            onPress={() => openWaitlist()}
          >
            <Text style={styles.finalCtaSolidText}>Join the waitlist</Text>
            <Ionicons name="arrow-forward" size={18} color={Landing.white} />
          </Pressable>
        </View>

        <View style={[styles.footer, { paddingHorizontal: contentPad }]}>
          <Text style={styles.footerMuted}>
            Launching in Melbourne first.
          </Text>
          <View style={styles.footerQuickLinks}>
            <Pressable
              onPress={() =>
                scrollRef.current?.scrollTo({ y: 0, animated: true })
              }
              hitSlop={6}
            >
              <Text style={styles.footerLink}>Home</Text>
            </Pressable>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => jump("how")} hitSlop={6}>
              <Text style={styles.footerLink}>How it works</Text>
            </Pressable>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => jump("orgs")} hitSlop={6}>
              <Text style={styles.footerLink}>Organizations</Text>
            </Pressable>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => jump("impact")} hitSlop={6}>
              <Text style={styles.footerLink}>Impact</Text>
            </Pressable>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => openWaitlist()} hitSlop={6}>
              <Text style={styles.footerLink}>Waitlist</Text>
            </Pressable>
          </View>
          <View style={styles.footerSocialRow}>
            <Pressable
              accessibilityLabel="Poolyn on LinkedIn"
              onPress={() =>
                Linking.openURL("https://www.linkedin.com/company/poolyn")
              }
              hitSlop={8}
              style={styles.footerSocialHit}
            >
              <Ionicons
                name="logo-linkedin"
                size={24}
                color="rgba(255,255,255,0.88)"
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Poolyn on X"
              onPress={() => Linking.openURL("https://x.com/poolyn")}
              hitSlop={8}
              style={styles.footerSocialHit}
            >
              <Ionicons
                name="logo-twitter"
                size={22}
                color="rgba(255,255,255,0.88)"
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Poolyn on Instagram"
              onPress={() =>
                Linking.openURL("https://www.instagram.com/poolyn")
              }
              hitSlop={8}
              style={styles.footerSocialHit}
            >
              <Ionicons
                name="logo-instagram"
                size={24}
                color="rgba(255,255,255,0.88)"
              />
            </Pressable>
          </View>
          <View style={styles.footerRow}>
            <Link href="/(public)/terms" asChild>
              <Pressable hitSlop={6}>
                <Text style={styles.footerLink}>Privacy & Terms</Text>
              </Pressable>
            </Link>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={() => Linking.openURL("mailto:hello@poolyn.com")}>
              <Text style={styles.footerLink}>hello@poolyn.com</Text>
            </Pressable>
          </View>
          <Text style={styles.footerTag}>Poolyn · smarter commuting for modern teams.</Text>
        </View>
      </ScrollView>

      <WaitlistExitIntentModal
        waitlistModalOpen={waitlistOpen}
        onJoinWaitlist={() => {
          setWaitlistIntent(undefined);
          setWaitlistOpen(true);
        }}
      />
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
      <View style={styles.stepIconWrap}>
        <LandingIcon name={icon} size={26} box={72} tone="mintTile" rounded="tile" />
        <View style={styles.stepNumBadge} accessibilityLabel={`Step ${n}`}>
          <Text style={styles.stepNumBadgeText}>{n}</Text>
        </View>
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.featCard}>
      <View style={styles.featIconSlot}>
        <LandingIcon
          name={icon}
          size={22}
          box={48}
          tone="surfaceOutline"
          rounded="tile"
        />
      </View>
      <Text style={styles.featTitle}>{title}</Text>
      <Text style={styles.featBody}>{body}</Text>
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
      <Text style={styles.dashLabel} numberOfLines={3}>
        {label}
      </Text>
      <Text style={styles.dashValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: Landing.pageBg,
    ...Platform.select({
      web: { width: "100%", minHeight: "100%" } as object,
      default: {},
    }),
  },
  pageContent: { paddingBottom: Spacing["5xl"] },
  heroNav: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "web" ? 16 : 12,
    paddingBottom: 14,
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
  logoOnHero: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.xl,
    color: Landing.white,
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
  navLinkOnHero: {
    fontFamily: LandingFont.bodyMedium,
    fontSize: FontSize.sm,
    color: "rgba(255,255,255,0.88)",
  },
  navLinkMutedOnHero: {
    fontFamily: LandingFont.bodyMedium,
    fontSize: FontSize.sm,
    color: "rgba(255,255,255,0.72)",
  },
  navRight: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  navCta: {
    backgroundColor: Landing.forest,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: BorderRadius.full,
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.navCta } as object,
      default: {},
    }),
  },
  navCtaText: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.sm,
    color: Landing.white,
  },

  heroWrap: { minHeight: 580 },
  heroBg: { minHeight: 580, width: "100%", justifyContent: "flex-end" },
  heroBgImage: { resizeMode: "cover" },
  heroInner: { paddingTop: 96, paddingBottom: 48 },
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
    borderColor: "rgba(255,255,255,0.38)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  badgeText: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.xs,
    color: Landing.white,
  },
  heroKicker: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.orangeBright,
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
  heroTitleAccent: { color: Landing.orange },
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
    backgroundColor: Landing.orange,
    paddingHorizontal: 24,
    paddingVertical: 15,
    borderRadius: BorderRadius.full,
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.heroPrimary } as object,
      default: {},
    }),
  },
  heroPrimaryText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.onOrange,
    fontSize: FontSize.base,
  },
  heroGhost: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    paddingHorizontal: 24,
    paddingVertical: 15,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(0,0,0,0.18)",
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
    color: Landing.orange,
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
    color: Landing.orange,
    fontSize: 11,
    letterSpacing: 1.55,
    textTransform: "uppercase",
    marginBottom: Spacing.md,
  },
  eyebrowCenter: { alignSelf: "center", textAlign: "center" },
  eyebrowOnDark: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.orange,
    fontSize: 11,
    letterSpacing: 1.55,
    textTransform: "uppercase",
    marginBottom: Spacing.md,
    textAlign: "center",
    alignSelf: "center",
  },
  sectionH1: {
    fontFamily: LandingFont.displayBold,
    fontSize: 32,
    lineHeight: 38,
    color: Landing.ink,
    marginBottom: Spacing.lg,
    letterSpacing: Platform.OS === "web" ? -0.7 : -0.2,
  },
  sectionH1ForestAll: {
    color: Landing.forest,
  },
  sectionH1Forest: { color: Landing.forest },
  sectionH1Leaf: { color: Landing.leaf },
  sectionLead: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.lg,
    color: Landing.muted,
    lineHeight: 28,
    marginBottom: Spacing["3xl"],
    maxWidth: 680,
  },
  sectionH1CenterText: { textAlign: "center", alignSelf: "center" },
  sectionLeadCenter: { textAlign: "center", alignSelf: "center" },

  stepsRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.xl },
  stepsCol: { flexDirection: "column", gap: Spacing["2xl"] },
  step: { flex: 1, alignItems: "center", paddingHorizontal: Spacing.xs },
  stepIconWrap: {
    position: "relative",
    marginBottom: Spacing.lg,
  },
  stepNumBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Landing.orange,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Landing.white,
  },
  stepNumBadgeText: {
    fontFamily: LandingFont.displayBold,
    fontSize: 11,
    color: Landing.white,
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
        boxShadow: LandingWebShadow.cardSoft,
      } as object,
      default: Shadow.md,
    }),
  },
  featTitle: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.base,
    color: Landing.forest,
    marginBottom: 8,
    lineHeight: 22,
  },
  featBody: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 22,
  },
  impactBand: { paddingVertical: 72, position: "relative", overflow: "hidden" },
  impactTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: 32,
    lineHeight: 38,
    color: Landing.white,
    marginBottom: Spacing.md,
    letterSpacing: Platform.OS === "web" ? -0.6 : -0.15,
    textAlign: "center",
  },
  impactTitleAccent: { color: Landing.orange },
  impactSub: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.lg,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 28,
    marginBottom: Spacing["3xl"],
    textAlign: "center",
    maxWidth: 560,
    alignSelf: "center",
  },
  impactGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xl },
  impactCard: {
    width: Platform.OS === "web" ? "31%" : "100%",
    minWidth: Platform.OS === "web" ? 240 : undefined,
    flexGrow: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
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
    color: "rgba(230,240,235,0.82)",
    lineHeight: 22,
  },

  commRow: { flexDirection: "row", gap: 48, alignItems: "stretch" },
  commCol: { flexDirection: "column", gap: Spacing["2xl"] },
  commCopy: { flex: 1 },
  commCopyNarrow: { flex: 0, width: "100%", alignSelf: "stretch" },
  commMiniGrid: { gap: Spacing.lg, marginTop: Spacing.xl },
  commMiniGridBelowArt: { marginTop: 0, width: "100%" },
  commMini: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "flex-start",
    backgroundColor: Landing.mintSurface,
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
      web: { boxShadow: LandingWebShadow.commArt } as object,
      default: {},
    }),
  },
  commArtStacked: {
    flex: 0,
    flexGrow: 0,
    alignSelf: "stretch",
    width: "100%",
    minHeight: 300,
    maxHeight: 380,
  },
  commArtCaption: {
    fontFamily: LandingFont.bodyMedium,
    marginTop: Spacing.md,
    color: Landing.forest,
    fontSize: FontSize.sm,
    letterSpacing: 0.15,
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
    borderRadius: BorderRadius.xl,
    backgroundColor: Landing.outlineTint,
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
  textLinkMuted: {
    fontFamily: LandingFont.body,
    color: Landing.muted,
    fontSize: FontSize.sm,
    marginTop: Spacing.lg,
    lineHeight: 20,
  },
  orgPricingNote: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.sm,
    color: Landing.tealDark,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },

  dashCard: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: Landing.white,
    borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    paddingTop: 0,
    overflow: "hidden",
    maxWidth: 360,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: Landing.tealLine,
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.dashCard } as object,
      default: Shadow.lg,
    }),
  },
  dashAccent: {
    height: 4,
    width: "100%",
    backgroundColor: Landing.orange,
    marginBottom: Spacing.md,
  },
  dashTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
    flexWrap: "wrap",
  },
  dashTitle: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize.lg,
    color: Landing.ink,
    letterSpacing: Platform.OS === "web" ? -0.35 : -0.1,
    flexShrink: 1,
  },
  dashIllustrativePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.md,
    backgroundColor: Landing.outlineTint,
    borderWidth: 1,
    borderColor: Landing.tealLine,
  },
  dashIllustrativePillText: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.xs,
    color: Landing.tealDark,
    letterSpacing: 0.2,
    textTransform: "uppercase" as const,
  },
  dashSubtitle: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.muted,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  dashEsgIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    flexWrap: "wrap",
  },
  dashEsgIconLabel: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.xs,
    color: Landing.forest,
    marginLeft: Spacing.xs,
  },
  dashMiniChart: {
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  dashMiniChartLabel: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.xs,
    color: Landing.muted,
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  dashBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
    height: 44,
  },
  dashBar: {
    flex: 1,
    maxWidth: 14,
    borderRadius: 3,
    backgroundColor: Landing.tealDark,
  },
  dashRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  dashLabel: {
    flex: 1,
    fontFamily: LandingFont.body,
    color: Landing.muted,
    fontSize: FontSize.sm,
    marginRight: Spacing.sm,
  },
  dashValue: {
    flexShrink: 0,
    maxWidth: "46%",
    textAlign: "right" as const,
    fontFamily: LandingFont.displaySemi,
    color: Landing.tealDark,
    fontSize: FontSize.sm,
    letterSpacing: Platform.OS === "web" ? -0.3 : 0,
  },
  dashNote: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: Landing.subtle,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },

  finalBandLight: {
    paddingVertical: 72,
    alignItems: "center",
    backgroundColor: Landing.white,
    borderTopWidth: 1,
    borderTopColor: Landing.tealLine,
  },
  finalTitleLight: {
    fontFamily: LandingFont.displayBold,
    color: Landing.forest,
    fontSize: 28,
    textAlign: "center",
    maxWidth: 640,
    lineHeight: 36,
    letterSpacing: Platform.OS === "web" ? -0.5 : -0.1,
  },
  finalSubLight: {
    fontFamily: LandingFont.body,
    color: Landing.muted,
    fontSize: FontSize.lg,
    lineHeight: 28,
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing["2xl"],
    maxWidth: 520,
    paddingHorizontal: Spacing.md,
  },
  finalCtaSolid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Landing.forest,
    paddingHorizontal: 28,
    paddingVertical: 15,
    borderRadius: BorderRadius.lg,
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.finalCta } as object,
      default: {},
    }),
  },
  finalCtaSolidText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.white,
    fontSize: FontSize.base,
  },

  footer: {
    paddingTop: Spacing["3xl"],
    paddingBottom: Spacing["4xl"],
    alignItems: "center",
    backgroundColor: Landing.forestDeep,
  },
  footerMuted: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: "rgba(255,255,255,0.72)",
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  footerQuickLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  footerSocialRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  footerSocialHit: {
    padding: Spacing.sm,
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
    color: "rgba(255,255,255,0.88)",
  },
  footerDot: { color: "rgba(255,255,255,0.45)" },
  footerTag: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.xs,
    color: "rgba(255,255,255,0.55)",
  },
});
