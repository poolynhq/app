import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { EmergencyContact } from "@/types/database";
import {
  Colors, Spacing, BorderRadius, FontSize, FontWeight, Shadow,
} from "@/constants/theme";

type FormState = { name: string; phone: string; relationship: string };
const EMPTY_FORM: FormState = { name: "", phone: "", relationship: "" };

export default function EmergencyContactsScreen() {
  const { profile } = useAuth();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("emergency_contacts")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: true });
    setContacts(data ?? []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setShowForm(true);
  }

  function openEdit(c: EmergencyContact) {
    setEditingId(c.id);
    setForm({ name: c.name, phone: c.phone_number, relationship: c.relationship ?? "" });
    setErrors({});
    setShowForm(true);
  }

  function validate(): boolean {
    const e: Partial<FormState> = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.phone.trim()) e.phone = "Phone number is required";
    else if (!/^\+?[\d\s\-()]{7,20}$/.test(form.phone.trim())) e.phone = "Enter a valid phone number";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!profile?.id || !validate()) return;
    setSaving(true);
    const payload = { name: form.name.trim(), phone_number: form.phone.trim(), relationship: form.relationship.trim() || null };

    if (editingId) {
      const { error } = await supabase.from("emergency_contacts").update(payload).eq("id", editingId);
      if (error) { showAlert("Error", "Could not update contact."); setSaving(false); return; }
    } else {
      const { error } = await supabase.from("emergency_contacts").insert({ ...payload, user_id: profile.id });
      if (error) { showAlert("Error", "Could not add contact."); setSaving(false); return; }
    }
    setSaving(false);
    setShowForm(false);
    load();
  }

  function handleDelete(c: EmergencyContact) {
    showAlert("Remove contact", `Remove ${c.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await supabase.from("emergency_contacts").delete().eq("id", c.id);
          load();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={18} color={Colors.primary} />
          <Text style={styles.infoText}>
            Emergency contacts can be notified in case of a safety incident during a ride. We recommend adding at least one trusted contact.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {contacts.length === 0 && !showForm && (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>No emergency contacts</Text>
                <Text style={styles.emptyBody}>Add a trusted person who can be contacted if something goes wrong during a ride.</Text>
              </View>
            )}

            {contacts.map((c) => (
              <View key={c.id} style={styles.contactCard}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {c.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                  </Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  <Text style={styles.contactMeta}>{c.phone_number}{c.relationship ? ` · ${c.relationship}` : ""}</Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => openEdit(c)} style={styles.actionBtn}>
                    <Ionicons name="create-outline" size={20} color={Colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(c)} style={styles.actionBtn}>
                    <Ionicons name="trash-outline" size={20} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {showForm ? (
              <View style={styles.form}>
                <Text style={styles.formTitle}>{editingId ? "Edit contact" : "Add contact"}</Text>

                <FormField label="Full name *" error={errors.name}>
                  <TextInput
                    style={[styles.input, errors.name && styles.inputError]}
                    value={form.name}
                    onChangeText={(t) => { setForm((f) => ({ ...f, name: t })); setErrors((e) => ({ ...e, name: undefined })); }}
                    placeholder="e.g. Jane Smith"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="words"
                  />
                </FormField>
                <FormField label="Phone number *" error={errors.phone}>
                  <TextInput
                    style={[styles.input, errors.phone && styles.inputError]}
                    value={form.phone}
                    onChangeText={(t) => { setForm((f) => ({ ...f, phone: t })); setErrors((e) => ({ ...e, phone: undefined })); }}
                    placeholder="e.g. +61 412 345 678"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="phone-pad"
                  />
                </FormField>
                <FormField label="Relationship">
                  <TextInput
                    style={styles.input}
                    value={form.relationship}
                    onChangeText={(t) => setForm((f) => ({ ...f, relationship: t }))}
                    placeholder="e.g. Partner, Parent, Colleague"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="sentences"
                  />
                </FormField>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save contact"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              contacts.length < 3 && (
                <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.7}>
                  <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                  <Text style={styles.addBtnText}>Add emergency contact</Text>
                </TouchableOpacity>
              )
            )}

            {contacts.length >= 3 && !showForm && (
              <Text style={styles.limitNote}>
                You have {contacts.length} emergency contacts (maximum 3). Edit or remove one to add another.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.md }}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
      {error ? <Text style={fieldStyles.error}>{error}</Text> : null}
    </View>
  );
}
const fieldStyles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.text, marginBottom: 6 },
  error: { fontSize: FontSize.xs, color: Colors.error, marginTop: 4 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  infoBox: { flexDirection: "row", gap: Spacing.sm, backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.xl, alignItems: "flex-start" },
  infoText: { flex: 1, fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
  emptyState: { alignItems: "center", paddingVertical: Spacing["3xl"] },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text, marginTop: Spacing.md },
  emptyBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm, maxWidth: 280 },
  contactCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md, ...Shadow.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center" },
  avatarText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.textOnPrimary },
  info: { flex: 1 },
  contactName: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  contactMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: "row", gap: Spacing.sm },
  actionBtn: { width: 36, height: 36, borderRadius: BorderRadius.sm, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  form: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, padding: Spacing.xl, marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm },
  formTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.xl },
  input: { backgroundColor: Colors.inputBackground, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, height: 48, fontSize: FontSize.base, color: Colors.text },
  inputError: { borderColor: Colors.error },
  formActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.lg },
  cancelBtn: { flex: 1, height: 48, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, justifyContent: "center", alignItems: "center" },
  cancelBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  saveBtn: { flex: 2, height: 48, borderRadius: BorderRadius.sm, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center" },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, paddingVertical: Spacing.base, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryLight, marginTop: Spacing.md },
  addBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.primary },
  limitNote: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.lg, fontStyle: "italic" },
});
