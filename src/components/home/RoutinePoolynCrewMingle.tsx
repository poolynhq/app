import { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TouchableOpacity } from "react-native";
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
  isCrewOwner,
  getOrCreateTripInstance,
  deleteCrewAsOwner,
  type CrewListRow,
  type CrewInvitePendingRow,
} from "@/lib/crewMessaging";
import { localDateKey } from "@/lib/dailyCommuteLocationGate";
import { JoinCrewByCodeModal } from "@/components/home/JoinCrewByCodeModal";
import {
  CrewPoolynCrewActionButtons,
  CrewPoolynCrewHintText,
  CrewPoolynCrewListRows,
} from "@/components/home/CrewPoolynCrewPicker";
import { showAlert } from "@/lib/platformAlert";
import { MinglePoolynHomePanel } from "@/components/home/MinglePoolynHomePanel";
import { useAuth } from "@/contexts/AuthContext";
import { effectiveCommuteMode } from "@/lib/commuteRoleIntent";

const MINGLE_AMBER = "#D97706";
const MINGLE_AMBER_SOFT = "#FEF3C7";
const MINGLE_CARD_BG = "#FFFBEB";
const MINGLE_CARD_BORDER = "rgba(217, 119, 6, 0.22)";

const MIN_DRIVER_DETOUR = 2;
const MIN_RIDER_DRIVER_DETOUR = 5;

function clampDriverDetour(n: number) {
  return Math.min(35, Math.max(MIN_DRIVER_DETOUR, n));
}
function clampRiderDriverDetour(n: number) {
  return Math.min(35, Math.max(MIN_RIDER_DRIVER_DETOUR, n));
}

export type RoutinePoolynMode = "crew" | "mingle";

/** When set, Mingle + passenger uses “Post pickup” instead of Start Poolyn (Home passes pickup state). */
export type MinglePassengerPickupCTA = {
  hasPendingRequest: boolean;
  onOpenPostRequest: () => void;
};

type Props = {
  profile: User;
  orgId: string | null;
  setVisibilityMode: (mode: "network" | "nearby") => void;
  /** From home commute route panel: saved route chosen (or not required). */
  commuteRouteReady: boolean;
  minglePassengerPickup?: MinglePassengerPickupCTA;
  onCrewCreated?: () => void;
};

export function RoutinePoolynCrewMingleBlock({
  profile,
  orgId,
  setVisibilityMode,
  commuteRouteReady,
  minglePassengerPickup,
  onCrewCreated,
}: Props) {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const isFocused = useIsFocused();
  const [mode, setMode] = useState<RoutinePoolynMode>("crew");
  const [crewModalOpen, setCrewModalOpen] = useState(false);
  const [driverDetourMins, setDriverDetourMins] = useState(() =>
    clampDriverDetour(profile.detour_tolerance_mins ?? 12)
  );
  const [riderDriverDetourCapMins, setRiderDriverDetourCapMins] = useState(() => {
    const cap =
      profile.passenger_max_driver_detour_mins ?? profile.detour_tolerance_mins ?? 12;
    return clampRiderDriverDetour(cap);
  });
  const [myCrews, setMyCrews] = useState<CrewListRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<CrewInvitePendingRow[]>([]);
  const [routineLoading, setRoutineLoading] = useState(true);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [crewCardStats, setCrewCardStats] = useState<
    Record<string, { members: number; pending: number }>
  >({});
  const [ownerByCrewId, setOwnerByCrewId] = useState<Record<string, boolean>>({});
  const [expandedCrewId, setExpandedCrewId] = useState<string | null>(null);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [deletingCrewId, setDeletingCrewId] = useState<string | null>(null);

  const loadRoutineData = useCallback(async () => {
    if (!profile.id) {
      setMyCrews([]);
      setPendingInvites([]);
      setCrewCardStats({});
      setOwnerByCrewId({});
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
        const ownerPairs = await Promise.all(
          crews.map(async (c) => [c.id, await isCrewOwner(c.id, profile.id)] as const)
        );
        setOwnerByCrewId(Object.fromEntries(ownerPairs));
      } else {
        setCrewCardStats({});
        setOwnerByCrewId({});
      }
    } finally {
      setRoutineLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    if (expandedCrewId && !myCrews.some((c) => c.id === expandedCrewId)) {
      setExpandedCrewId(null);
    }
  }, [myCrews, expandedCrewId]);

  useEffect(() => {
    if (!isFocused) return;
    void loadRoutineData();
  }, [isFocused, loadRoutineData]);

  useEffect(() => {
    setDriverDetourMins(clampDriverDetour(profile.detour_tolerance_mins ?? 12));
    const cap =
      profile.passenger_max_driver_detour_mins ?? profile.detour_tolerance_mins ?? 12;
    setRiderDriverDetourCapMins(clampRiderDriverDetour(cap));
  }, [profile.id, profile.detour_tolerance_mins, profile.passenger_max_driver_detour_mins]);

  const persistDetours = useCallback(async () => {
    await supabase
      .from("users")
      .update({
        detour_tolerance_mins: driverDetourMins,
        passenger_max_driver_detour_mins: riderDriverDetourCapMins,
      })
      .eq("id", profile.id);
    await refreshProfile();
  }, [driverDetourMins, riderDriverDetourCapMins, profile.id, refreshProfile]);

  const startMingle = useCallback(async () => {
    await persistDetours();
    router.push("/(tabs)/navigate?poolynMingle=1");
  }, [persistDetours, router]);

  async function onInviteRespond(invitationId: string, accept: boolean) {
    setInviteBusyId(invitationId);
    const r = await respondToCrewInvite(invitationId, accept);
    setInviteBusyId(null);
    if (!r.ok) {
      const msg =
        r.reason === "too_many_crews"
          ? `You can be in up to ${MAX_CREWS_PER_USER} crews. Leave or delete one in Crew Poolyn on Home before accepting another invite.`
          : r.reason;
      showAlert(accept ? "Could not accept" : "Could not decline", msg);
      return;
    }
    await loadRoutineData();
    if (accept) {
      showAlert("You’re in the crew", "Find it under Crew Poolyn on Home, or open today’s chat from the list.");
    }
  }

  const hasCrew = myCrews.length > 0;

  async function openTodaysChat(crewId: string) {
    const today = localDateKey();
    const inst = await getOrCreateTripInstance(crewId, today);
    if (!inst.ok) {
      showAlert("Could not open chat", inst.reason);
      return;
    }
    router.push({
      pathname: "/(tabs)/profile/crew-chat/[tripInstanceId]",
      params: { tripInstanceId: inst.row.id },
    });
  }

  function confirmDeleteCrew(c: CrewListRow) {
    showAlert(
      `Delete “${c.name}”?`,
      "Everyone loses access. Members, day chat threads, and pending invites are removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "default",
          onPress: () => {
            showAlert(
              "Delete crew permanently?",
              "You are about to delete this crew for all members. This cannot be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete crew",
                  style: "destructive",
                  onPress: () => void runDeleteCrew(c.id),
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function runDeleteCrew(crewId: string) {
    setDeletingCrewId(crewId);
    const r = await deleteCrewAsOwner(crewId);
    setDeletingCrewId(null);
    if (!r.ok) {
      showAlert("Could not delete crew", r.reason);
      return;
    }
    await loadRoutineData();
  }

  return (
    <View style={styles.wrap}>
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

      {mode === "crew" ? (
        routineLoading && !hasCrew ? (
          <View style={[styles.card, styles.loadingCard]}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>Loading your crew…</Text>
          </View>
        ) : hasCrew ? (
          <View style={styles.crewHasWrap}>
            <CrewPoolynCrewActionButtons
              crewCount={myCrews.length}
              onNewCrew={() => {
                if (myCrews.length >= MAX_CREWS_PER_USER) return;
                setCrewModalOpen(true);
              }}
              onJoinWithCode={() => setJoinModalOpen(true)}
            />
            <CrewPoolynCrewHintText variant="home" />
            <CrewPoolynCrewListRows
              mode="home"
              crews={myCrews}
              ownerByCrewId={ownerByCrewId}
              deletingCrewId={deletingCrewId}
              selectedCrewId={expandedCrewId}
              onCrewMainPress={(c) => {
                setExpandedCrewId((prev) => (prev === c.id ? null : c.id));
              }}
              onOpenChat={(crewId) => void openTodaysChat(crewId)}
              onDeleteOwner={(c) => confirmDeleteCrew(c)}
            />
            {expandedCrewId
              ? (() => {
                  const c = myCrews.find((x) => x.id === expandedCrewId);
                  if (!c) return null;
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
                })()
              : null}
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
                You&apos;re in {MAX_CREWS_PER_USER} crews (the maximum). Leave or delete one in the list above to
                add another.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.crewHasWrap}>
            <CrewPoolynCrewActionButtons
              crewCount={0}
              onNewCrew={() => {
                if (!commuteRouteReady) {
                  showAlert(
                    "Choose a route",
                    "Pick your usual commute route in the section above, then form a crew."
                  );
                  return;
                }
                setCrewModalOpen(true);
              }}
              onJoinWithCode={() => setJoinModalOpen(true)}
            />
            <Text style={styles.crewEmptyBlurb}>
              Create a crew for people you ride with often, or join with an invite code from your organiser.
            </Text>
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
          </View>
        )
      ) : (
        <View style={[styles.card, styles.cardMingle]}>
          <Text style={styles.cardTitle}>Mingle Poolyn</Text>
          <Text style={styles.cardBody}>
            Choose driving or riding, who can see you, then open the map when you head out.
          </Text>

          <MinglePoolynHomePanel setVisibilityMode={setVisibilityMode} />

          <TouchableOpacity
            style={styles.locationsRow}
            onPress={() => router.push("/(tabs)/profile/commute-locations")}
            activeOpacity={0.75}
          >
            <Ionicons name="location-outline" size={20} color={MINGLE_AMBER} />
            <View style={styles.locationsRowText}>
              <Text style={styles.locationsRowTitle}>Home, work &amp; pickup locations</Text>
              <Text style={styles.locationsRowSub}>Edit in Profile. Map refreshes after you save.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
          </TouchableOpacity>

          {(() => {
            const mingleIntent = effectiveCommuteMode(profile);
            const driverStepper = (
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setDriverDetourMins((m) => clampDriverDetour(m - 1))}
                >
                  <Ionicons name="remove" size={20} color={MINGLE_AMBER} />
                </Pressable>
                <Text style={styles.stepVal}>{driverDetourMins} min</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setDriverDetourMins((m) => clampDriverDetour(m + 1))}
                >
                  <Ionicons name="add" size={20} color={MINGLE_AMBER} />
                </Pressable>
              </View>
            );
            const riderStepper = (
              <View style={styles.stepper}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setRiderDriverDetourCapMins((m) => clampRiderDriverDetour(m - 1))}
                >
                  <Ionicons name="remove" size={20} color={MINGLE_AMBER} />
                </Pressable>
                <Text style={styles.stepVal}>{riderDriverDetourCapMins} min</Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setRiderDriverDetourCapMins((m) => clampRiderDriverDetour(m + 1))}
                >
                  <Ionicons name="add" size={20} color={MINGLE_AMBER} />
                </Pressable>
              </View>
            );
            if (mingleIntent === null) {
              return (
                <View>
                  <Text style={styles.miniLabel}>Driving: detour you accept (min)</Text>
                  {driverStepper}
                  <Text style={[styles.miniLabel, styles.miniLabelSpaced]}>
                    Riding: max driver detour to reach you (min)
                  </Text>
                  {riderStepper}
                </View>
              );
            }
            if (mingleIntent === "passenger") {
              return (
                <View>
                  <Text style={styles.miniLabel}>Max driver detour to reach you (min)</Text>
                  {riderStepper}
                </View>
              );
            }
            return (
              <View>
                <Text style={styles.miniLabel}>Detour you accept when driving (min)</Text>
                {driverStepper}
              </View>
            );
          })()}

          {(() => {
            const mingleIntent = effectiveCommuteMode(profile);
            const usePostPickup =
              minglePassengerPickup &&
              mingleIntent === "passenger";
            if (usePostPickup) {
              if (minglePassengerPickup.hasPendingRequest) {
                return (
                  <View style={styles.minglePickupPending}>
                    <Ionicons name="radio-outline" size={20} color={MINGLE_AMBER} />
                    <Text style={styles.minglePickupPendingText}>
                      Request active. Status is in the banner at the top.
                    </Text>
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  style={styles.postPickupMingleBtn}
                  onPress={() => {
                    void (async () => {
                      await persistDetours();
                      minglePassengerPickup.onOpenPostRequest();
                    })();
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Post a pickup request"
                >
                  <Ionicons name="megaphone-outline" size={20} color="#D97706" />
                  <Text style={styles.postPickupMingleBtnText}>Post a pickup request</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
                </TouchableOpacity>
              );
            }
            return (
              <Pressable style={styles.mingleGo} onPress={() => void startMingle()}>
                <Ionicons name="navigate" size={20} color="#fff" />
                <Text style={styles.mingleGoText}>Start Poolyn</Text>
              </Pressable>
            );
          })()}
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
      <JoinCrewByCodeModal
        visible={joinModalOpen}
        onClose={() => setJoinModalOpen(false)}
        onJoined={async (crewId) => {
          await loadRoutineData();
          setExpandedCrewId(crewId);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  invitesBlock: { marginTop: Spacing.md, marginBottom: Spacing.md },
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
  toggleRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    zIndex: 2,
    padding: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
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
  crewEmptyBlurb: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
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
  locationsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: MINGLE_CARD_BORDER,
    backgroundColor: "#fff",
  },
  locationsRowText: { flex: 1, minWidth: 0 },
  locationsRowTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  locationsRowSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
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
  postPickupMingleBtn: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: "rgba(217, 119, 6, 0.35)",
    backgroundColor: "#FFFBEB",
  },
  postPickupMingleBtnText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  minglePickupPending: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: MINGLE_CARD_BORDER,
    backgroundColor: "#fff",
  },
  minglePickupPendingText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  miniLabelSpaced: { marginTop: Spacing.md },
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
