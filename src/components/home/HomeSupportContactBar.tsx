import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SUPPORT_ISSUE_CATEGORIES,
  submitSupportContact,
  type SupportIssueCategory,
} from "@/lib/submitSupportContact";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export function HomeSupportContactBar() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportIssueCategory | null>(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const canSend =
    category !== null && message.trim().length >= 8 && message.trim().length <= 6000 && !sending;

  async function onSend() {
    if (!category || !canSend) return;
    setSending(true);
    setBanner(null);
    const res = await submitSupportContact({ category, message: message.trim() });
    setSending(false);
    if (res.ok) {
      setBanner({ type: "ok", text: "Sent. We will get back to you at your account email." });
      setMessage("");
      setCategory(null);
    } else {
      setBanner({ type: "err", text: res.error });
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.shell}>
        <TouchableOpacity
          style={styles.chatBar}
          onPress={() => setOpen((v) => !v)}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? "Hide contact form" : "Show contact form"}
        >
          <View style={styles.chatBarLeft}>
            <View style={styles.chatIconWrap}>
              <Ionicons name="chatbubbles-outline" size={20} color={Colors.primaryDark} />
            </View>
            <View style={styles.chatBarTextCol}>
              <Text style={styles.chatBarTitle}>Contact us</Text>
              <Text style={styles.chatBarSub} numberOfLines={1}>
                Message Poolyn HQ (same inbox for every topic)
              </Text>
            </View>
          </View>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={22} color={Colors.textSecondary} />
        </TouchableOpacity>

        {open ? (
          <View style={styles.formBlock}>
          {banner ? (
            <Text
              style={[styles.banner, banner.type === "ok" ? styles.bannerOk : styles.bannerErr]}
            >
              {banner.text}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>What do you need help with?</Text>
          <TouchableOpacity
            style={styles.selectRow}
            onPress={() => setCategoryModal(true)}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Choose topic"
          >
            <Text
              style={[styles.selectValue, !category && styles.selectPlaceholder]}
              numberOfLines={2}
            >
              {category ?? "Choose a topic"}
            </Text>
            <Ionicons name="chevron-down" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>Details</Text>
          <TextInput
            style={styles.input}
            multiline
            textAlignVertical="top"
            placeholder="Describe what happened or what you need. Include dates or ride names if it helps."
            placeholderTextColor={Colors.textTertiary}
            value={message}
            onChangeText={setMessage}
            maxLength={6000}
          />

          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={() => void onSend()}
            disabled={!canSend}
            activeOpacity={0.88}
          >
            {sending ? (
              <ActivityIndicator color={Colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="send" size={18} color={Colors.textOnPrimary} />
                <Text style={styles.sendBtnText}>Send to Poolyn</Text>
              </>
            )}
          </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <Modal visible={categoryModal} transparent animationType="fade" onRequestClose={() => setCategoryModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCategoryModal(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Choose a topic</Text>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {SUPPORT_ISSUE_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={styles.modalOption}
                  onPress={() => {
                    setCategory(c);
                    setCategoryModal(false);
                  }}
                  activeOpacity={0.78}
                >
                  <Text style={styles.modalOptionText}>{c}</Text>
                  {category === c ? (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setCategoryModal(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.md,
  },
  shell: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: "rgba(11,132,87,0.22)",
    overflow: "hidden",
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  chatBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.primaryLight,
  },
  chatBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
    minWidth: 0,
    paddingRight: Spacing.sm,
  },
  chatIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(11,132,87,0.15)",
  },
  chatBarTextCol: {
    flex: 1,
    minWidth: 0,
  },
  chatBarTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  chatBarSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  formBlock: {
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  banner: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  bannerOk: { color: Colors.primaryDark },
  bannerErr: { color: Colors.error },
  fieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    marginBottom: Spacing.md,
  },
  selectValue: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  selectPlaceholder: {
    color: Colors.textTertiary,
  },
  input: {
    minHeight: 100,
    maxHeight: 220,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    fontSize: FontSize.sm,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textOnPrimary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    maxHeight: "80%",
  },
  modalTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  modalScroll: {
    maxHeight: 360,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  modalOptionText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  modalClose: {
    marginTop: Spacing.md,
    alignSelf: "center",
    paddingVertical: Spacing.sm,
  },
  modalCloseText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
});
