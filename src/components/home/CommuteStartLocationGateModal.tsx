import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { CommuteStartAnchor } from "@/lib/commuteStartLocationCheck";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

type Props = {
  visible: boolean;
  meters: number;
  anchor: CommuteStartAnchor;
  canAcceptDifference: boolean;
  onAcceptDifference: () => void;
  onDismiss: () => void;
};

export function CommuteStartLocationGateModal({
  visible,
  meters,
  anchor,
  canAcceptDifference,
  onAcceptDifference,
  onDismiss,
}: Props) {
  const router = useRouter();
  const place = anchor === "home" ? "home" : "workplace";
  const title = "Away from your saved start";
  const body = `You look about ${meters} m from your saved ${place} start (used for route matching). Update your commute locations if you moved, or continue if this is intentional.`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Ionicons name="navigate-outline" size={28} color={Colors.primary} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              onDismiss();
              router.push("/(tabs)/profile/commute-locations");
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Update starting point</Text>
          </TouchableOpacity>
          {canAcceptDifference ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={onAcceptDifference} activeOpacity={0.85}>
              <Text style={styles.secondaryBtnText}>Accept for this session</Text>
              <Text style={styles.secondaryHint}>Only offered within 500 m of your saved start.</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.textBtn} onPress={onDismiss} hitSlop={12}>
            <Text style={styles.textBtnLabel}>Dismiss</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  primaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  secondaryBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  secondaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  secondaryHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
    textAlign: "center",
    paddingHorizontal: Spacing.md,
  },
  textBtn: {
    alignSelf: "center",
    paddingVertical: Spacing.sm,
  },
  textBtnLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
});
