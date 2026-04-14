import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Ionicons } from "@expo/vector-icons";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import {
  ackCrewTripPickupReady,
  crewTripPickupAckDriverishId,
  fetchCrewMemberHomePins,
  fetchCrewMessages,
  fetchCrewName,
  fetchCrewRoster,
  fetchCrewRow,
  fetchCrewOwnerHomeWork,
  fetchCrewTripContributionForSettlement,
  fetchCrewTripInstance,
  finishAndSettleCrewTripCredits,
  isCrewOwner,
  parseRiderPickupReadyMap,
  setCrewDesignatedDriver,
  sendCrewUserMessage,
  viewerShouldAckPickupReady,
  type CrewListRow,
  type CrewMemberMapPin,
  type CrewMessageRow,
  type CrewRosterMember,
  type CrewTripInstanceRow,
} from "@/lib/crewMessaging";
import { CrewTripScheduleModal } from "@/components/home/CrewTripScheduleModal";
import { CollaborativeDriverSpinModal } from "@/components/home/CollaborativeDriverSpinModal";
import { computeCrewDriverWheelPool, type CrewWheelMember } from "@/lib/crewDriverDicePool";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";
import { firstNameOnly } from "@/lib/personName";

export default function CrewTripChatScreen() {
  const { tripInstanceId: tripParam } = useLocalSearchParams<{ tripInstanceId: string | string[] }>();
  const tripInstanceId = Array.isArray(tripParam) ? tripParam[0] : tripParam;
  const { profile, refreshProfile } = useAuth();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const [crewName, setCrewName] = useState<string | null>(null);
  const [tripRow, setTripRow] = useState<CrewTripInstanceRow | null>(null);
  const [messages, setMessages] = useState<CrewMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [settling, setSettling] = useState(false);
  const [pickupAckBusy, setPickupAckBusy] = useState(false);
  const [imOwner, setImOwner] = useState(false);
  const [roster, setRoster] = useState<CrewRosterMember[]>([]);
  const [tripScheduleOpen, setTripScheduleOpen] = useState(false);
  const [scheduleCrew, setScheduleCrew] = useState<CrewListRow | null>(null);
  const [schedulePins, setSchedulePins] = useState<CrewMemberMapPin[]>([]);
  const [spinModalOpen, setSpinModalOpen] = useState(false);
  const [spinMembers, setSpinMembers] = useState<CrewWheelMember[]>([]);
  const [spinPrepBusy, setSpinPrepBusy] = useState(false);
  const listRef = useRef<FlatList<CrewMessageRow>>(null);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.kind !== "dice"),
    [messages]
  );

  const reload = useCallback(async () => {
    if (!tripInstanceId) return;
    const row = await fetchCrewTripInstance(tripInstanceId);
    setTripRow(row);
    if (row?.crew_id) {
      setCrewName(await fetchCrewName(row.crew_id));
    }
    setMessages(await fetchCrewMessages(tripInstanceId));
    setLoading(false);
  }, [tripInstanceId]);

  useEffect(() => {
    if (!tripInstanceId) return;
    setLoading(true);
    void reload();
  }, [tripInstanceId, reload]);

  useEffect(() => {
    if (!tripRow?.crew_id) return;
    void fetchCrewRoster(tripRow.crew_id).then(setRoster);
  }, [tripRow?.crew_id]);

  useEffect(() => {
    if (!tripRow?.crew_id || !profile?.id) {
      setImOwner(false);
      return;
    }
    void isCrewOwner(tripRow.crew_id, profile.id).then(setImOwner);
  }, [tripRow?.crew_id, profile?.id]);

  useEffect(() => {
    if (!tripInstanceId || !tripRow?.trip_started_at || tripRow.trip_finished_at) return;
    const channel = supabase
      .channel(`crew-chat-trip:${tripInstanceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "crew_trip_instances",
          filter: `id=eq.${tripInstanceId}`,
        },
        () => {
          void fetchCrewTripInstance(tripInstanceId).then(setTripRow);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tripInstanceId, tripRow?.trip_started_at, tripRow?.trip_finished_at]);

  const showRiderPickupAck = useMemo(
    () =>
      !!(profile?.id && tripRow && viewerShouldAckPickupReady(tripRow, profile.id)),
    [profile?.id, tripRow]
  );

  useLayoutEffect(() => {
    const t = crewName?.trim() ? `${crewName} · today` : "Crew chat";
    navigation.setOptions({ title: t });
  }, [navigation, crewName]);

  useEffect(() => {
    if (!tripInstanceId) return;

    const onInsert = (row: CrewMessageRow) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, row];
      });
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    };

    const channel: RealtimeChannel = supabase
      .channel(`crew-messages:${tripInstanceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crew_messages",
          filter: `crew_trip_instance_id=eq.${tripInstanceId}`,
        },
        (payload) => {
          const r = payload.new as {
            id: string;
            sender_id: string | null;
            body: string;
            kind: string;
            meta: unknown;
            sent_at: string;
          };
          void (async () => {
            let sender_name: string | null = null;
            if (r.sender_id) {
              const { data: u } = await supabase
                .from("users")
                .select("full_name")
                .eq("id", r.sender_id)
                .maybeSingle();
              sender_name = (u?.full_name as string | null) ?? null;
            }
            onInsert({
              id: r.id,
              sender_id: r.sender_id,
              body: r.body,
              kind: r.kind,
              meta: (r.meta as CrewMessageRow["meta"]) ?? {},
              sent_at: r.sent_at,
              sender_name,
            });
            if (r.kind === "system" || r.kind === "dice") {
              void reload();
            }
          })();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tripInstanceId, reload]);

  async function onSend() {
    if (!tripInstanceId || !profile?.id || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const res = await sendCrewUserMessage(tripInstanceId, profile.id, text);
    setSending(false);
    if (!res.ok) {
      if (res.reason === "empty") return;
      showAlert("Could not send", res.reason === "too_long" ? "Message is too long." : res.reason);
      return;
    }
    setDraft("");
    void reload();
  }

  async function onClaimDriver() {
    if (!tripInstanceId || !profile?.id || claiming) return;
    setClaiming(true);
    const res = await setCrewDesignatedDriver(tripInstanceId, profile.id);
    setClaiming(false);
    if (!res.ok) {
      showAlert("Could not set driver", res.reason.replace(/_/g, " "));
      return;
    }
    await reload();
    const row = await fetchCrewTripInstance(tripInstanceId);
    const cid = row?.crew_id;
    if (cid) {
      const [crewRow, pins] = await Promise.all([fetchCrewRow(cid), fetchCrewMemberHomePins(cid)]);
      if (crewRow) setScheduleCrew(crewRow);
      setSchedulePins(pins);
      setTripScheduleOpen(true);
    }
  }

  const driverActionsLocked = !!(tripRow?.trip_started_at || tripRow?.trip_finished_at);

  const prepareSpinAndOpen = useCallback(async () => {
    if (!tripInstanceId || !tripRow?.crew_id || !profile?.id || spinPrepBusy) return;
    setSpinPrepBusy(true);
    try {
      const [crewRow, pins, ownerHw] = await Promise.all([
        fetchCrewRow(tripRow.crew_id),
        fetchCrewMemberHomePins(tripRow.crew_id),
        fetchCrewOwnerHomeWork(tripRow.crew_id),
      ]);
      if (!crewRow) {
        showAlert("Could not load crew", "Try again.");
        return;
      }
      if (pins.length < 2) {
        showAlert(
          "Wheel unavailable",
          "Need at least two crew members with saved home pins."
        );
        return;
      }
      const wheel = computeCrewDriverWheelPool({
        memberPins: pins,
        commutePattern: crewRow.commute_pattern,
        viewerHome: profile.home_location,
        viewerWork: profile.work_location,
        corridorAnchorHome: ownerHw?.home_location,
        corridorAnchorWork: ownerHw?.work_location,
      });
      if (wheel.reason === "ok" && wheel.members.length > 0) {
        setSpinMembers(wheel.members);
      } else {
        setSpinMembers(
          pins.map((p) => ({
            userId: p.userId,
            displayName: (p.fullName || "Member").trim() || "Member",
            isMidRoute: false,
          }))
        );
      }
      setSpinModalOpen(true);
    } finally {
      setSpinPrepBusy(false);
    }
  }, [
    tripInstanceId,
    tripRow?.crew_id,
    profile?.id,
    profile?.home_location,
    profile?.work_location,
    spinPrepBusy,
  ]);

  const designatedId = tripRow?.designated_driver_user_id ?? null;

  const designatedDriverFirstName = useMemo(() => {
    if (!designatedId) return null;
    const r = roster.find((m) => m.userId === designatedId);
    return firstNameOnly(r?.fullName);
  }, [designatedId, roster]);
  const iAmDriver = !!(profile?.id && designatedId && profile.id === designatedId);

  // The person who pressed "Start Poolyn" is the de-facto driver even when no designated driver
  // was set via dice/chat. They are allowed to finish and settle; the system will auto-claim the
  // driver role for them before calling the settlement RPC (which requires designated_driver_user_id).
  const iAmTripStarter = !!(
    profile?.id &&
    tripRow?.trip_started_by_user_id &&
    profile.id === tripRow.trip_started_by_user_id
  );

  // Effective driver for UI purposes: designated driver takes precedence; fall back to trip starter.
  const effectiveDriverId = designatedId ?? (iAmTripStarter ? (profile?.id ?? null) : null);

  const payingRiderCount = useMemo(() => {
    // Use effectiveDriverId so the count is correct even when no designated driver is set yet.
    const driverId = tripRow?.designated_driver_user_id
      ?? (tripRow?.trip_started_by_user_id ?? null);
    if (!driverId || !tripRow) return 0;
    const ex = new Set(tripRow.excluded_pickup_user_ids ?? []);
    return roster.filter((m) => m.userId !== driverId && !ex.has(m.userId)).length;
  }, [roster, tripRow]);

  const canFinishAndSettle =
    !!tripInstanceId &&
    !!tripRow?.trip_started_at &&
    !tripRow?.trip_finished_at &&
    !!effectiveDriverId &&
    (iAmDriver || imOwner || iAmTripStarter);

  /**
   * Called when the driver taps "Finish trip and settle credits".
   *
   * Flow:
   * 1. Rider readiness guard (soft warning): if some riders have not tapped "I am ready for
   *    pickup", warn the driver before proceeding. They can wait or settle anyway.
   * 2. Pricing fetch: retrieve the per-rider credit contribution from locked crew corridor stats.
   * 3. Confirm dialog: summarise what will be debited from riders and credited to the driver.
   * 4. RPC call: poolyn_crew_trip_finish_and_settle_credits atomically verifies balances,
   *    posts ledger rows, and sets trip_finished_at + poolyn_credits_settled_at.
   *
   * skipReadinessCheck is set to true when re-called from the "Settle anyway" button in the
   * readiness warning dialog, preventing the same warning from appearing a second time.
   */
  async function onFinishTrip(skipReadinessCheck = false) {
    if (!tripInstanceId || !tripRow?.crew_id || !profile?.id || settling) return;

    // --- Rider readiness window guard ---
    // The window is open while the trip is in progress (started, not finished). Riders who
    // have not acked are still charged; this is an advisory warning so the driver can give
    // late riders a moment to confirm before closing the trip.
    if (!skipReadinessCheck && tripRow.trip_started_at && !tripRow.trip_finished_at) {
      const riderReadyMap = parseRiderPickupReadyMap(tripRow.rider_pickup_ready_at);
      const driverish = crewTripPickupAckDriverishId(tripRow);
      const ex = new Set(tripRow.excluded_pickup_user_ids ?? []);
      const unreadyRiders = roster.filter(
        (m) => m.userId !== driverish && !ex.has(m.userId) && !riderReadyMap[m.userId]
      );
      if (unreadyRiders.length > 0) {
        const shown = unreadyRiders.slice(0, 3);
        const nameList = shown.map((r) => (r.fullName || "Rider").trim()).join(", ");
        const overflow = unreadyRiders.length > 3 ? ` and ${unreadyRiders.length - 3} more` : "";
        showAlert(
          "Riders not yet ready",
          `${nameList}${overflow} ${unreadyRiders.length === 1 ? "has" : "have"} not confirmed pickup readiness. Settling now will still charge all non-excluded riders. Wait for them or settle anyway?`,
          [
            { text: "Wait", style: "cancel" },
            {
              text: "Settle anyway",
              style: "default",
              onPress: () => void onFinishTrip(true),
            },
          ]
        );
        return;
      }
    }

    // PRODUCTION TODO: Server-side gates required before enabling real-money credit settlement:
    //
    // 1. MINIMUM TRIP DURATION: Enforce in poolyn_crew_trip_finish_and_settle_credits that
    //    now() - trip_started_at >= interval '10 minutes' (or corridor duration estimate).
    //    Without this, a driver can start and immediately finish a trip to transfer credits
    //    without any actual carpooling occurring. This is the primary test-mode abuse vector.
    //
    // 2. LOCATION VERIFICATION: Require GPS evidence that the driver traveled the crew corridor
    //    before settling. Implement a trip_location_logs table and a periodic background-location
    //    write during the trip. The server RPC should verify that logged GPS points fall within
    //    an acceptable deviation of the locked crew route before posting ledger rows.
    //
    // 3. MANDATORY RIDER ACK: Require at least one non-excluded rider to have acked pickup
    //    readiness (rider_pickup_ready_at not empty) as a server-side hard block in the RPC.
    //    Currently rider acks are advisory only (soft warning shown above).
    //
    // Until these gates exist, use this feature only with trusted pilot crews and monitor
    // commute_credits_ledger for same-day repeat trip patterns per crew_id.

    // Auto-claim driver role when the trip starter is settling and no designated driver is set.
    // The settlement RPC requires designated_driver_user_id; this step sets it to the trip starter
    // so they receive the credits. The user sees no extra prompt since they started the run.
    if (!designatedId && iAmTripStarter && tripInstanceId && profile?.id) {
      const claim = await setCrewDesignatedDriver(tripInstanceId, profile.id);
      if (!claim.ok) {
        showAlert("Could not assign driver", claim.reason.replace(/_/g, " "));
        return;
      }
      // Reload so tripRow reflects the new designated_driver_user_id before settlement.
      await reload();
    }

    setSettling(true);
    try {
      const prev = await fetchCrewTripContributionForSettlement({
        crewId: tripRow.crew_id,
        viewerUserId: profile.id,
        payingRiderCount,
      });
      if (!prev.ok) {
        showAlert(
          "Cannot settle",
          prev.reason === "no_route_stats"
            ? "Save a locked crew route or a to-work commute on your profile so Poolyn can price the share."
            : prev.reason === "pricing_unavailable"
              ? "Trip distance is not available for this crew yet."
              : prev.reason
        );
        return;
      }
      const each = prev.contributionCredits;
      const sub =
        payingRiderCount < 1
          ? "No paying riders today (everyone excluded or solo). The trip will still close with no credit movement."
          : `About ${each.toLocaleString()} internal credits from each of ${payingRiderCount} rider(s) to today's driver. Crew explorer admin fee is up to 4% in credits for riders not on a workplace network (same idea as the cash line on the crew card).`;
      showAlert("Finish crew trip?", sub, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish and settle",
          style: "default",
          onPress: () =>
            void (async () => {
              setSettling(true);
              try {
                const res = await finishAndSettleCrewTripCredits({
                  tripInstanceId,
                  contributionCreditsPerRider: each,
                });
                if (!res.ok) {
                  if (res.reason === "insufficient_credits") {
                    showAlert(
                      "Not enough credits",
                      res.balance != null && res.needed != null
                        ? `A rider needs ${res.needed.toLocaleString()} credits but only has ${res.balance.toLocaleString()}.`
                        : "A rider does not have enough credits for this share."
                    );
                  } else {
                    showAlert("Could not settle", res.reason.replace(/_/g, " "));
                  }
                  return;
                }
                await refreshProfile();
                void reload();
                showAlert("Trip finished", "Credits have been moved to the driver for this day.");
              } finally {
                setSettling(false);
              }
            })(),
        },
      ]);
    } finally {
      setSettling(false);
    }
  }
  if (!tripInstanceId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Missing chat.</Text>
      </View>
    );
  }

  if (loading && !tripRow) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {iAmDriver ? (
        <View style={styles.driverBanner}>
          <Ionicons name="star" size={18} color="#B45309" />
          <Text style={styles.driverBannerText}>You&apos;re today&apos;s driver. Lead timing in this chat.</Text>
        </View>
      ) : designatedId ? (
        <View style={styles.driverNamedBanner}>
          <Ionicons name="ribbon-outline" size={20} color={Colors.primaryDark} />
          <Text style={styles.driverNamedBannerText}>
            Today&apos;s driver:{" "}
            <Text style={styles.driverNamedEmphasis}>{designatedDriverFirstName ?? "Assigned"}</Text>
          </Text>
        </View>
      ) : (
        <View style={styles.driverHint}>
          <Text style={styles.driverHintText}>
            No driver yet. Spin the wheel with the crew here, or tap I choose to drive if you are driving today.
          </Text>
        </View>
      )}

      {showRiderPickupAck && tripInstanceId ? (
        <View style={styles.riderAckBanner}>
          <Ionicons name="car-outline" size={20} color={Colors.primaryDark} />
          <View style={styles.riderAckTextCol}>
            <Text style={styles.riderAckTitle}>Driver started the trip</Text>
            <Text style={styles.riderAckSub}>
              Tap when you are ready for pickup. If you are not riding, tell the crew here so they can skip your
              stop.
            </Text>
            <TouchableOpacity
              style={[styles.riderAckBtn, pickupAckBusy && styles.claimBtnDisabled]}
              onPress={() => {
                if (!tripInstanceId || pickupAckBusy) return;
                void (async () => {
                  setPickupAckBusy(true);
                  try {
                    const r = await ackCrewTripPickupReady(tripInstanceId);
                    if (!r.ok) showAlert("Could not confirm", r.reason);
                    else void reload();
                  } finally {
                    setPickupAckBusy(false);
                  }
                })();
              }}
              disabled={pickupAckBusy}
              activeOpacity={0.85}
            >
              {pickupAckBusy ? (
                <ActivityIndicator color={Colors.textOnPrimary} size="small" />
              ) : (
                <Text style={styles.riderAckBtnText}>I am ready for pickup</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.driverActionCol}>
        <TouchableOpacity
          style={[
            styles.claimBtn,
            (claiming || iAmDriver || driverActionsLocked) && styles.claimBtnDisabled,
          ]}
          onPress={() => void onClaimDriver()}
          disabled={claiming || iAmDriver || driverActionsLocked}
          activeOpacity={0.85}
        >
          {claiming ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <>
              <Ionicons name="car-outline" size={20} color={Colors.primary} />
              <Text style={styles.claimBtnText}>
                {iAmDriver ? "You are marked as today's driver" : "I choose to drive"}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.spinChatBtn,
            (spinPrepBusy || driverActionsLocked) && styles.claimBtnDisabled,
          ]}
          onPress={() => void prepareSpinAndOpen()}
          disabled={spinPrepBusy || driverActionsLocked}
          activeOpacity={0.85}
        >
          {spinPrepBusy ? (
            <ActivityIndicator color="#A16207" />
          ) : (
            <>
              <Ionicons name="sync" size={20} color="#A16207" />
              <Text style={styles.spinChatBtnText}>Spin the wheel</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {tripRow?.trip_started_at && !tripRow?.trip_finished_at ? (
        <View style={styles.tripLiveBanner}>
          <Ionicons name="play-circle" size={18} color={Colors.primary} />
          <Text style={styles.tripLiveText}>Trip started. Finish when everyone has been dropped.</Text>
        </View>
      ) : null}

      {tripRow?.trip_finished_at ? (
        <View style={styles.tripDoneBanner}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.textSecondary} />
          <Text style={styles.tripDoneText}>This day’s crew trip is finished.</Text>
        </View>
      ) : null}

      {canFinishAndSettle ? (
        <TouchableOpacity
          style={styles.finishBtn}
          onPress={() => void onFinishTrip()}
          disabled={settling}
          activeOpacity={0.85}
        >
          {settling ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="flag-outline" size={20} color={Colors.textOnPrimary} />
              <Text style={styles.finishBtnText}>Finish trip and settle credits</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}

      <FlatList
        ref={listRef}
        data={visibleMessages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) => {
          if (m.kind === "system") {
            return (
              <View style={styles.systemWrap}>
                <View style={styles.systemBubble}>
                  <Text style={styles.systemText}>{m.body}</Text>
                </View>
              </View>
            );
          }
          const mine = m.sender_id === profile?.id;
          const isDriverMessage = !!(designatedId && m.sender_id === designatedId);
          return (
            <View style={[styles.msgRow, mine && styles.msgRowMine]}>
              <View
                style={[
                  styles.msgBubble,
                  mine ? styles.msgBubbleMine : styles.msgBubbleTheirs,
                  isDriverMessage && (mine ? styles.msgBubbleDriverMine : styles.msgBubbleDriverTheirs),
                ]}
              >
                {!mine && m.sender_name ? (
                  <Text style={styles.senderLabel}>{m.sender_name}</Text>
                ) : null}
                <Text style={[styles.msgText, mine && styles.msgTextMine]}>{m.body}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message your crew…"
          placeholderTextColor={Colors.textTertiary}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
          onPress={() => void onSend()}
          disabled={!draft.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator color={Colors.textOnPrimary} size="small" />
          ) : (
            <Ionicons name="send" size={20} color={Colors.textOnPrimary} />
          )}
        </TouchableOpacity>
      </View>

      {tripInstanceId && profile?.id && spinMembers.length > 0 ? (
        <CollaborativeDriverSpinModal
          visible={spinModalOpen}
          onClose={() => setSpinModalOpen(false)}
          tripInstanceId={tripInstanceId}
          members={spinMembers}
          viewerUserId={profile.id}
          onDriverAssigned={() => void reload()}
          onCelebrationComplete={() => {
            void (async () => {
              const row = await fetchCrewTripInstance(tripInstanceId);
              const cid = row?.crew_id;
              if (cid) {
                const [crewRow, pins] = await Promise.all([
                  fetchCrewRow(cid),
                  fetchCrewMemberHomePins(cid),
                ]);
                if (crewRow) setScheduleCrew(crewRow);
                setSchedulePins(pins);
                setTripScheduleOpen(true);
              }
            })();
          }}
        />
      ) : null}

      {tripRow && scheduleCrew && profile?.id ? (
        <CrewTripScheduleModal
          visible={tripScheduleOpen}
          onClose={() => setTripScheduleOpen(false)}
          onSaved={() => void reload()}
          crew={scheduleCrew}
          tripInstance={tripRow}
          driverUserId={tripRow.designated_driver_user_id ?? profile.id}
          viewerUserId={profile.id}
          roster={roster}
          memberPins={schedulePins}
          viewerHome={profile.home_location}
          viewerWork={profile.work_location}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  muted: { color: Colors.textSecondary },
  driverBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  driverBannerText: { flex: 1, fontSize: FontSize.sm, color: "#92400E", fontWeight: FontWeight.medium },
  driverHint: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  driverHintText: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
  driverNamedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.35)",
  },
  driverNamedBannerText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  driverNamedEmphasis: { fontWeight: FontWeight.bold, color: Colors.primaryDark },
  riderAckBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.35)",
  },
  riderAckTextCol: { flex: 1, minWidth: 0 },
  riderAckTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: 4,
  },
  riderAckSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  riderAckBtn: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  riderAckBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
  claimBtnDisabled: { opacity: 0.65 },
  driverActionCol: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  claimBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  spinChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FACC15",
  },
  spinChatBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: "#A16207",
  },
  tripLiveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  tripLiveText: { flex: 1, fontSize: FontSize.xs, color: Colors.text, lineHeight: 18 },
  tripDoneBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  tripDoneText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
  finishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
  },
  finishBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
  },
  listContent: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  systemWrap: { alignItems: "center", marginVertical: Spacing.xs },
  systemBubble: {
    maxWidth: "92%",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.borderLight,
  },
  systemText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  msgRow: { alignItems: "flex-start", marginVertical: 4 },
  msgRowMine: { alignItems: "flex-end" },
  msgBubble: {
    maxWidth: "85%",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  msgBubbleMine: { backgroundColor: Colors.primary },
  msgBubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  msgBubbleDriverTheirs: {
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "rgba(11, 132, 87, 0.5)",
  },
  msgBubbleDriverMine: {
    borderWidth: 2,
    borderColor: "#FACC15",
  },
  senderLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  msgText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  msgTextMine: { color: Colors.textOnPrimary },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnOff: { opacity: 0.45 },
});
