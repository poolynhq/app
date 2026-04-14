import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { joinCrewByCode } from "@/lib/crewMessaging";
import { showAlert } from "@/lib/platformAlert";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful join with the crew id. */
  onJoined?: (crewId: string) => void | Promise<void>;
};

export function JoinCrewByCodeModal({ visible, onClose, onJoined }: Props) {
  const [joinCode, setJoinCode] = useState("");
  const [saving, setSaving] = useState(false);

  async function onJoin() {
    const code = joinCode.trim();
    if (!code) {
      showAlert("Code required", "Enter the invite code from your crew organiser.");
      return;
    }
    setSaving(true);
    const res = await joinCrewByCode(code);
    setSaving(false);
    if (!res.ok) {
      showAlert("Could not join", res.reason);
      return;
    }
    setJoinCode("");
    onClose();
    await onJoined?.(res.crewId);
    showAlert("Joined", "Open today’s chat from this list or Messages.");
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !saving && onClose()}>
      <Pressable style={styles.modalBackdrop} onPress={() => !saving && onClose()}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Join crew</Text>
          <TextInput
            style={styles.input}
            placeholder="Invite code"
            placeholderTextColor={Colors.textTertiary}
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="none"
            editable={!saving}
          />
          <View style={styles.modalRow}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={saving}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalOk} onPress={() => void onJoin()} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={Colors.textOnPrimary} />
              ) : (
                <Text style={styles.modalOkText}>Join</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  modalRow: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.sm },
  modalCancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  modalCancelText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  modalOk: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    minWidth: 100,
    alignItems: "center",
  },
  modalOkText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
});
