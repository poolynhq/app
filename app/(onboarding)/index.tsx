import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { UserRole } from "@/types/database";
import {
  RoleTheme,
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

// ── Role definitions ─────────────────────────────────────────────────────────

interface RoleDef {
  value: UserRole;
  title: string;
  shortDesc: string;
  longDesc: string;
  examples: string[];
}

const ROLES: RoleDef[] = [
  {
    value: "driver",
    title: "Always Drive",
    shortDesc: "You offer rides to colleagues on your commute.",
    longDesc:
      "You'll always appear as a driver in the network. Other commuters can request to join your trip, and you earn Poolyn points for every shared ride.",
    examples: [
      "Perfect if you own a car and commute a fixed route",
      "You earn eco-points and reduce parking pressure",
      "You control seat count and how much extra time you allow for pickups",
    ],
  },
  {
    value: "passenger",
    title: "Always Ride",
    shortDesc: "You find drivers heading your way.",
    longDesc:
      "You'll always appear as a passenger looking for a ride. Poolyn matches you with drivers whose routes overlap with yours.",
    examples: [
      "Great if you don't own a car or prefer not to drive",
      "Save on fuel, parking, and wear on your vehicle",
      "Simply request a seat and track your driver in real-time",
    ],
  },
  {
    value: "both",
    title: "Flexible",
    shortDesc: "Switch between driver and passenger day-to-day.",
    longDesc:
      "You'll appear in both driver and passenger pools. Use the daily toggle in your home screen to declare what you're doing today. The app accent colour shifts so you always know which mode you're in.",
    examples: [
      "Best for people with variable schedules",
      "Drive when you want to earn; ride when you need a break",
      "Toggle your mode instantly from the home screen",
    ],
  },
];

// ── Info Tooltip Modal ────────────────────────────────────────────────────────

function InfoModal({
  role,
  visible,
  onClose,
}: {
  role: RoleDef;
  visible: boolean;
  onClose: () => void;
}) {
  const palette = RoleTheme[role.value];
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={[styles.modalCard, { borderTopColor: palette.primary, borderTopWidth: 4 }]}
          activeOpacity={1}
        >
          <View style={[styles.modalIconWrap, { backgroundColor: palette.light }]}>
            <Ionicons name={palette.icon} size={32} color={palette.primary} />
          </View>
          <Text style={[styles.modalTitle, { color: palette.text }]}>{role.title}</Text>
          <Text style={styles.modalBody}>{role.longDesc}</Text>
          <View style={styles.modalExamples}>
            {role.examples.map((ex) => (
              <View key={ex} style={styles.exampleRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={palette.primary}
                  style={{ marginRight: 8, marginTop: 1 }}
                />
                <Text style={styles.exampleText}>{ex}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.modalNote}>You can always change this in your profile.</Text>
          <TouchableOpacity
            style={[styles.modalClose, { backgroundColor: palette.primary }]}
            onPress={onClose}
          >
            <Text style={styles.modalCloseText}>Got it</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RoleSelect() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const [selected, setSelected] = useState<UserRole>("both");
  const [tooltipRole, setTooltipRole] = useState<RoleDef | null>(null);
  const [loading, setLoading] = useState(false);

  const activePalette = RoleTheme[selected];
  const totalSteps = selected === "passenger" ? 3 : 4;

  async function handleContinue() {
    setLoading(true);

    const userId = profile?.id ?? session?.user?.id ?? null;
    if (userId) {
      const { error } = await supabase
        .from("users")
        .update({ role: selected })
        .eq("id", userId);

      if (error) {
        setLoading(false);
        showAlert("Something went wrong", "Could not save your role. Please try again.");
        return;
      }
    }

    setLoading(false);
    router.push("/(onboarding)/location");
  }

  return (
    <>
      {/* Dynamic background tint that transitions with selection */}
      <View style={[styles.bgTint, { backgroundColor: activePalette.light }]} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${(1 / totalSteps) * 100}%`,
                backgroundColor: activePalette.primary,
              },
            ]}
          />
        </View>

        <Text style={[styles.step, { color: activePalette.primary }]}>
          Step 1 of {totalSteps}
        </Text>
        <Text style={styles.title}>How will you commute with Poolyn?</Text>
        <Text style={styles.subtitle}>
          Pick your default mode. You can always change it later in your profile.
        </Text>

        {/* Role cards */}
        <View style={styles.options}>
          {ROLES.map((role) => {
            const isActive = selected === role.value;
            const palette = RoleTheme[role.value];
            return (
              <TouchableOpacity
                key={role.value}
                style={[
                  styles.card,
                  {
                    borderColor: isActive ? palette.primary : Colors.border,
                    backgroundColor: isActive ? palette.light : Colors.surface,
                  },
                ]}
                onPress={() => setSelected(role.value)}
                activeOpacity={0.75}
              >
                {/* Left icon */}
                <View
                  style={[
                    styles.cardIcon,
                    {
                      backgroundColor: isActive ? palette.primary : palette.light,
                    },
                  ]}
                >
                  <Ionicons
                    name={palette.icon}
                    size={26}
                    color={isActive ? "#FFFFFF" : palette.primary}
                  />
                </View>

                {/* Text */}
                <View style={styles.cardText}>
                  <Text
                    style={[
                      styles.cardTitle,
                      { color: isActive ? palette.text : Colors.text },
                    ]}
                  >
                    {role.title}
                  </Text>
                  <Text style={styles.cardDesc}>{role.shortDesc}</Text>
                </View>

                {/* Info button */}
                <TouchableOpacity
                  style={styles.infoBtn}
                  onPress={() => setTooltipRole(role)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={22}
                    color={isActive ? palette.primary : Colors.textTertiary}
                  />
                </TouchableOpacity>

                {/* Radio dot */}
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: isActive ? palette.primary : Colors.border,
                    },
                  ]}
                >
                  {isActive && (
                    <View
                      style={[
                        styles.radioDot,
                        { backgroundColor: palette.primary },
                      ]}
                    />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Flexible-mode hint */}
        {selected === "both" && (
          <View style={[styles.flexHint, { borderColor: activePalette.border, backgroundColor: activePalette.light }]}>
            <Ionicons name="swap-horizontal" size={18} color={activePalette.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.flexHintText, { color: activePalette.text }]}>
              As a Flexible commuter, a{" "}
              <Text style={{ fontWeight: FontWeight.semibold }}>
                Driver / Passenger toggle
              </Text>{" "}
              will live on your home screen so you can switch modes in seconds.
            </Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: activePalette.primary },
            loading && styles.buttonDisabled,
          ]}
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continue</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </ScrollView>

      {/* Info tooltip modal */}
      {tooltipRole && (
        <InfoModal
          role={tooltipRole}
          visible={!!tooltipRole}
          onClose={() => setTooltipRole(null)}
        />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bgTint: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.4,
  },
  container: { flex: 1, backgroundColor: "transparent" },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 70,
    paddingBottom: Spacing["3xl"],
  },
  progressTrack: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginBottom: Spacing.xl,
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  step: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginBottom: Spacing["2xl"],
    lineHeight: 22,
  },
  options: { gap: Spacing.md, marginBottom: Spacing.lg },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    borderWidth: 2,
    ...Shadow.sm,
  },
  cardIcon: {
    width: 50,
    height: 50,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  cardText: { flex: 1, marginRight: Spacing.xs },
  cardTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  infoBtn: { marginRight: Spacing.sm },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  flexHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  flexHintText: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  button: {
    borderRadius: BorderRadius.md,
    height: 52,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    ...Shadow.md,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: "#FFFFFF",
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    ...Shadow.lg,
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  modalBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  modalExamples: {
    width: "100%",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  exampleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  exampleText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  modalNote: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  modalClose: {
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  modalCloseText: {
    color: "#FFFFFF",
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.base,
  },
});
