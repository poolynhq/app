import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { BorderRadius, FontSize, Shadow, Spacing } from "@/constants/theme";
import { Landing } from "@/constants/landingTheme";
import { LandingFont } from "@/constants/landingTypography";
import {
  hasExitIntentShownInSession,
  hasWaitlistJoinedInSession,
  markExitIntentShownInSession,
} from "@/lib/waitlistSessionFlags";

const MIN_MS_ON_PAGE_BEFORE_EXIT = 3500;

const exitModalFavicon = require("../../../assets/landing-favicon-poolyn.png");

type Props = {
  /** While the main waitlist modal is open, do not show exit prompt. */
  waitlistModalOpen: boolean;
  /** Opens the main waitlist flow (same as hero CTAs). */
  onJoinWaitlist: () => void;
};

/**
 * Desktop web: when the cursor moves toward leaving the page (top of viewport) and the user
 * has not joined the waitlist this session, show a one-time prompt.
 */
export function WaitlistExitIntentModal({
  waitlistModalOpen,
  onJoinWaitlist,
}: Props) {
  const [visible, setVisible] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const glare = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (hasWaitlistJoinedInSession() || hasExitIntentShownInSession()) return;

    const started = Date.now();
    let done = false;

    const maybeShow = (e: MouseEvent) => {
      if (done || waitlistModalOpen) return;
      if (hasWaitlistJoinedInSession() || hasExitIntentShownInSession()) return;
      if (Date.now() - started < MIN_MS_ON_PAGE_BEFORE_EXIT) return;
      if (e.clientY > 0) return;

      done = true;
      markExitIntentShownInSession();
      setVisible(true);
    };

    document.documentElement.addEventListener("mouseleave", maybeShow);
    return () => document.documentElement.removeEventListener("mouseleave", maybeShow);
  }, [waitlistModalOpen]);

  useEffect(() => {
    if (!visible) {
      pulse.setValue(1);
      glare.setValue(0);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    const glareLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glare, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glare, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    glareLoop.start();
    return () => {
      pulseLoop.stop();
      glareLoop.stop();
    };
  }, [visible, pulse, glare]);

  function close() {
    setVisible(false);
  }

  function join() {
    setVisible(false);
    onJoinWaitlist();
  }

  const glareTranslate = glare.interpolate({
    inputRange: [0, 1],
    outputRange: [-56, 56],
  });

  if (Platform.OS !== "web") return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.kicker}>Before you go</Text>
            <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={Landing.muted} />
            </Pressable>
          </View>

          <View style={styles.iconBlock}>
            <Animated.View
              style={[
                styles.iconGlowRing,
                {
                  transform: [{ scale: pulse }],
                },
              ]}
            >
              <View style={styles.iconClip}>
                <Image
                  source={exitModalFavicon}
                  style={styles.iconImg}
                  resizeMode="contain"
                />
                <Animated.View
                  style={[
                    styles.glareStrip,
                    {
                      transform: [{ translateX: glareTranslate }],
                    },
                  ]}
                  pointerEvents="none"
                >
                  <LinearGradient
                    colors={[
                      "rgba(255,255,255,0)",
                      "rgba(255,255,255,0.55)",
                      "rgba(255,255,255,0)",
                    ]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                </Animated.View>
              </View>
            </Animated.View>
          </View>

          <Text style={styles.title}>Your route is filling up. Don&apos;t miss your spot.</Text>
          <Text style={styles.body}>
            Be the <Text style={styles.bodyEm}>first</Text> on your route. Reserve your spot with
            your work email so we can match you when your corridor goes live.
          </Text>
          <Text style={styles.body}>Takes under a minute. No spam, ever.</Text>
          <Pressable style={styles.primaryBtn} onPress={join}>
            <Text style={styles.primaryBtnText}>Claim my spot</Text>
            <Ionicons name="arrow-forward" size={18} color={Landing.white} />
          </Pressable>
          <Pressable onPress={close} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>No thanks</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ICON_BOX = 72;

const styles = StyleSheet.create({
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
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    ...Shadow.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  kicker: {
    fontFamily: LandingFont.bodySemi,
    fontSize: FontSize.xs,
    color: Landing.orange,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  iconBlock: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  iconGlowRing: {
    borderRadius: ICON_BOX / 2,
    padding: 3,
    backgroundColor: "rgba(11, 132, 87, 0.12)",
  },
  iconClip: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: ICON_BOX / 2,
    overflow: "hidden",
    backgroundColor: Landing.white,
  },
  iconImg: {
    width: ICON_BOX,
    height: ICON_BOX,
  },
  glareStrip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 36,
    opacity: 0.95,
  },
  title: {
    fontFamily: LandingFont.displayBold,
    fontSize: FontSize["2xl"],
    color: Landing.ink,
    letterSpacing: -0.4,
    marginBottom: Spacing.md,
    lineHeight: 30,
  },
  body: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.base,
    color: Landing.muted,
    lineHeight: 24,
    marginBottom: Spacing.md,
  },
  bodyEm: {
    fontFamily: LandingFont.bodySemi,
    color: Landing.forest,
  },
  primaryBtn: {
    marginTop: Spacing.md,
    backgroundColor: Landing.forest,
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    fontFamily: LandingFont.displaySemi,
    color: Landing.white,
    fontSize: FontSize.base,
  },
  secondaryBtn: {
    marginTop: Spacing.md,
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  secondaryBtnText: {
    fontFamily: LandingFont.body,
    fontSize: FontSize.sm,
    color: Landing.subtle,
  },
});
