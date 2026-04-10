import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { prepareAvatarJpegBuffer } from "@/lib/avatarUpload";
import { getCrewStickerPublicUrl, uploadCrewStickerJpeg } from "@/lib/crewStickerUpload";
import { showAlert } from "@/lib/platformAlert";
import {
  fetchCrewRow,
  fetchCrewRoster,
  isCrewOwner,
  removeCrewMemberAsOwner,
  updateCrewSettings,
  type CrewCommutePattern,
  type CrewListRow,
  type CrewRosterMember,
} from "@/lib/crewMessaging";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export default function CrewSettingsScreen() {
  const { crewId } = useLocalSearchParams<{ crewId: string }>();
  const id = typeof crewId === "string" ? crewId : crewId?.[0] ?? "";
  const { profile } = useAuth();
  const userId = profile?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [crew, setCrew] = useState<CrewListRow | null>(null);
  const [owner, setOwner] = useState(false);
  const [roster, setRoster] = useState<CrewRosterMember[]>([]);
  const [name, setName] = useState("");
  const [commutePattern, setCommutePattern] = useState<CrewCommutePattern>("to_work");
  const [localStickerUri, setLocalStickerUri] = useState<string | null>(null);
  const [clearSticker, setClearSticker] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [row, members, isOwner] = await Promise.all([
        fetchCrewRow(id),
        fetchCrewRoster(id),
        userId ? isCrewOwner(id, userId) : Promise.resolve(false),
      ]);
      setCrew(row);
      setRoster(members);
      setOwner(isOwner);
      if (row) {
        setName(row.name);
        setCommutePattern(row.commute_pattern ?? "to_work");
        setLocalStickerUri(null);
        setClearSticker(false);
      }
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    if (!id || !crew) return;
    setSaving(true);
    try {
      let sticker_image_url: string | null | undefined = undefined;
      if (localStickerUri) {
        try {
          const buf = await prepareAvatarJpegBuffer(localStickerUri);
          const up = await uploadCrewStickerJpeg(id, buf);
          if (up.ok) sticker_image_url = getCrewStickerPublicUrl(up.path);
          else showAlert("Sticker upload", up.message);
        } catch (e) {
          showAlert("Sticker upload", e instanceof Error ? e.message : "Could not read image.");
        }
      } else if (clearSticker) {
        sticker_image_url = null;
      }

      const r = await updateCrewSettings({
        crewId: id,
        name: name.trim() || crew.name,
        commute_pattern: commutePattern,
        ...(sticker_image_url !== undefined ? { sticker_image_url } : {}),
      });
      if (!r.ok) {
        showAlert("Could not save", r.reason);
        return;
      }
      showAlert("Saved", "Crew settings updated.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function pickSticker() {
    if (!owner) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      showAlert("Photos", "Allow photo library access to choose a crew sticker.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setLocalStickerUri(result.assets[0].uri);
      setClearSticker(false);
    }
  }

  async function onRemoveMember(targetUserId: string, displayName: string) {
    if (!id) return;
    showAlert(
      `Remove ${displayName}?`,
      "They lose access to this crew and today’s chat. Pending invites are unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setRemovingId(targetUserId);
            const r = await removeCrewMemberAsOwner(id, targetUserId);
            setRemovingId(null);
            if (!r.ok) {
              showAlert("Could not remove", r.reason);
              return;
            }
            await load();
          },
        },
      ]
    );
  }

  async function copyCode() {
    if (!crew?.invite_code) return;
    await Clipboard.setStringAsync(crew.invite_code);
    showAlert("Copied", "Invite code copied to clipboard.");
  }

  if (!id) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.err}>Missing crew.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : !crew ? (
          <Text style={styles.err}>Crew not found or you no longer have access.</Text>
        ) : (
          <>
            <Text style={styles.title}>Crew settings</Text>
            <Text style={styles.sub}>{crew.name}</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Crew name"
              placeholderTextColor={Colors.textTertiary}
              editable={owner}
            />

            <Text style={styles.label}>Commute type</Text>
            <View style={styles.patternRow}>
              {(
                [
                  { id: "to_work" as const, label: "→ Work" },
                  { id: "to_home" as const, label: "→ Home" },
                  { id: "round_trip" as const, label: "Round trip" },
                ] as const
              ).map((opt) => {
                const on = commutePattern === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    style={[styles.chip, on && styles.chipOn, !owner && styles.chipDisabled]}
                    onPress={() => owner && setCommutePattern(opt.id)}
                    disabled={!owner}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {!owner ? (
              <Text style={styles.hint}>Only the crew owner can edit name, type, and sticker.</Text>
            ) : null}

            <View style={styles.divider} />

            <Text style={styles.section}>Invite code</Text>
            <Text style={styles.hint}>
              Share this code with teammates so they can join under Profile → Poolyn Crews.
            </Text>
            <Pressable style={styles.codeRow} onPress={() => void copyCode()}>
              <Text style={styles.codeText}>{crew.invite_code}</Text>
              <Ionicons name="copy-outline" size={20} color={Colors.primary} />
            </Pressable>

            <Text style={styles.section}>Members</Text>
            {roster.map((m) => {
              const isSelf = m.userId === userId;
              const canRemove = owner && !isSelf;
              return (
                <View key={m.userId} style={styles.memberRow}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {(m.fullName || "Member").trim()}
                    {isSelf ? " (you)" : ""}
                  </Text>
                  {canRemove ? (
                    <Pressable
                      style={styles.removeBtn}
                      onPress={() =>
                        void onRemoveMember(m.userId, (m.fullName || "Member").trim())
                      }
                      disabled={removingId === m.userId}
                    >
                      {removingId === m.userId ? (
                        <ActivityIndicator size="small" color={Colors.error} />
                      ) : (
                        <Text style={styles.removeBtnText}>Remove</Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            <View style={styles.divider} />
            <Text style={styles.section}>Team sticker</Text>
            <Text style={styles.hint}>
              Optional square image as the banner on your crew card. JPEG/PNG/WebP, stored in your Poolyn
              workspace.
            </Text>
            <View style={styles.stickerUploadRow}>
              {(() => {
                const displayUri =
                  localStickerUri ?? (clearSticker ? null : crew.sticker_image_url) ?? null;
                return displayUri ? (
                  <Image source={{ uri: displayUri }} style={styles.stickerPreview} resizeMode="cover" />
                ) : (
                  <View style={styles.stickerPreviewPh}>
                    <Ionicons name="image-outline" size={28} color={Colors.textTertiary} />
                  </View>
                );
              })()}
              {owner ? (
                <View style={styles.stickerUploadActions}>
                  <Pressable style={styles.stickerPickBtn} onPress={() => void pickSticker()}>
                    <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
                    <Text style={styles.stickerPickBtnText}>Choose image</Text>
                  </Pressable>
                  {localStickerUri || (!clearSticker && crew.sticker_image_url) ? (
                    <Pressable
                      onPress={() => {
                        if (localStickerUri) setLocalStickerUri(null);
                        else setClearSticker(true);
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.stickerRemoveText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            {owner ? (
              <Pressable
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={() => void onSave()}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save changes</Text>
                )}
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing["3xl"] },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: 4,
  },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.lg },
  err: { fontSize: FontSize.base, color: Colors.error, marginTop: Spacing.lg },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  patternRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: 4 },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipDisabled: { opacity: 0.55 },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  chipTextOn: { color: Colors.primaryDark },
  stickerUploadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  stickerPreview: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.border,
  },
  stickerPreviewPh: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  stickerUploadActions: { flex: 1, gap: Spacing.sm },
  stickerPickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  stickerPickBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  stickerRemoveText: { fontSize: FontSize.sm, color: Colors.error, fontWeight: FontWeight.medium },
  saveBtn: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
    alignItems: "center",
    ...Shadow.sm,
  },
  saveBtnDisabled: { opacity: 0.75 },
  saveBtnText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginTop: Spacing.sm },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xl,
  },
  section: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  codeText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, letterSpacing: 1, color: Colors.text },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  memberName: { flex: 1, fontSize: FontSize.base, color: Colors.text, marginRight: Spacing.md },
  removeBtn: { paddingVertical: 6, paddingHorizontal: Spacing.sm },
  removeBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.error },
});
