import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (hasWaitlistJoinedInSession() || hasExitIntentShownInSession()) return;

    const started = Date.now();
    let done = false;

    const maybeShow = (e: MouseEvent) => {
      if (done || waitlistModalOpen) return;
      if (hasWaitlistJoinedInSession() || hasExitIntentShownInSession()) return;
      if (Date.now() - started < MIN_MS_ON_PAGE_BEFORE_EXIT) return;
      // Cursor left the viewport toward the top (tab bar / close) — classic exit intent.
      if (e.clientY > 0) return;

      done = true;
      markExitIntentShownInSession();
      setVisible(true);
    };

    document.documentElement.addEventListener("mouseleave", maybeShow);
    return () => document.documentElement.removeEventListener("mouseleave", maybeShow);
  }, [waitlistModalOpen]);

  function close() {
    setVisible(false);
  }

  function join() {
    setVisible(false);
    onJoinWaitlist();
  }

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
          <Text style={styles.title}>Reserve your spot for smarter commuting</Text>
          <Text style={styles.body}>
            Melbourne-area rollout is limited at first. Join the waitlist so we can reach you
            with early access — we&apos;re planning to release in{" "}
            <Text style={styles.bodyEm}>mid Q2 2026</Text>.
          </Text>
          <Text style={styles.body}>
            It takes under a minute. Work email only, and you can leave anytime.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={join}>
            <Text style={styles.primaryBtnText}>Join the waitlist</Text>
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
