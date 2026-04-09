import { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import type { User } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";
import { CrewFormationModal } from "@/components/home/CrewFormationModal";
import { MyCrewRoutineCard } from "@/components/home/MyCrewRoutineCard";
import {
  listMyCrews,
  listPendingCrewInvites,
  respondToCrewInvite,
  countCrewMembers,
  countPendingCrewInvitationsForCrew,
  type CrewListRow,
  type CrewInvitePendingRow,
} from "@/lib/crewMessaging";
import { showAlert } from "@/lib/platformAlert";

export type RoutinePoolynMode = "crew" | "mingle";

type Props = {
  profile: User;
  orgId: string | null;
  visibilityMode: "network" | "nearby" | string | null | undefined;
  setVisibilityMode: (mode: "network" | "nearby") => void;
  onCrewCreated?: () => void;
};

export function RoutinePoolynCrewMingleBlock({
  profile,
  orgId,
  visibilityMode,
  setVisibilityMode,
  onCrewCreated,
}: Props) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const [mode, setMode] = useState<RoutinePoolynMode>("crew");
  const [crewModalOpen, setCrewModalOpen] = useState(false);
  const [detourMins, setDetourMins] = useState(
    Math.min(30, Math.max(5, profile.detour_tolerance_mins ?? 12))
  );
  const [myCrews, setMyCrews] = useState<CrewListRow[]>([]);
  const [primaryMemberCount, setPrimaryMemberCount] = useState(0);
  const [primaryPendingInviteCount, setPrimaryPendingInviteCount] = useState(0);
  const [pendingInvites, setPendingInvites] = useState<CrewInvitePendingRow[]>([]);
  const [routineLoading, setRoutineLoading] = useState(true);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  const loadRoutineData = useCallback(async () => {
    if (!profile.id) {
      setMyCrews([]);
      setPendingInvites([]);
      setPrimaryMemberCount(0);
      setPrimaryPendingInviteCount(0);
      setRoutineLoading(false);
      return;
    }
    setRoutineLoading(true);
    try {
      const [crews, pending] = await Promise.all([
        listMyCrews(profile.id),
        listPendingCrewInvites(profile.id),
      ]);
      setMyCrews(crews);
      setPendingInvites(pending);
      if (crews[0]) {
        const [nMem, nPen] = await Promise.all([
          countCrewMembers(crews[0].id),
          countPendingCrewInvitationsForCrew(crews[0].id),
        ]);
        setPrimaryMemberCount(nMem);
        setPrimaryPendingInviteCount(nPen);
      } else {
        setPrimaryMemberCount(0);
        setPrimaryPendingInviteCount(0);
      }
    } finally {
      setRoutineLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    if (!isFocused) return;
    void loadRoutineData();
  }, [isFocused, loadRoutineData]);

  const persistDetour = useCallback(async () => {
    await supabase.from("users").update({ detour_tolerance_mins: detourMins }).eq("id", profile.id);
  }, [detourMins, profile.id]);

  const startMingle = useCallback(async () => {
    await persistDetour();
    router.push("/(tabs)/navigate?poolynMingle=1");
  }, [persistDetour, router]);

  async function onInviteRespond(invitationId: string, accept: boolean) {
    setInviteBusyId(invitationId);
    const r = await respondToCrewInvite(invitationId, accept);
    setInviteBusyId(null);
    if (!r.ok) {
      const msg =
        r.reason === "already_in_crew"
          ? "You already belong to a crew. Leave it under Profile → Poolyn Crews before accepting another invite."
          : r.reason;
      showAlert(accept ? "Could not accept" : "Could not decline", msg);
      return;
    }
    await loadRoutineData();
    if (accept) {
      showAlert("You’re in the crew", "Open Profile → Crews or use Group chat on Home.");
    }
  }

  const primaryCrew = myCrews[0];
  const hasCrew = myCrews.length > 0;

  return (
    <View style={styles.wrap}>
      {pendingInvites.length > 0 ? (
        <View style={styles.invitesBlock}>
          <Text style={styles.invitesEyebrow}>Crew invitations</Text>
          {pendingInvites.map((inv) => (
            <View key={inv.id} style={styles.inviteCard}>
              <Text style={styles.inviteTitle}>
                {(inv.invited_by_name || "A teammate").trim()} → {inv.crew_name}
              </Text>
              {inv.message ? <Text style={styles.inviteMsg}>&ldquo;{inv.message}&rdquo;</Text> : null}
              <View style={styles.inviteRow}>
                <Pressable
                  style={[styles.inviteBtn, styles.inviteAccept, inviteBusyId === inv.id && styles.inviteBtnBusy]}
                  onPress={() => void onInviteRespond(inv.id, true)}
                  disabled={inviteBusyId !== null}
                >
                  {inviteBusyId === inv.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.inviteAcceptText}>Accept</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.inviteBtn, styles.inviteDecline, inviteBusyId === inv.id && styles.inviteBtnBusy]}
                  onPress={() => void onInviteRespond(inv.id, false)}
                  disabled={inviteBusyId !== null}
                >
                  <Text style={styles.inviteDeclineText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>How do you want to Poolyn today?</Text>
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleChip, mode === "crew" && styles.toggleChipOn]}
          onPress={() => setMode("crew")}
        >
          <Ionicons
            name="people"
            size={18}
            color={mode === "crew" ? "#fff" : Colors.primary}
          />
          <Text style={[styles.toggleText, mode === "crew" && styles.toggleTextOn]}>Crew Poolyn</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleChip, mode === "mingle" && styles.toggleChipOnMingle]}
          onPress={() => setMode("mingle")}
        >
          <Ionicons
            name="git-network-outline"
            size={18}
            color={mode === "mingle" ? "#fff" : "#7C3AED"}
          />
          <Text style={[styles.toggleText, mode === "mingle" && styles.toggleTextOn]}>Mingle Poolyn</Text>
        </Pressable>
      </View>

      {mode === "crew" ? (
        routineLoading && !hasCrew ? (
          <View style={[styles.card, styles.loadingCard]}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>Loading your crew…</Text>
          </View>
        ) : hasCrew && primaryCrew ? (
          <View style={styles.crewHasWrap}>
            {myCrews.length > 1 ? (
              <Text style={styles.legacyCrewWarning}>
                You have more than one crew on file from before the one-crew limit. Leave extras under Profile →
                Poolyn Crews so matching stays simple.
              </Text>
            ) : null}
            <MyCrewRoutineCard
              userId={profile.id}
              crew={primaryCrew}
              memberCount={primaryMemberCount}
              pendingInviteCount={primaryPendingInviteCount}
              profilePins={{
                home_location: profile.home_location,
                work_location: profile.work_location,
              }}
              onRefresh={() => void loadRoutineData()}
              onCrewDeleted={() => void loadRoutineData()}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Same people, most days</Text>
            <Text style={styles.cardBody}>
              Form a crew with coworkers you trust. Selected people get an in-app invite; everyone can still use
              the invite code. Coordinate in daily crew chat and take turns driving.
            </Text>
            <Pressable style={styles.crewCta} onPress={() => setCrewModalOpen(true)}>
              <Text style={styles.crewCtaText}>Form your Crew</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </Pressable>
          </View>
        )
      ) : (
        <View style={[styles.card, styles.cardMingle]}>
          <Text style={styles.cardTitle}>Open matching on your corridor</Text>
          <Text style={styles.cardBody}>
            Set how far you&apos;ll detour, then choose who can see you on the map. Start opens turn-by-turn
            toward work from your saved pins.
          </Text>

          <Text style={styles.miniLabel}>Detour tolerance (minutes)</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => setDetourMins((m) => Math.max(5, m - 1))}>
              <Ionicons name="remove" size={20} color="#7C3AED" />
            </Pressable>
            <Text style={styles.stepVal}>{detourMins} min</Text>
            <Pressable style={styles.stepBtn} onPress={() => setDetourMins((m) => Math.min(35, m + 1))}>
              <Ionicons name="add" size={20} color="#7C3AED" />
            </Pressable>
          </View>

          <Text style={styles.miniLabel}>Who can match with you</Text>
          <View style={styles.scopeRow}>
            <Pressable
              style={[styles.scopeChip, visibilityMode !== "nearby" && styles.scopeChipOn]}
              onPress={() => setVisibilityMode("network")}
            >
              <Text
                style={[styles.scopeChipText, visibilityMode !== "nearby" && styles.scopeChipTextOn]}
              >
                My organisation only
              </Text>
            </Pressable>
            <Pressable
              style={[styles.scopeChip, visibilityMode === "nearby" && styles.scopeChipOnMingle]}
              onPress={() => setVisibilityMode("nearby")}
            >
              <Text
                style={[styles.scopeChipText, visibilityMode === "nearby" && styles.scopeChipTextOn]}
              >
                Anyone on my route
              </Text>
            </Pressable>
          </View>

          <Pressable style={styles.mingleGo} onPress={() => void startMingle()}>
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text style={styles.mingleGoText}>Start Poolyn</Text>
          </Pressable>
        </View>
      )}

      <CrewFormationModal
        visible={crewModalOpen}
        onClose={() => setCrewModalOpen(false)}
        profile={profile}
        orgId={orgId}
        onCreated={() => {
          void loadRoutineData();
          onCrewCreated?.();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  invitesBlock: { marginBottom: Spacing.md },
  invitesEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
  },
  inviteCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  inviteTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  inviteMsg: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    fontStyle: "italic",
  },
  inviteRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.md },
  inviteBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteBtnBusy: { opacity: 0.7 },
  inviteAccept: { backgroundColor: Colors.primary },
  inviteAcceptText: { color: "#fff", fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  inviteDecline: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  inviteDeclineText: { color: Colors.textSecondary, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
  },
  toggleRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  toggleChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleChipOnMingle: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  toggleText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  toggleTextOn: { color: "#fff" },
  card: {
    backgroundColor: "#F0FDF4",
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.2)",
    ...Shadow.sm,
  },
  loadingCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  loadingText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  crewHasWrap: { gap: Spacing.sm },
  legacyCrewWarning: {
    fontSize: FontSize.xs,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    lineHeight: 18,
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  cardMingle: {
    backgroundColor: "#F5F3FF",
    borderColor: "rgba(124, 58, 237, 0.22)",
  },
  cardTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  cardBody: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  crewCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
  },
  crewCtaText: { color: "#fff", fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  miniLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    alignItems: "center",
  },
  stepVal: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, minWidth: 64 },
  scopeRow: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
  scopeChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scopeChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  scopeChipOnMingle: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  scopeChipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.text },
  scopeChipTextOn: { color: "#fff" },
  mingleGo: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#7C3AED",
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    ...Shadow.sm,
  },
  mingleGoText: { color: "#fff", fontSize: FontSize.base, fontWeight: FontWeight.bold },
});
