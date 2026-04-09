import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Switch,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { showAlert } from "@/lib/platformAlert";
import { prepareAvatarJpegBuffer, uploadUserAvatarJpeg } from "@/lib/avatarUpload";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, extractDomain } from "@/lib/supabase";
import { resolveAvatarDisplayUrl } from "@/lib/avatarStorage";
import { UserRole, Gender, Organisation } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

function phoneDigitsOnly(value: string, maxLen = 10): string {
  return value.replace(/\D/g, "").slice(0, maxLen);
}

const ROLES: { value: UserRole; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "driver", label: "Driver", icon: "car-sport" },
  { value: "passenger", label: "Passenger", icon: "people" },
  { value: "both", label: "Both", icon: "swap-horizontal" },
];

export default function Profile() {
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string | string[] }>();
  const { profile, signOut, refreshProfile, isPlatformSuperAdmin } = useAuth();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(() => phoneDigitsOnly(profile?.phone_number ?? ""));
  const [editGender, setEditGender] = useState<Gender | null>(
    (profile?.gender as Gender) ?? null
  );
  const [editSameGender, setEditSameGender] = useState(
    profile?.same_gender_pref ?? false
  );
  const [saving, setSaving] = useState(false);
  const [roleModal, setRoleModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [nameError, setNameError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [org, setOrg] = useState<Organisation | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  /** True when an organisations row exists for this email domain but user has org_id null (Explorer). */
  const [domainHasWorkplaceOrg, setDomainHasWorkplaceOrg] = useState(false);

  const editParam = params.edit;
  const editFromQuery = Array.isArray(editParam) ? editParam[0] : editParam;

  useEffect(() => {
    if (editFromQuery === "1") {
      setEditing(true);
    }
  }, [editFromQuery]);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setPhone(phoneDigitsOnly(profile?.phone_number ?? ""));
    setEditGender((profile?.gender as Gender) ?? null);
    setEditSameGender(profile?.same_gender_pref ?? false);
  }, [profile]);

  useEffect(() => {
    async function loadOrg() {
      if (!profile?.org_id) {
        setOrg(null);
        return;
      }
      const { data } = await supabase
        .from("organisations").select("*").eq("id", profile.org_id).single();
      setOrg(data ?? null);
    }
    loadOrg();
  }, [profile?.org_id]);

  useEffect(() => {
    async function checkDomainOrg() {
      const domain = profile?.email ? extractDomain(profile.email) : "";
      if (!domain || profile?.org_id) {
        setDomainHasWorkplaceOrg(false);
        return;
      }
      const { data, error } = await supabase.rpc("poolyn_org_exists_for_email_domain", {
        p_domain: domain,
      });
      if (error) {
        setDomainHasWorkplaceOrg(false);
        return;
      }
      setDomainHasWorkplaceOrg(data === true);
    }
    checkDomainOrg();
  }, [profile?.org_id, profile?.email]);

  const initials = (profile?.full_name ?? "?")
    .split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const avatarDisplayUri = resolveAvatarDisplayUrl(profile?.avatar_url);

  const orgDomain = profile?.email ? extractDomain(profile.email) : "";

  const roleLabel =
    profile?.role === "driver" ? "Driver"
    : profile?.role === "passenger" ? "Passenger"
    : "Driver & Passenger";

  async function uploadProfileAvatar(localUri: string): Promise<boolean> {
    if (!profile?.id) return false;
    setAvatarUploading(true);
    try {
      let arrayBuffer: ArrayBuffer;
      try {
        arrayBuffer = await prepareAvatarJpegBuffer(localUri);
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : "Could not read image.";
        showAlert("Upload failed", msg);
        return false;
      }
      const upload = await uploadUserAvatarJpeg(profile.id, arrayBuffer);
      if (!upload.ok) {
        const code = upload.statusCode ? ` (HTTP ${upload.statusCode})` : "";
        let hint = "";
        if (upload.statusCode === "400") {
          hint =
            "\n\nTry again after a full page reload. If it persists, apply the latest Supabase migration for avatars (exact path policy) and confirm you are signed in.";
        } else if (upload.statusCode === "403") {
          hint =
            "\n\nThe server blocked this upload. Check avatar storage policies: signed-in users should be allowed to add and replace files only inside their own top-level folder in the avatars bucket.";
        } else if (upload.statusCode === "503" || upload.statusCode === "502") {
          hint =
            "\n\nGateway error: check the Supabase status page, that the project is not paused, and try again shortly.";
        }
        showAlert("Upload failed", `${upload.message}${code}.${hint}`);
        return false;
      }
      const path = upload.path;
      const { error: dbErr } = await supabase
        .from("users")
        .update({ avatar_url: path })
        .eq("id", profile.id);
      if (dbErr) {
        showAlert(
          "Update failed",
          dbErr.message ||
            "Photo was saved to storage but your profile could not be updated."
        );
        return false;
      }
      await refreshProfile();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Please try again.";
      showAlert("Upload failed", msg);
      return false;
    } finally {
      setAvatarUploading(false);
    }
  }

  async function pickProfilePhoto(useCamera: boolean) {
    const permMethod = useCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { granted } = await permMethod();
    if (!granted) {
      showAlert(
        "Permission needed",
        `Allow access to your ${useCamera ? "camera" : "photo library"} to set a profile photo.`
      );
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.72,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.72,
        });
    if (result.canceled || !result.assets[0]?.uri) return;
    await uploadProfileAvatar(result.assets[0].uri);
  }

  function showAvatarOptions() {
    if (Platform.OS === "web") {
      void pickProfilePhoto(false);
      return;
    }
    showAlert("Profile photo", "How would you like to add a photo?", [
      { text: "Take a photo", onPress: () => void pickProfilePhoto(true) },
      { text: "Choose from gallery", onPress: () => void pickProfilePhoto(false) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function handleSaveProfile() {
    if (!profile?.id) return;
    setNameError(""); setPhoneError(""); setSaveSuccess(false);
    if (!fullName.trim()) { setNameError("Name cannot be empty."); return; }
    const digits = phoneDigitsOnly(phone);
    if (digits.length > 0 && digits.length < 10) {
      setPhoneError("Enter all 10 digits of your phone number.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("users").update({
      full_name: fullName.trim(),
      phone_number: digits.length === 10 ? digits : null,
      gender: editGender,
      same_gender_pref: editSameGender,
    }).eq("id", profile.id);
    if (error) {
      setSaving(false);
      showAlert("Update failed", "Could not save your profile. Please try again.");
      return;
    }
    await refreshProfile();
    setSaving(false); setEditing(false); setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  async function handleRoleChange(newRole: UserRole) {
    if (!profile?.id) return;
    const { error } = await supabase.from("users").update({ role: newRole }).eq("id", profile.id);
    if (error) { showAlert("Update failed", "Could not change your role. Please try again."); return; }
    await refreshProfile();
    setRoleModal(false);
  }

  function handleSignOut() {
    showAlert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
        },
      },
    ]);
  }

  const checks = [
    { done: !!profile?.full_name, label: "Full name" },
    { done: !!profile?.phone_number, label: "Phone number" },
    { done: !!profile?.avatar_url, label: "Profile photo" },
    { done: !!profile?.gender, label: "Gender" },
    { done: !!profile?.work_location_label, label: "Work location set" },
  ];
  const completedCount = checks.filter((c) => c.done).length;
  const completionPct = Math.round((completedCount / checks.length) * 100);

  const menuSections = [
    ...(isPlatformSuperAdmin
      ? [
          {
            title: "OPERATIONS",
            items: [
              {
                icon: "shield-checkmark-outline" as const,
                label: "Platform directory (super admin)",
                route: "/super-admin",
              },
            ],
          },
        ]
      : []),
    {
      title: "SETTINGS",
      items: [
        { icon: "car-outline" as const, label: "My vehicles", route: "/(tabs)/profile/vehicles" },
        { icon: "calendar-outline" as const, label: "Schedule", route: "/(tabs)/profile/schedule" },
        {
          icon: "map-outline" as const,
          label: "Commute & pickup",
          route: "/(tabs)/profile/commute-locations",
        },
        ...(profile?.role === "driver" || profile?.role === "both"
          ? [
              {
                icon: "options-outline" as const,
                label: "Driver preferences",
                route: "/(tabs)/profile/preferences",
              },
            ]
          : []),
        { icon: "notifications-outline" as const, label: "Notifications", route: "/(tabs)/profile/notifications" },
        { icon: "pulse-outline" as const, label: "Activity", route: "/(tabs)/profile/activity" },
        { icon: "chatbubbles-outline" as const, label: "Ride messages", route: "/(tabs)/messages" },
        { icon: "dice-outline" as const, label: "Poolyn Crews", route: "/(tabs)/profile/crews" },
        ...(profile?.org_id
          ? [
              {
                icon: "business-outline" as const,
                label: "Workplace network",
                route: "/(tabs)/profile/workplace-network",
              },
              {
                icon: "git-network-outline" as const,
                label: "Route groups",
                route: "/(tabs)/profile/route-groups",
              },
            ]
          : []),
        { icon: "people-outline" as const, label: "Emergency contacts", route: "/(tabs)/profile/emergency-contacts" },
      ],
    },
    {
      title: "SUPPORT",
      items: [
        { icon: "help-circle-outline" as const, label: "Help & FAQ", route: "/(tabs)/profile/help-faq" },
        { icon: "document-text-outline" as const, label: "Terms & Conditions", route: "/(tabs)/profile/terms" },
        { icon: "shield-checkmark-outline" as const, label: "Privacy Policy", route: "/(tabs)/profile/privacy" },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Avatar + name */}
        <View style={styles.profileHeader}>
          <TouchableOpacity
            style={styles.avatarWrap}
            activeOpacity={0.75}
            onPress={showAvatarOptions}
            disabled={avatarUploading}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <View style={styles.avatarDisc} pointerEvents="none">
              {avatarDisplayUri ? (
                <Image source={{ uri: avatarDisplayUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
              {avatarUploading ? (
                <View style={styles.avatarLoading}>
                  <ActivityIndicator color={Colors.textOnPrimary} />
                </View>
              ) : null}
            </View>
            <View style={styles.avatarFab} pointerEvents="none">
              <Ionicons name="camera" size={17} color={Colors.textOnPrimary} />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Tap photo or camera to upload</Text>

          {editing ? (
            <View style={styles.editFields}>
              <TextInput
                style={[styles.editInput, nameError ? styles.editInputError : null]}
                value={fullName}
                onChangeText={(t) => { setFullName(t); if (nameError) setNameError(""); }}
                placeholder="Full name"
                placeholderTextColor={Colors.textTertiary}
                autoFocus
              />
              {nameError ? <Text style={styles.fieldError}>{nameError}</Text> : null}
              <TextInput
                style={[styles.editInput, phoneError ? styles.editInputError : null]}
                value={phone}
                onChangeText={(t) => {
                  setPhone(phoneDigitsOnly(t));
                  if (phoneError) setPhoneError("");
                }}
                placeholder="10-digit phone number"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="phone-pad"
                maxLength={10}
              />
              {phoneError ? <Text style={styles.fieldError}>{phoneError}</Text> : null}

              <Text style={styles.editFieldLabel}>Gender</Text>
              <View style={styles.genderRow}>
                {GENDERS.map((g) => {
                  const active = editGender === g.value;
                  return (
                    <TouchableOpacity
                      key={g.value}
                      style={[styles.genderChip, active && styles.genderChipActive]}
                      onPress={() => setEditGender(active ? null : g.value)}
                    >
                      <Text style={[styles.genderChipText, active && styles.genderChipTextActive]}>
                        {g.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {editGender && editGender !== "prefer_not_to_say" && (
                <View style={styles.sameGenderRow}>
                  <Text style={styles.sameGenderLabel}>Same-gender matching only</Text>
                  <Switch
                    value={editSameGender}
                    onValueChange={setEditSameGender}
                    trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                    thumbColor={editSameGender ? Colors.primary : Colors.surface}
                  />
                </View>
              )}

              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.editCancel}
                  onPress={() => {
                    setEditing(false);
                    setFullName(profile?.full_name ?? "");
                    setPhone(phoneDigitsOnly(profile?.phone_number ?? ""));
                    setEditGender((profile?.gender as Gender) ?? null);
                    setEditSameGender(profile?.same_gender_pref ?? false);
                    setNameError(""); setPhoneError("");
                  }}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editSave, saving && { opacity: 0.7 }]}
                  onPress={handleSaveProfile}
                  disabled={saving}
                >
                  <Text style={styles.editSaveText}>{saving ? "Saving..." : "Save"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.nameSection}>
              <Text style={styles.name}>{profile?.full_name || "Add your name"}</Text>
              <Text style={styles.email}>{profile?.email}</Text>
              {profile?.phone_number ? (
                <Text style={styles.phone}>{profile.phone_number}</Text>
              ) : (
                <Text style={styles.phoneMissing}>No phone number added</Text>
              )}
              {profile?.gender && (
                <Text style={styles.phone}>
                  {GENDER_LABELS[profile.gender] ?? profile.gender}
                  {profile.same_gender_pref ? " · Same-gender matching on" : ""}
                </Text>
              )}
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                <Ionicons name="create-outline" size={16} color={Colors.primary} />
                <Text style={styles.editBtnText}>Edit profile</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {saveSuccess && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
            <Text style={styles.successBannerText}>Profile updated</Text>
          </View>
        )}

        {/* Role */}
        <TouchableOpacity style={styles.roleCard} onPress={() => setRoleModal(true)} activeOpacity={0.7}>
          <View style={styles.roleLeft}>
            <Ionicons
              name={profile?.role === "driver" ? "car-sport" : profile?.role === "passenger" ? "people" : "swap-horizontal"}
              size={22}
              color={Colors.primary}
            />
            <View>
              <Text style={styles.roleLabel}>Your role</Text>
              <Text style={styles.roleValue}>{roleLabel}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
        </TouchableOpacity>

        {/* Completion bar */}
        {completionPct < 100 && (
          <View style={styles.completionCard}>
            <View style={styles.completionHeader}>
              <Text style={styles.completionTitle}>Profile completion</Text>
              <Text style={styles.completionPct}>{completionPct}%</Text>
            </View>
            <View style={styles.completionBar}>
              <View style={[styles.completionBarFill, { width: `${completionPct}%` }]} />
            </View>
            {checks.filter((c) => !c.done).map((item, i) => (
              <View key={i} style={styles.completionItem}>
                <Ionicons name="ellipse-outline" size={14} color={Colors.textTertiary} />
                <Text style={styles.completionItemText}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile?.points_balance ?? 0}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile?.flex_credits_balance ?? 3}</Text>
            <Text style={styles.statLabel}>Flex Credits</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Rides</Text>
          </View>
        </View>

        {/* Organisation */}
        <View style={styles.infoCard}>
          <Ionicons name="business-outline" size={20} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Organisation</Text>
            {!profile?.org_id ? (
              <>
                <Text style={styles.infoValue}>{orgDomain || "—"}</Text>
                {domainHasWorkplaceOrg ? (
                  <Text style={styles.orgSubValue}>
                    A workplace network exists for this email domain, but you are not a member. Ask your
                    admin to invite you or add you from their team dashboard if you want to join.
                  </Text>
                ) : (
                  <Text style={styles.orgSubValue}>
                    Independent (Explorer). You are not part of a workplace network on Poolyn.
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text style={styles.infoValue}>{org?.name?.trim() || orgDomain}</Text>
                <Text style={styles.orgSubValue}>
                  {org?.org_type === "enterprise"
                    ? "Verified organization member"
                    : "Community network member"}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Menu sections */}
        {menuSections.map((section, si) => (
          <View key={si} style={styles.menuSection}>
            <Text style={styles.menuSectionTitle}>{section.title}</Text>
            <View style={styles.menuCard}>
              {section.items.map((item, ii) => (
                <TouchableOpacity
                  key={ii}
                  style={[styles.menuItem, ii < section.items.length - 1 && styles.menuItemBorder]}
                  activeOpacity={0.6}
                  onPress={() => router.push(item.route as any)}
                >
                  <Ionicons name={item.icon} size={22} color={Colors.text} />
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Sign out */}
        <TouchableOpacity
          style={[styles.signOutBtn, signingOut && { opacity: 0.6 }]}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={22} color={Colors.error} />
          <Text style={styles.signOutText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Poolyn v0.1.0</Text>

        {/* Role switch modal */}
        <Modal visible={roleModal} transparent animationType="fade" onRequestClose={() => setRoleModal(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRoleModal(false)}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Change your role</Text>
              <Text style={styles.modalDesc}>This affects what actions are available to you. You can switch anytime.</Text>
              {ROLES.map((role) => {
                const isActive = profile?.role === role.value;
                return (
                  <TouchableOpacity
                    key={role.value}
                    style={[styles.modalOption, isActive && styles.modalOptionActive]}
                    onPress={() => handleRoleChange(role.value)}
                  >
                    <Ionicons name={role.icon} size={22} color={isActive ? Colors.primary : Colors.textSecondary} />
                    <Text style={[styles.modalOptionText, isActive && styles.modalOptionTextActive]}>{role.label}</Text>
                    {isActive && <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={styles.modalClose} onPress={() => setRoleModal(false)}>
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.base, paddingBottom: Spacing["4xl"] },
  profileHeader: { alignItems: "center", marginBottom: Spacing.xl },
  avatarWrap: {
    width: 96,
    height: 96,
    marginBottom: Spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarDisc: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    ...Shadow.md,
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarText: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
  avatarLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarFab: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.secondary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: Colors.background,
    zIndex: 4,
    ...Shadow.md,
  },
  avatarHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  nameSection: { alignItems: "center" },
  name: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: 2 },
  email: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 2 },
  phone: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  phoneMissing: { fontSize: FontSize.sm, color: Colors.textTertiary, fontStyle: "italic", marginBottom: Spacing.sm },
  editBtn: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.full, backgroundColor: Colors.primaryLight },
  editBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.primary },
  editFields: { width: "100%", gap: Spacing.sm },
  editInput: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, height: 48, fontSize: FontSize.base, color: Colors.text },
  editInputError: { borderColor: Colors.error },
  fieldError: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs, marginBottom: Spacing.xs },
  successBanner: { flexDirection: "row", alignItems: "center", backgroundColor: "#e6f9ed", borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.lg },
  successBannerText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.success },
  editFieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.text, marginBottom: Spacing.sm },
  genderRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginBottom: Spacing.sm },
  genderChip: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.full, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border },
  genderChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  genderChipText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  genderChipTextActive: { color: Colors.primaryDark, fontWeight: FontWeight.semibold },
  sameGenderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  sameGenderLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.text },
  editActions: { flexDirection: "row", gap: Spacing.sm },
  editCancel: { flex: 1, height: 44, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, justifyContent: "center", alignItems: "center" },
  editCancelText: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  editSave: { flex: 1, height: 44, borderRadius: BorderRadius.sm, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center" },
  editSaveText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  roleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.lg, ...Shadow.sm },
  roleLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  roleLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  roleValue: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  completionCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.lg, ...Shadow.sm },
  completionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.sm },
  completionTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  completionPct: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.primary },
  completionBar: { height: 6, backgroundColor: Colors.borderLight, borderRadius: 3, marginBottom: Spacing.md },
  completionBarFill: { height: "100%", backgroundColor: Colors.primary, borderRadius: 3 },
  completionItem: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 3 },
  completionItemText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  statsRow: { flexDirection: "row", backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.text },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border },
  infoCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md, marginBottom: Spacing.xl, ...Shadow.sm },
  infoLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  infoValue: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.text },
  orgSubValue: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  menuSection: { marginBottom: Spacing.lg },
  menuSectionTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.textSecondary, marginBottom: Spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  menuCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm },
  menuItem: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.base, paddingHorizontal: Spacing.base, gap: Spacing.md },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  menuLabel: { flex: 1, fontSize: FontSize.base, color: Colors.text },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, paddingVertical: Spacing.base, marginTop: Spacing.sm, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.errorLight, backgroundColor: Colors.errorLight },
  signOutText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.error },
  version: { textAlign: "center", fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: "center", paddingHorizontal: Spacing["2xl"] },
  modalContent: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, padding: Spacing.xl },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.xs },
  modalDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xl, lineHeight: 20 },
  modalOption: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.base, borderRadius: BorderRadius.md, marginBottom: Spacing.sm, borderWidth: 1.5, borderColor: Colors.border },
  modalOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  modalOptionText: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  modalOptionTextActive: { color: Colors.primaryDark },
  modalClose: { alignItems: "center", paddingVertical: Spacing.md, marginTop: Spacing.sm },
  modalCloseText: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.textSecondary },
});
