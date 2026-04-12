import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getMyRideAsDriver, type MyRideAsDriverDetail } from "@/lib/driverRides";
import {
  ADHOC_TRIP_CANCEL_REASONS,
  driverCancelAdhocRide,
  driverRemovePassengerFromAdhocRide,
  type AdhocTripCancelReasonCode,
} from "@/lib/adhocCancellation";
import { showAlert } from "@/lib/platformAlert";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "@/constants/theme";

function formatDepart(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function TripDetailScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string | string[] }>();
  const id = Array.isArray(rideId) ? rideId[0] : rideId;

  const [row, setRow] = useState<MyRideAsDriverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [removeTarget, setRemoveTarget] = useState<{ passengerId: string; name: string } | null>(null);
  const [removeStep, setRemoveStep] = useState<0 | 1>(0);
  const [removeMessage, setRemoveMessage] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<AdhocTripCancelReasonCode | null>(null);
  const [cancelDetail, setCancelDetail] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    const r = await getMyRideAsDriver(id);
    setRow(r);
    setNotFound(!r);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onConfirmRemoveRider() {
    if (!id || !removeTarget) return;
    const msg = removeMessage.trim();
    if (!msg) {
      showAlert("Add a short note", "Tell the rider why they are removed (visible to them in Poolyn).");
      return;
    }
    setRemoveBusy(true);
    const res = await driverRemovePassengerFromAdhocRide({
      rideId: id,
      passengerId: removeTarget.passengerId,
      message: msg,
    });
    setRemoveBusy(false);
    if (res.ok) {
      setRemoveTarget(null);
      setRemoveStep(0);
      setRemoveMessage("");
      showAlert("Rider removed", "They can search for another trip.");
      void load();
    } else {
      showAlert("Could not remove", res.reason);
    }
  }

  async function onConfirmCancelTrip() {
    if (!id || !cancelReason) return;
    const detail = cancelDetail.trim();
    if (cancelReason === "other" && !detail) {
      showAlert("Add a note", "Describe the reason when you choose Other.");
      return;
    }
    setCancelBusy(true);
    const res = await driverCancelAdhocRide({
      rideId: id,
      reasonCode: cancelReason,
      reasonDetail: cancelReason === "other" ? detail : detail,
    });
    setCancelBusy(false);
    if (res.ok) {
      setCancelOpen(false);
      setCancelReason(null);
      setCancelDetail("");
      showAlert("Trip cancelled", "Riders were notified. You can post a new dated trip anytime.");
      router.replace("/(tabs)/rides");
    } else {
      showAlert("Could not cancel", res.reason);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      </SafeAreaView>
    );
  }

  if (notFound || !row) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <Text style={styles.title}>Trip not found</Text>
        <Text style={styles.body}>This trip may have ended or you may not be the driver.</Text>
      </SafeAreaView>
    );
  }

  const isAdhoc = row.poolynContext === "adhoc";
  const routeLine = `${(row.adhocOriginLabel ?? "Start").trim()} → ${(row.adhocDestinationLabel ?? "End").trim()}`;
  const canManage = isAdhoc && (row.status === "scheduled" || row.status === "active");

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{isAdhoc ? "Dated trip" : "Your drive"}</Text>
        <Text style={styles.meta}>{formatDepart(row.departAt)}</Text>
        <Text style={styles.status}>
          {row.status === "active" ? "In progress" : row.status === "cancelled" ? "Cancelled" : "Scheduled"} ·{" "}
          {row.seatsAvailable} seat{row.seatsAvailable === 1 ? "" : "s"} left
        </Text>

        {isAdhoc && row.adhocTripTitle ? (
          <Text style={styles.tripName}>{row.adhocTripTitle}</Text>
        ) : null}

        <Text style={styles.section}>Route</Text>
        <Text style={styles.body}>{routeLine}</Text>

        {isAdhoc && row.notes?.trim() ? (
          <>
            <Text style={styles.section}>Your notes to riders</Text>
            <Text style={styles.body}>{row.notes.trim()}</Text>
          </>
        ) : null}

        <Text style={styles.section}>Booked riders ({row.confirmedPassengers.length})</Text>
        {row.confirmedPassengers.length === 0 ? (
          <Text style={styles.muted}>No confirmed passengers yet.</Text>
        ) : (
          row.confirmedPassengers.map((p) => (
            <View key={p.passengerId} style={styles.riderRow}>
              <Text style={styles.body}>{(p.fullName ?? "Member").trim()}</Text>
              {canManage ? (
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => {
                    setRemoveTarget({
                      passengerId: p.passengerId,
                      name: (p.fullName ?? "This rider").trim(),
                    });
                    setRemoveStep(0);
                    setRemoveMessage("");
                  }}
                >
                  <Text style={styles.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        )}

        <Text style={styles.section}>Seat requests</Text>
        <Text style={styles.body}>
          {row.pendingSeatRequests === 0
            ? "No pending requests on this trip."
            : `${row.pendingSeatRequests} pending (respond under My rides, Active).`}
        </Text>

        {canManage ? (
          <TouchableOpacity
            style={styles.dangerOutlineBtn}
            activeOpacity={0.85}
            onPress={() => {
              setCancelReason(null);
              setCancelDetail("");
              setCancelOpen(true);
            }}
          >
            <Text style={styles.dangerOutlineText}>Cancel entire trip</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.hint}>
          Coordinate changes in Messages on this ride so everyone sees the same thread.
        </Text>
      </ScrollView>

      <Modal visible={removeTarget !== null} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {removeStep === 0 ? "Remove rider" : "Message to rider"}
            </Text>
            {removeStep === 0 ? (
              <>
                <Text style={styles.modalBody}>
                  {removeTarget
                    ? `Remove ${removeTarget.name} from this dated trip? They lose their seat. This cannot be undone.`
                    : ""}
                </Text>
                <Text style={styles.modalWarn}>
                  Only remove someone if plans genuinely changed or you cannot take them. They receive your note
                  in Poolyn.
                </Text>
                <View style={styles.modalRow}>
                  <TouchableOpacity
                    style={styles.modalSecondary}
                    onPress={() => {
                      setRemoveTarget(null);
                      setRemoveStep(0);
                    }}
                  >
                    <Text style={styles.modalSecondaryText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalPrimary}
                    onPress={() => setRemoveStep(1)}
                  >
                    <Text style={styles.modalPrimaryText}>Continue</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalBody}>
                  Write a short note (required). It is shown to the rider with the removal.
                </Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Reason for removal"
                  placeholderTextColor={Colors.textTertiary}
                  value={removeMessage}
                  onChangeText={setRemoveMessage}
                  multiline
                  maxLength={500}
                />
                <View style={styles.modalRow}>
                  <TouchableOpacity style={styles.modalSecondary} onPress={() => setRemoveStep(0)}>
                    <Text style={styles.modalSecondaryText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalDanger, removeBusy && styles.btnDisabled]}
                    disabled={removeBusy}
                    onPress={() => void onConfirmRemoveRider()}
                  >
                    {removeBusy ? (
                      <ActivityIndicator color={Colors.textOnPrimary} />
                    ) : (
                      <Text style={styles.modalDangerText}>Remove rider</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={cancelOpen} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.modalSheet, styles.modalSheetTall]}>
            <Text style={styles.modalTitle}>Cancel this trip</Text>
            <Text style={styles.modalBody}>
              All booked riders and pending requests are notified with your reason. This cannot be undone.
            </Text>
            <Text style={styles.sectionSmall}>Reason</Text>
            {ADHOC_TRIP_CANCEL_REASONS.map((opt) => (
              <TouchableOpacity
                key={opt.code}
                style={[styles.reasonRow, cancelReason === opt.code && styles.reasonRowOn]}
                onPress={() => setCancelReason(opt.code)}
              >
                <Text style={styles.reasonText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.modalInput}
              placeholder={
                cancelReason === "other"
                  ? "Describe the reason (required for Other)"
                  : "Optional extra detail"
              }
              placeholderTextColor={Colors.textTertiary}
              value={cancelDetail}
              onChangeText={setCancelDetail}
              multiline
              maxLength={500}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={styles.modalSecondary}
                onPress={() => {
                  setCancelOpen(false);
                  setCancelReason(null);
                  setCancelDetail("");
                }}
              >
                <Text style={styles.modalSecondaryText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDanger, cancelBusy && styles.btnDisabled]}
                disabled={cancelBusy || !cancelReason}
                onPress={() => void onConfirmCancelTrip()}
              >
                {cancelBusy ? (
                  <ActivityIndicator color={Colors.textOnPrimary} />
                ) : (
                  <Text style={styles.modalDangerText}>Cancel trip</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.xl, paddingBottom: Spacing["3xl"] },
  title: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.primaryDark, fontWeight: FontWeight.semibold, marginTop: Spacing.sm },
  status: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  tripName: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text, marginTop: Spacing.md },
  section: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  sectionSmall: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  body: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 22 },
  muted: { fontSize: FontSize.sm, color: Colors.textTertiary, fontStyle: "italic" },
  riderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  removeBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  removeBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  dangerOutlineBtn: {
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.warning,
    alignItems: "center",
  },
  dangerOutlineText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.warning },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing.xl,
    lineHeight: 18,
    padding: Spacing.md,
    backgroundColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    padding: Spacing.xl,
    paddingBottom: Spacing["2xl"],
  },
  modalSheetTall: { maxHeight: "90%" },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.sm },
  modalBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.sm },
  modalWarn: { fontSize: FontSize.xs, color: Colors.warning, marginBottom: Spacing.md, lineHeight: 18 },
  modalRow: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.lg, justifyContent: "flex-end" },
  modalSecondary: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalSecondaryText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.text },
  modalPrimary: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  modalDanger: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.warning,
    minWidth: 120,
    alignItems: "center",
  },
  modalPrimaryText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  modalDangerText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: "#1F2937" },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.text,
    minHeight: 88,
    textAlignVertical: "top",
    marginTop: Spacing.sm,
  },
  reasonRow: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xs,
  },
  reasonRowOn: { borderColor: Colors.primary, backgroundColor: Colors.borderLight },
  reasonText: { fontSize: FontSize.sm, color: Colors.text },
  btnDisabled: { opacity: 0.6 },
});
