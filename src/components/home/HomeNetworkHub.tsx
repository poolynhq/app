import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { HomeSupportContactBar } from "@/components/home/HomeSupportContactBar";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

function DefSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.defSection}>
      <Text style={styles.defTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DefPoint({ children }: { children: ReactNode }) {
  return (
    <View style={styles.defPointRow}>
      <Text style={styles.defBullet}>{"\u2022"}</Text>
      <Text style={styles.defPointText}>{children}</Text>
    </View>
  );
}

/**
 * Home help strip: short definitions of core actions, optional trust note, and in-app support contact.
 */
export function HomeNetworkHub() {
  const { profile } = useAuth();

  return (
    <View style={styles.wrap}>
      <Text style={styles.hubEyebrow}>HELP & DEFINITIONS</Text>
      <Text style={styles.hubSubline}>What each part of Poolyn does, and how to reach our team.</Text>
      <View style={styles.whyCard}>
        <Text style={styles.whyTitle}>How this fits together</Text>

        <DefSection title="YOUR POOLYN">
          <DefPoint>
            <Text style={styles.defPointInner}>
              <Text style={styles.whyBold}>Regular commute</Text>: saved home to work route, then Routine Poolyn (Crew
              or Mingle) on Home.
            </Text>
          </DefPoint>
          <DefPoint>
            <Text style={styles.defPointInner}>
              <Text style={styles.whyBold}>Ad-hoc trips</Text>: dated one-offs you list or join in{" "}
              <Text style={styles.whyBold}>My Rides</Text> (not the daily corridor map).
            </Text>
          </DefPoint>
        </DefSection>

        <DefSection title="Crew Poolyn">
          <DefPoint>Small standing group: invites or join code, crew chat, same people for {"today's"} trip.</DefPoint>
          <DefPoint>Example: four colleagues every Tuesday.</DefPoint>
        </DefSection>

        <DefSection title="Mingle Poolyn">
          <DefPoint>
            Corridor matching for your commute. Pick <Text style={styles.whyBold}>Driving</Text> or{" "}
            <Text style={styles.whyBold}>Riding</Text> for today.
          </DefPoint>
          <DefPoint>
            <Text style={styles.defPointInner}>
              <Text style={styles.whyBold}>Start Poolyn</Text> opens the live map.{" "}
              <Text style={styles.whyBold}>Post a pickup request</Text> when you need a lift (nearby drivers get a
              heads-up).
            </Text>
          </DefPoint>
        </DefSection>

        <DefSection title="My Rides">
          <DefPoint>Drivers post trips with time and seats; passengers book a seat.</DefPoint>
          <DefPoint>
            Ad-hoc and other listed trips live here; chat stays on that ride thread.
          </DefPoint>
        </DefSection>

        <DefSection title="Payments">
          <DefPoint>
            <Text style={styles.defPointInner}>
              <Text style={styles.whyBold}>Trip share</Text> plus any <Text style={styles.whyBold}>service fee</Text>{" "}
              that applies (often none on a workplace profile). Fair split when several riders share the car.
            </Text>
          </DefPoint>
          <DefPoint>
            <Text style={styles.defPointInner}>
              <Text style={styles.whyBold}>No Poolyn wallet</Text>: each charge is the calculated trip total. Stripe
              takes it from your card and pays the driver; we route the payment, not a stored cash balance you top up.
            </Text>
          </DefPoint>
          <DefPoint>
            <Text style={styles.defPointInner}>
              <Text style={styles.whyBold}>Listed trips</Text>: card per booking.{" "}
              <Text style={styles.whyBold}>Crew Poolyn</Text>: trip settlement balances (shares for that run, not a
              general prepaid wallet).
            </Text>
          </DefPoint>
        </DefSection>
      </View>

      <HomeSupportContactBar />

      {profile?.visibility_mode === "nearby" && (
        <View style={styles.trustNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={Colors.primary} />
          <Text style={styles.trustText}>
            Any commuter includes people along your corridor, not only your org. Trust scores still apply when you
            interact in My Rides.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  hubEyebrow: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  hubSubline: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  whyCard: {
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  whyTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  defSection: {
    marginBottom: Spacing.md,
  },
  defTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  defPointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginBottom: 5,
  },
  defBullet: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    lineHeight: 18,
    marginTop: 0,
  },
  defPointText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  defPointInner: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  whyBold: { fontWeight: FontWeight.semibold, color: Colors.text },
  trustNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  trustText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    lineHeight: 18,
  },
});
