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
  MAX_CREWS_PER_USER,
  type CrewListRow,
  type CrewInvitePendingRow,
} from "@/lib/crewMessaging";
import { showAlert } from "@/lib/platformAlert";

const MINGLE_AMBER = "#D97706";
const MINGLE_AMBER_SOFT = "#FEF3C7";
const MINGLE_CARD_BG = "#FFFBEB";
const MINGLE_CARD_BORDER = "rgba(217, 119, 6, 0.22)";

export type RoutinePoolynMode = "crew" | "mingle";

type Props = {
  profile: User;
  orgId: string | null;
  visibilityMode: "network" | "nearby" | string | null | undefined;
  setVisibilityMode: (mode: "network" | "nearby") => void;
  /** From home commute route panel: saved route chosen (or not required). */
  commuteRouteReady: boolean;
  onCrewCreated?: () => void;
};

export function RoutinePoolynCrewMingleBlock({
  profile,
  orgId,
  visibilityMode,
  setVisibilityMode,
  commuteRouteReady,
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
  const [pendingInvites, setPendingInvites] = useState<CrewInvitePendingRow[]>([]);
  const [routineLoading, setRoutineLoading] = useState(true);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [crewCardStats, setCrewCardStats] = useState<
    Record<string, { members: number; pending: number }>
  >({});

  const loadRoutineData = useCallback(async () => {
    if (!profile.id) {
      setMyCrews([]);
      setPendingInvites([]);
      setCrewCardStats({});
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
      if (crews.length) {
        const statsEntries = await Promise.all(
          crews.map(async (c) => {
            const [nMem, nPen] = await Promise.all([
              countCrewMembers(c.id),
              countPendingCrewInvitationsForCrew(c.id),
            ]);
            return [c.id, { members: nMem, pending: nPen }] as const;
          })
        );
        setCrewCardStats(Object.fromEntries(statsEntries));
      } else {
        setCrewCardStats({});
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
        r.reason === "too_many_crews"
          ? `You can be in up to ${MAX_CREWS_PER_USER} crews. Leave one under Profile → Poolyn Crews before accepting another invite.`
          : r.reason;
      showAlert(accept ? "Could not accept" : "Could not decline", msg);
      return;
    }
    await loadRoutineData();
    if (accept) {
      showAlert("You’re in the crew", "Open Profile → Crews or use Group chat on Home.");
    }
  }

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
            color={mode === "mingle" ? "#fff" : MINGLE_AMBER}
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
        ) : hasCrew ? (
          <View style={styles.crewHasWrap}>
            {myCrews.map((c) => {
              const st = crewCardStats[c.id];
              return (
                <MyCrewRoutineCard
                  key={c.id}
                  userId={profile.id}
                  crew={c}
                  memberCount={st?.members ?? 0}
                  pendingInviteCount={st?.pending ?? 0}
                  hasWorkplaceNetworkOnProfile={Boolean(profile.org_id)}
                  profilePins={{
                    home_location: profile.home_location,
                    work_location: profile.work_location,
                  }}
                  onRefresh={() => void loadRoutineData()}
                  onCrewDeleted={() => void loadRoutineData()}
                />
              );
            })}
            {myCrews.length < MAX_CREWS_PER_USER ? (
              <Pressable
                style={styles.secondaryCrewCta}
                onPress={() => {
                  if (myCrews.length >= MAX_CREWS_PER_USER) return;
                  setCrewModalOpen(true);
                }}
              >
                <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.secondaryCrewCtaText}>Form another crew</Text>
              </Pressable>
            ) : (
              <Text style={styles.crewCapHint}>
                You&apos;re in {MAX_CREWS_PER_USER} crews (the maximum). Leave one under Profile → Poolyn Crews to
                add another.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Same people, most days</Text>
            <Text style={styles.cardBody}>
              Form a crew with coworkers you trust. Selected people get an in-app invite; everyone can still use
              the invite code. Coordinate in daily crew chat and take turns driving.
            </Text>
            <Pressable
              style={[styles.crewCta, !commuteRouteReady && styles.crewCtaDisabled]}
              onPress={() => {
                if (!commuteRouteReady) {
                  showAlert(
                    "Choose a route",
                    "Pick your usual commute route in the section above, then form a crew."
                  );
                  return;
                }
                setCrewModalOpen(true);
              }}
            >
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
              <Ionicons name="remove" size={20} color={MINGLE_AMBER} />
            </Pressable>
            <Text style={styles.stepVal}>{detourMins} min</Text>
            <Pressable style={styles.stepBtn} onPress={() => setDetourMins((m) => Math.min(35, m + 1))}>
              <Ionicons name="add" size={20} color={MINGLE_AMBER} />
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
  toggleChipOnMingle: { backgroundColor: MINGLE_AMBER, borderColor: "#B45309" },
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
  cardMingle: {
    backgroundColor: MINGLE_CARD_BG,
    borderColor: MINGLE_CARD_BORDER,
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
    backgroundColor: MINGLE_AMBER_SOFT,
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
  scopeChipOnMingle: { backgroundColor: MINGLE_AMBER, borderColor: "#B45309" },
  scopeChipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.text },
  scopeChipTextOn: { color: "#fff" },
  mingleGo: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: MINGLE_AMBER,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    ...Shadow.sm,
  },
  mingleGoText: { color: "#fff", fontSize: FontSize.base, fontWeight: FontWeight.bold },
  crewCtaDisabled: { opacity: 0.55 },
  secondaryCrewCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: "#fff",
  },
  secondaryCrewCtaText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
  crewCapHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
});
