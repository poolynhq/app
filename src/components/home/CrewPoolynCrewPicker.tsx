import { View, Text, TouchableOpacity, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CrewListRow } from "@/lib/crewMessaging";
import { MAX_CREWS_PER_USER } from "@/lib/crewMessaging";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { showAlert } from "@/lib/platformAlert";

/** Profile screen: row opens crew settings. */
export const CREW_POOLYN_LIST_HINT_PROFILE =
  "Tap a crew for settings (members, invite). The chat icon opens today’s thread. Each calendar day has its own chat thread. Pick today’s driver from the crew card on Home or claim in chat; they lead coordination for the day.";

/** Home: row expands map and trip card below. */
export const CREW_POOLYN_LIST_HINT_HOME =
  "Tap a crew to show map and trip actions below. The chat icon opens today’s thread. Each calendar day has its own chat thread. Pick today’s driver from this card or claim in chat; they lead coordination for the day.";

type ActionButtonsProps = {
  crewCount: number;
  onNewCrew: () => void;
  onJoinWithCode: () => void;
};

export function CrewPoolynCrewActionButtons({ crewCount, onNewCrew, onJoinWithCode }: ActionButtonsProps) {
  const atCap = crewCount >= MAX_CREWS_PER_USER;
  return (
    <View style={styles.actions}>
      <TouchableOpacity
        style={[styles.actionBtn, atCap && styles.actionBtnDisabled]}
        onPress={() => {
          if (atCap) {
            showAlert(
              "Crew limit",
              `You can be in up to ${MAX_CREWS_PER_USER} crews. Delete or leave one here before creating another.`
            );
            return;
          }
          onNewCrew();
        }}
        activeOpacity={0.85}
      >
        <Ionicons
          name="add-circle-outline"
          size={20}
          color={atCap ? Colors.textTertiary : Colors.primary}
        />
        <Text style={[styles.actionBtnText, atCap && styles.actionBtnTextDisabled]}>New crew</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={onJoinWithCode} activeOpacity={0.85}>
        <Ionicons name="enter-outline" size={20} color={Colors.primary} />
        <Text style={styles.actionBtnText}>Join with code</Text>
      </TouchableOpacity>
    </View>
  );
}

type HintProps = { variant: "home" | "profile" };

export function CrewPoolynCrewHintText({ variant }: HintProps) {
  const text = variant === "home" ? CREW_POOLYN_LIST_HINT_HOME : CREW_POOLYN_LIST_HINT_PROFILE;
  return <Text style={styles.hint}>{text}</Text>;
}

type ListRowsProps = {
  crews: CrewListRow[];
  ownerByCrewId: Record<string, boolean>;
  deletingCrewId: string | null;
  /** When set (e.g. on Home), highlights the row and implies expanded detail below. */
  selectedCrewId?: string | null;
  mode: "home" | "profile";
  onCrewMainPress: (c: CrewListRow) => void;
  onOpenChat: (crewId: string) => void;
  onDeleteOwner: (c: CrewListRow) => void;
};

export function CrewPoolynCrewListRows({
  crews,
  ownerByCrewId,
  deletingCrewId,
  selectedCrewId,
  mode,
  onCrewMainPress,
  onOpenChat,
  onDeleteOwner,
}: ListRowsProps) {
  if (crews.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="people-outline" size={44} color={Colors.textTertiary} />
        <Text style={styles.emptyTitle}>No crews yet</Text>
        <Text style={styles.emptyBody}>Create one for your carpool cluster or join with an invite code.</Text>
      </View>
    );
  }

  return (
    <>
      {crews.map((c) => (
        <View key={c.id} style={[styles.card, selectedCrewId === c.id && styles.cardSelected]}>
          <TouchableOpacity
            style={styles.cardMain}
            onPress={() => onCrewMainPress(c)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={
              mode === "profile" ? `${c.name}, crew settings` : `${c.name}, show crew on Home`
            }
          >
            <View style={styles.cardIcon}>
              <Ionicons name="people" size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.cardSub}>Settings · invite {c.invite_code}</Text>
            </View>
          </TouchableOpacity>
          <Pressable
            style={styles.cardChat}
            onPress={() => onOpenChat(c.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open today’s chat for ${c.name}`}
            hitSlop={10}
          >
            <Ionicons name="chatbubbles-outline" size={22} color={Colors.primary} />
          </Pressable>
          {ownerByCrewId[c.id] ? (
            <Pressable
              style={styles.cardDelete}
              onPress={() => onDeleteOwner(c)}
              disabled={deletingCrewId !== null}
              accessibilityRole="button"
              accessibilityLabel="Delete crew"
              hitSlop={10}
            >
              {deletingCrewId === c.id ? (
                <ActivityIndicator color={Colors.error} size="small" />
              ) : (
                <Ionicons name="trash-outline" size={22} color={Colors.error} />
              )}
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  actionBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
  },
  actionBtnDisabled: { opacity: 0.65, borderColor: Colors.border },
  actionBtnTextDisabled: { color: Colors.textTertiary },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.xs,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minWidth: 0,
    paddingVertical: Spacing.xs,
  },
  cardChat: {
    padding: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  cardDelete: {
    padding: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  cardSub: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginTop: Spacing.md,
  },
  emptyBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
});
