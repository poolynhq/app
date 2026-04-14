import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
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
const poolynLogo = require("../../../assets/poolyn_logo.png");
const poolynFavicon = require("../../../assets/poolyn_favicon.png");

/** Wordmark width ÷ height (horizontal logo); keeps layout stable if asset is replaced. */
const POOLYN_LOGO_ASPECT = 3.2;

/** Centered content column on large screens (full-bleed backgrounds stay edge-to-edge). */
const LANDING_CONTENT_MAX = 1220;

/**
 * Landing layout knobs — change values here (this file only).
 *
 * Footer (car strip ↔ quick links):
 * - FOOTER_LAYOUT_SWEEP_BAND_PAD_V — padding above/below the moving car row inside the green band
 * - FOOTER_LAYOUT_INNER_PAD_TOP — space between that band and the “Home · How it works…” row
 *
 * Sections (HOW IT WORKS, etc.):
 * - SECTION_BLOCK_PAD_V — vertical padding for each white/mint block
 * - SECTION_EYEBROW_MARGIN_BOTTOM — gap under uppercase labels before the big heading
 *
 * Community (animation vs copy):
 * - COMMUNITY_SIDE_BY_SIDE_MIN_WIDTH — only at this width+ do copy + animation sit side-by-side; below = stacked (avoids overlap)
 */
const FOOTER_LAYOUT_SWEEP_BAND_PAD_V = 12;
const FOOTER_LAYOUT_INNER_PAD_TOP = 0;
const SECTION_BLOCK_PAD_V = 60;
const SECTION_EYEBROW_MARGIN_BOTTOM = 8;
const COMMUNITY_SIDE_BY_SIDE_MIN_WIDTH = 1200;

const FOOTER_SWEEP_ICON = 60;
const FOOTER_SWEEP_DURATION_MS = 17000;

function FooterFaviconSweep({
  sweepWidth,
  icon,
  onPress,
}: {
  /** Viewport (or window) width so the car travels edge-to-edge, not only the centered column. */
  sweepWidth: number;
  icon: ImageSourcePropType;
  onPress: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== "web";

  useEffect(() => {
    if (sweepWidth <= 0) return;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: FOOTER_SWEEP_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      progress.setValue(0);
    };
  }, [sweepWidth, progress, useNativeDriver]);

  const margin = FOOTER_SWEEP_ICON + 4;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-margin, sweepWidth + margin],
  });

  return (
    <Pressable
      onPress={onPress}
      style={styles.footerSweepOuter}
      accessibilityRole="button"
      accessibilityLabel="Poolyn, scroll to top"
    >
      <View style={styles.footerSweepTrack}>
        {sweepWidth > 0 ? (
          <Animated.View
            style={[
              styles.footerSweepSprite,
              { transform: [{ translateX }] },
            ]}
          >
            <Image
              source={icon}
              style={styles.footerFaviconImg}
              resizeMode="contain"
            />
          </Animated.View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function MarketingLanding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 880;
  const isMedium = width >= 560;
  /** Single-row hero nav: logo + hamburger + waitlist CTA (links + Sign in live in the menu). */
  const isNavCompact = !isMedium;
  /** Community side-by-side only when there is room; avoids squeezed/overlapping columns. */
  const isCommunityWide = width >= COMMUNITY_SIDE_BY_SIDE_MIN_WIDTH;
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
  const [heroMenuOpen, setHeroMenuOpen] = useState(false);
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

  function jumpFromHeroMenu(key: SectionKey) {
    setHeroMenuOpen(false);
    requestAnimationFrame(() => jump(key));
  }

  function openWaitlist(intent?: WaitlistIntent) {
    setWaitlistIntent(intent);
    setWaitlistOpen(true);
  }

  const contentPad = isWide ? 40 : 24;
  const layoutWidth =
    Platform.OS === "web" ? Math.min(width, LANDING_CONTENT_MAX) : width;

  const heroLogoSize = useMemo(() => {
    // Leave room for Sign in + CTA (and center links when wide) so the bar
    // doesn’t wrap into a tall block that overlaps the hero copy below.
    const reserveForNav = isWide
      ? 400
      : isNavCompact
        ? 168
        : isMedium
          ? 248
          : 200;
    const widthCap = isWide ? 220 : isNavCompact ? 132 : 168;
    const maxW = Math.max(
      96,
      Math.min(widthCap, layoutWidth - 2 * contentPad - reserveForNav)
    );
    const w = maxW;
    return { width: Math.round(w), height: Math.round(w / POOLYN_LOGO_ASPECT) };
  }, [layoutWidth, isWide, isMedium, contentPad]);

  /** Absolute nav doesn’t consume layout height; pad hero copy below wrapped nav. */
  const heroContentPadTop =
    Platform.OS === "web"
      ? isWide
        ? 120
        : isNavCompact
          ? 104
          : 172
      : isWide
        ? 132
        : isNavCompact
          ? 108
          : 184;

  // Web: full-width content (no narrow centered column).
  const webContentLayout =
    Platform.OS === "web" ? ({ width: "100%", alignSelf: "stretch" } as const) : null;

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.page}
        contentContainerStyle={[
          styles.pageContent,
          webContentLayout,
          Platform.OS === "web" && styles.pageContentWeb,
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
            <View style={styles.heroNavScrimWrap} pointerEvents="none">
              <LinearGradient
                colors={LandingGradients.heroNavScrim}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            </View>
            <View style={styles.heroNavOuter}>
              <View
                style={[
                  styles.landingShell,
                  styles.heroNavInner,
                  isNavCompact && styles.heroNavInnerCompact,
                  { paddingHorizontal: contentPad },
                ]}
              >
                <View style={styles.navLeft}>
                  <Pressable
                    onPress={() =>
                      scrollRef.current?.scrollTo({ y: 0, animated: true })
                    }
                    style={styles.logoHeroLockup}
                    accessibilityRole="button"
                    accessibilityLabel="Poolyn, scroll to top"
                    hitSlop={8}
                  >
                    <Image
                      source={poolynLogo}
                      style={[
                        styles.logoHeroImage,
                        {
                          width: heroLogoSize.width,
                          height: heroLogoSize.height,
                        },
                      ]}
                      resizeMode="contain"
                    />
                  </Pressable>
                </View>
                {isNavCompact ? <View style={styles.navCompactSpacer} /> : null}
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
                <View
                  style={[styles.navRight, isNavCompact && styles.navRightCompact]}
                >
                  {isNavCompact ? (
                    <>
                      <Pressable
                        style={[styles.navCta, styles.navCtaCompact]}
                        onPress={() => openWaitlist()}
                      >
                        <Text
                          style={[styles.navCtaText, styles.navCtaTextCompact]}
                          numberOfLines={1}
                        >
                          Join the waitlist
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setHeroMenuOpen(true)}
                        style={styles.navHamburger}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Open menu"
                        accessibilityState={{ expanded: heroMenuOpen }}
                      >
                        <Ionicons
                          name="menu"
                          size={28}
                          color="rgba(255,255,255,0.94)"
                        />
                      </Pressable>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </View>
              </View>
            </View>
            <View style={styles.heroMainStretch}>
              <View
                style={[
                  styles.landingShell,
                  styles.heroInner,
                  {
                    paddingHorizontal: contentPad,
                    paddingTop: heroContentPadTop,
                  },
                ]}
              >
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
                <Text
                  style={[
                    styles.heroTitle,
                    isWide && Platform.OS === "web" && styles.heroTitleLgWeb,
                  ]}
                >
                  Stop driving alone.{"\n"}
                  <Text style={styles.heroTitleAccent}>Start commuting smarter.</Text>
                </Text>
                <Text
                  style={[
                    styles.heroSub,
                    isWide && Platform.OS === "web" && styles.heroSubLgWeb,
                  ]}
                >
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
            </View>
          </ImageBackground>
        </View>

        {/* How it works */}
        <View onLayout={(e) => mark("how", e)} style={styles.sectionBleedWhite}>
          <View
            style={[
              styles.landingShell,
              styles.sectionPadV,
              { paddingHorizontal: contentPad },
            ]}
          >
          <Text style={[styles.eyebrow, styles.eyebrowCenter]}>How it works</Text>
          <Text style={[styles.sectionH1, styles.sectionH1CenterText]}>
            Four steps to a{" "}
            <Text style={styles.sectionH1Leaf}>smarter commute</Text>
          </Text>
          <View style={[styles.stepsRow, !isWide && styles.stepsCol, styles.stepsBelowHead]}>
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
              body="Our transparent calculator splits costs fairly. Drivers recover costs fairly; riders pay their share."
              icon="cash-outline"
            />
          </View>
          </View>
        </View>

        {/* Core differentiators (feature grid) */}
        <View onLayout={(e) => mark("features", e)} style={styles.sectionBleedAlt}>
          <View
            style={[
              styles.landingShell,
              styles.sectionPadV,
              { paddingHorizontal: contentPad },
            ]}
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
        </View>

        {/* Impact */}
        <View onLayout={(e) => mark("impact", e)}>
          <LinearGradient
            colors={LandingGradients.impactBand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.impactBandBleed}
          >
            {Platform.OS === "web" ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject, landingImpactPatternWeb]}
              />
            ) : null}
            <View
              style={[
                styles.landingShell,
                styles.sectionPadV,
                { paddingHorizontal: contentPad },
              ]}
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
              <ImpactItem
                title="Reduce road congestion"
                body="Fewer single-occupancy vehicles on peak corridors."
                iconNode={<ImpactCongestionIcon />}
              />
              <ImpactItem icon="flame-outline" title="Reduce fuel costs" body="Share fuel expenses instead of absorbing them alone." />
              <ImpactItem icon="construct-outline" title="Reduce vehicle wear" body="Split miles across your carpool; maintenance adds up." />
              <ImpactItem
                title="Reduce environmental impact"
                body="Measurable CO₂ savings your team can report."
                iconNode={<ImpactLeafIcon />}
              />
              <ImpactItem
                title="Reduce parking hassle"
                body="Less circling, less stress at the office."
                iconNode={<ImpactParkingPIcon />}
              />
              <ImpactItem icon="cash-outline" title="Stop paying for empty seats" body="Fair, transparent splits, no awkward Venmo chains." />
            </View>
            </View>
          </LinearGradient>
        </View>

        {/* Community */}
        <View onLayout={(e) => mark("community", e)} style={styles.sectionBleedWhite}>
          <View
            style={[
              styles.landingShell,
              styles.sectionPadV,
              { paddingHorizontal: contentPad },
            ]}
          >
            {isCommunityWide ? (
              <View style={styles.commRow}>
                <View style={styles.commCopy}>
                  <Text style={styles.eyebrow}>Community</Text>
                  <Text style={styles.sectionH1}>
                    More than a ride.{" "}
                    <Text style={styles.sectionH1Leaf}>A daily ritual.</Text>
                  </Text>
                  <Text style={styles.sectionLead}>
                    Poolyn turns your commute into a social experience without forcing
                    small talk.
                  </Text>
                  <View style={styles.commMiniGrid}>
                    <CommMini icon="dice-outline" title="Roll the dice or spin the wheel" body="Multiple drivers? Let the app pick fairly." />
                    <CommMini icon="chatbubbles-outline" title="Talking points" body="Optional icebreakers for meaningful conversations." />
                    <CommMini icon="musical-notes-outline" title="Shared audio" body="Vote on playlists and podcasts together." />
                    <CommMini icon="game-controller-outline" title="Gamified rides" body="Badges and perks the more you ride together." />
                  </View>
                </View>
                <LinearGradient
                  colors={LandingGradients.commArt}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.commArt}
                >
                  <CommunityHubAnimation layoutMode="fill" />
                  <Text style={styles.commArtCaption}>Your carpool, elevated</Text>
                </LinearGradient>
              </View>
            ) : (
              <>
                <LinearGradient
                  colors={LandingGradients.commArt}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.commStackedCard}
                >
                  <View style={styles.commStackedCopy}>
                    <Text style={styles.eyebrow}>Community</Text>
                    <Text style={styles.sectionH1}>
                      More than a ride.{" "}
                      <Text style={styles.sectionH1Leaf}>A daily ritual.</Text>
                    </Text>
                    <Text style={[styles.sectionLead, styles.commStackedLead]}>
                      Poolyn turns your commute into a social experience without
                      forcing small talk.
                    </Text>
                  </View>
                  <View style={styles.commStackedArtSlot}>
                    <CommunityHubAnimation layoutMode="stacked" />
                    <Text style={styles.commArtCaptionStacked}>
                      Your carpool, elevated
                    </Text>
                  </View>
                </LinearGradient>
                <View style={[styles.commMiniGrid, styles.commMiniGridBelowArt]}>
                  <CommMini icon="dice-outline" title="Roll the dice or spin the wheel" body="Multiple drivers? Let the app pick fairly." />
                  <CommMini icon="chatbubbles-outline" title="Talking points" body="Optional icebreakers for meaningful conversations." />
                  <CommMini icon="musical-notes-outline" title="Shared audio" body="Vote on playlists and podcasts together." />
                  <CommMini icon="game-controller-outline" title="Gamified rides" body="Badges and perks the more you ride together." />
                </View>
              </>
            )}
          </View>
        </View>

        {/* Organizations */}
        <View onLayout={(e) => mark("orgs", e)} style={styles.sectionBleedAlt}>
          <View
            style={[
              styles.landingShell,
              styles.sectionPadV,
              { paddingHorizontal: contentPad },
            ]}
          >
          <View
            style={[
              styles.orgRow,
              !isWide && styles.commCol,
              !isWide && styles.orgColNarrow,
            ]}
          >
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
            <View
              style={[
                styles.orgDashWrap,
                !isWide && styles.orgDashWrapStacked,
              ]}
            >
            <View
              style={[
                styles.dashCard,
                !isWide && styles.dashCardNarrow,
              ]}
            >
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
          </View>
        </View>

        {/* Final CTA */}
        <View style={styles.finalBleed}>
          <View
            style={[
              styles.landingShell,
              styles.finalBandInner,
              { paddingHorizontal: contentPad },
            ]}
          >
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
        </View>

        <View style={styles.footerBleed}>
          <View style={styles.footerSweepBand}>
            <FooterFaviconSweep
              sweepWidth={width}
              icon={poolynFavicon}
              onPress={() =>
                scrollRef.current?.scrollTo({ y: 0, animated: true })
              }
            />
          </View>
          <View
            style={[
              styles.landingShell,
              styles.footerInner,
              { paddingHorizontal: contentPad },
            ]}
          >
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
          <Text style={styles.footerCopyright}>
            © {new Date().getFullYear()} Poolyn. All rights reserved.
          </Text>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={heroMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHeroMenuOpen(false)}
      >
        <View style={styles.heroMenuRoot}>
          <Pressable
            style={styles.heroMenuBackdrop}
            onPress={() => setHeroMenuOpen(false)}
            accessibilityLabel="Dismiss menu"
          />
          <View style={styles.heroMenuSheet}>
            <View style={styles.heroMenuHeader}>
              <Text style={styles.heroMenuTitle}>Menu</Text>
              <Pressable
                onPress={() => setHeroMenuOpen(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
              >
                <Ionicons name="close" size={26} color={Landing.ink} />
              </Pressable>
            </View>
            <Pressable
              style={styles.heroMenuRow}
              onPress={() => jumpFromHeroMenu("how")}
            >
              <Text style={styles.heroMenuLink}>How it works</Text>
            </Pressable>
            <Pressable
              style={styles.heroMenuRow}
              onPress={() => jumpFromHeroMenu("features")}
            >
              <Text style={styles.heroMenuLink}>Differentiators</Text>
            </Pressable>
            <Pressable
              style={styles.heroMenuRow}
              onPress={() => jumpFromHeroMenu("impact")}
            >
              <Text style={styles.heroMenuLink}>Impact</Text>
            </Pressable>
            <Pressable
              style={styles.heroMenuRow}
              onPress={() => jumpFromHeroMenu("community")}
            >
              <Text style={styles.heroMenuLink}>Community</Text>
            </Pressable>
            <Pressable
              style={styles.heroMenuRow}
              onPress={() => jumpFromHeroMenu("orgs")}
            >
              <Text style={styles.heroMenuLink}>Organizations</Text>
            </Pressable>
            <View style={styles.heroMenuDivider} />
            <Pressable
              style={styles.heroMenuRow}
              onPress={() => {
                setHeroMenuOpen(false);
                router.push("/(auth)/sign-in");
              }}
            >
              <Text style={styles.heroMenuLink}>Sign in</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

/** Matches {@link LandingIcon} `onDark` tile for custom impact glyphs. */
function ImpactIconTile({ children }: { children: ReactNode }) {
  const box = 42;
  const radius = Math.min(14, box * 0.28);
  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: radius,
        backgroundColor: Landing.onDarkFill,
        borderWidth: 1,
        borderColor: Landing.onDarkBorder,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

function ImpactParkingPIcon() {
  return (
    <ImpactIconTile>
      <Text
        style={{
          fontFamily: LandingFont.displayBold,
          fontSize: 22,
          color: Landing.orange,
          marginTop: -2,
          letterSpacing: -1,
        }}
        accessibilityLabel="Parking, letter P"
      >
        P
      </Text>
    </ImpactIconTile>
  );
}

function ImpactLeafIcon() {
  return (
    <ImpactIconTile>
      <View accessibilityLabel="Environmental impact, leaf">
        <Ionicons name="leaf" size={22} color="#34D399" />
      </View>
    </ImpactIconTile>
  );
}

function ImpactCongestionIcon() {
  return (
    <ImpactIconTile>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
        }}
        accessibilityLabel="Multiple vehicles"
      >
        <Ionicons name="car-outline" size={13} color={Landing.orange} style={{ marginRight: -7 }} />
        <Ionicons name="car-outline" size={15} color={Landing.orange} style={{ marginRight: -7, zIndex: 1 }} />
        <Ionicons name="car-outline" size={13} color={Landing.orange} />
      </View>
    </ImpactIconTile>
  );
}

function ImpactItem({
  icon,
  iconNode,
  title,
  body,
}: {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconNode?: ReactNode;
}) {
  return (
    <View style={styles.impactCard}>
      <View style={styles.impactIconSlot}>
        {iconNode ?? (
          <LandingIcon name={icon!} size={20} box={42} tone="onDark" rounded="tile" />
        )}
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
  /**
   * Web: drop extra ScrollView padding below the footer, and let the content column fill at least
   * the viewport so any “shortfall” under the footer picks up the same forest tone as the footer.
   */
  pageContentWeb: {
    paddingBottom: 0,
    flexGrow: 1,
    backgroundColor: Landing.forestDeep,
  },
  landingShell: {
    width: "100%",
    ...Platform.select({
      web: {
        maxWidth: LANDING_CONTENT_MAX,
        alignSelf: "center",
      } as object,
      default: {},
    }),
  },
  sectionBleedWhite: {
    width: "100%",
    backgroundColor: Landing.white,
  },
  sectionBleedAlt: {
    width: "100%",
    backgroundColor: Landing.sectionAlt,
  },
  sectionPadV: { paddingVertical: SECTION_BLOCK_PAD_V },
  heroNavScrimWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 132,
    zIndex: 1,
  },
  heroNavOuter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    width: "100%",
    alignItems: "center",
  },
  heroNavInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "web" ? 16 : 12,
    paddingBottom: 14,
    gap: Spacing.md,
    flexWrap: "wrap",
  },
  heroNavInnerCompact: {
    flexWrap: "nowrap",
    alignItems: "center",
  },
  heroMainStretch: {
    width: "100%",
    alignItems: "center",
  },
  navLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  /** Pushes compact actions (waitlist + hamburger) flush right without growing the logo row. */
  navCompactSpacer: { flex: 1, minWidth: 0 },
  logoHeroLockup: {
    justifyContent: "center",
    alignItems: "flex-start",
    flexShrink: 0,
    maxWidth: "100%",
  },
  logoHeroImage: {
    ...Platform.select({
      web: {
        maxWidth: "100%",
      } as object,
      default: {},
    }),
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
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.lg,
    color: "rgba(255,255,255,0.94)",
  },
  navLinkMutedOnHero: {
    fontFamily: LandingFont.bodyMedium,
    fontSize: FontSize.base,
    color: "rgba(255,255,255,0.82)",
  },
  navRight: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  navRightCompact: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  navHamburger: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  navCtaCompact: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 200,
  },
  navCtaTextCompact: {
    fontSize: FontSize.sm,
  },
  heroMenuRoot: {
    flex: 1,
    justifyContent: "flex-start",
  },
  heroMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 22, 16, 0.48)",
  },
  heroMenuSheet: {
    width: "100%",
    backgroundColor: Landing.white,
    paddingBottom: Spacing["3xl"],
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
    ...Platform.select({
      web: {
        boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
      } as object,
      default: {
        elevation: 8,
      },
    }),
  },
  heroMenuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing.lg,
  },
  heroMenuTitle: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.xl,
    color: Landing.ink,
  },
  heroMenuRow: {
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.xl,
  },
  heroMenuLink: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.lg,
    color: Landing.forest,
  },
  heroMenuDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.sm,
    marginHorizontal: Spacing.xl,
  },
  navCta: {
    backgroundColor: Landing.forest,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: BorderRadius.full,
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.navCta } as object,
      default: {},
    }),
  },
  navCtaText: {
    fontFamily: LandingFont.displaySemi,
    fontSize: FontSize.base,
    color: Landing.white,
  },

  heroWrap: { minHeight: 580 },
  heroBg: { minHeight: 580, width: "100%", justifyContent: "flex-end" },
  heroBgImage: { resizeMode: "cover" },
  heroInner: { paddingBottom: 48 },
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
    fontFamily: LandingFont.displayBold,
    color: Landing.orange,
    fontSize: FontSize.sm,
    letterSpacing: 1.55,
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
  heroTitleLgWeb: {
    fontSize: 48,
    lineHeight: 54,
    letterSpacing: -1.15,
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
  heroSubLgWeb: {
    fontSize: FontSize.xl,
    lineHeight: 30,
    maxWidth: 620,
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

  eyebrow: {
    fontFamily: LandingFont.displayBold,
    color: Landing.orange,
    fontSize: FontSize.lg,
    letterSpacing: 1.65,
    textTransform: "uppercase",
    marginBottom: SECTION_EYEBROW_MARGIN_BOTTOM,
  },
  eyebrowCenter: { alignSelf: "center", textAlign: "center" },
  eyebrowOnDark: {
    fontFamily: LandingFont.displayBold,
    color: Landing.orangeBright,
    fontSize: FontSize.lg,
    letterSpacing: 1.65,
    textTransform: "uppercase",
    marginBottom: SECTION_EYEBROW_MARGIN_BOTTOM,
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
  stepsBelowHead: { marginTop: Spacing["3xl"] },
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
  impactBandBleed: {
    width: "100%",
    position: "relative",
    overflow: "hidden",
  },
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

  commRow: { flexDirection: "row", gap: 40, alignItems: "stretch" },
  commCol: { flexDirection: "column", gap: Spacing["2xl"] },
  commCopy: { flex: 1 },
  /** Narrow: one mint card — copy block, then a fixed-height slot so the hub never overlaps headings. */
  commStackedCard: {
    width: "100%",
    alignSelf: "stretch",
    flexDirection: "column",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Landing.tealLine,
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.commArt } as object,
      default: {},
    }),
  },
  commStackedCopy: {
    width: "100%",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    flexGrow: 0,
    flexShrink: 0,
  },
  commStackedLead: {
    marginBottom: 0,
  },
  commStackedArtSlot: {
    width: "100%",
    height: 292,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
    flexGrow: 0,
    flexShrink: 0,
  },
  commMiniGrid: { gap: Spacing.lg, marginTop: Spacing.xl },
  commMiniGridBelowArt: { marginTop: Spacing["2xl"], width: "100%" },
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
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.commArt } as object,
      default: {},
    }),
  },
  commArtCaption: {
    fontFamily: LandingFont.bodyMedium,
    marginTop: Spacing.md,
    color: Landing.forest,
    fontSize: FontSize.sm,
    letterSpacing: 0.15,
  },
  commArtCaptionStacked: {
    fontFamily: LandingFont.bodyMedium,
    marginTop: Spacing.sm,
    color: Landing.forest,
    fontSize: FontSize.sm,
    letterSpacing: 0.15,
    textAlign: "center",
  },

  orgRow: { flexDirection: "row", gap: 40, alignItems: "center" },
  orgColNarrow: { alignItems: "stretch" },
  orgDashWrap: {
    justifyContent: "center",
    alignSelf: "stretch",
    flexShrink: 0,
    paddingTop: Spacing.sm,
  },
  orgDashWrapStacked: {
    paddingTop: 0,
    alignItems: "center",
    width: "100%",
  },
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
    borderWidth: 1,
    borderColor: Landing.tealLine,
    ...Platform.select({
      web: { boxShadow: LandingWebShadow.dashCard } as object,
      default: Shadow.lg,
    }),
  },
  dashCardNarrow: { alignSelf: "center" },
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

  finalBleed: {
    width: "100%",
    backgroundColor: Landing.white,
    borderTopWidth: 1,
    borderTopColor: Landing.tealLine,
  },
  finalBandInner: {
    paddingVertical: SECTION_BLOCK_PAD_V,
    alignItems: "center",
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

  footerBleed: {
    width: "100%",
    backgroundColor: Landing.forestDeep,
  },
  footerInner: {
    paddingTop: FOOTER_LAYOUT_INNER_PAD_TOP,
    paddingBottom: Spacing["3xl"],
    alignItems: "center",
  },
  /** Tight band: car + track vertically centered between footer top and quick links. */
  footerSweepBand: {
    width: "100%",
    paddingVertical: FOOTER_LAYOUT_SWEEP_BAND_PAD_V,
    justifyContent: "center",
    alignItems: "stretch",
  },
  footerSweepOuter: {
    width: "100%",
    alignSelf: "stretch",
    justifyContent: "center",
  },
  footerSweepTrack: {
    height: FOOTER_SWEEP_ICON + 8,
    width: "100%",
    overflow: "hidden",
    position: "relative",
    alignSelf: "center",
  },
  footerSweepSprite: {
    position: "absolute",
    left: 0,
    top: 6,
  },
  footerFaviconImg: {
    width: FOOTER_SWEEP_ICON,
    height: FOOTER_SWEEP_ICON,
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
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  footerCopyright: {
    fontFamily: LandingFont.body,
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    textAlign: "center",
    marginTop: Spacing.xs,
    paddingBottom: Spacing.lg,
  },
});
