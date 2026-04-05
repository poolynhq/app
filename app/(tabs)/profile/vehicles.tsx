import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Vehicle } from "@/types/database";
import { VehicleSelectModal } from "@/components/VehicleSelectModal";
import {
  OTHER_MAKE_LABEL,
  VEHICLE_MAKES_SORTED,
  VEHICLE_MODELS_BY_MAKE,
} from "@/constants/vehicleCatalog";
import {
  Colors, Spacing, BorderRadius, FontSize, FontWeight, Shadow,
} from "@/constants/theme";

type ListModalConfig = {
  title: string;
  options: string[];
  selected: string;
  onPick: (value: string) => void;
};

type FormState = {
  make: string;
  model: string;
  colour: string;
  plate: string;
  seats: string;
};

const EMPTY_FORM: FormState = { make: "", model: "", colour: "", plate: "", seats: "4" };

export default function VehiclesScreen() {
  const { profile } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [customMake, setCustomMake] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [listModal, setListModal] = useState<ListModalConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<FormState>>({});

  const makeOptions = useMemo(() => [...VEHICLE_MAKES_SORTED, OTHER_MAKE_LABEL], []);
  const modelOptions = useMemo(() => {
    if (!form.make || form.make === OTHER_MAKE_LABEL) return [];
    return VEHICLE_MODELS_BY_MAKE[form.make] ?? [];
  }, [form.make]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("vehicles")
      .select("*")
      .eq("user_id", profile.id)
      .eq("active", true)
      .order("created_at", { ascending: false });
    setVehicles(data ?? []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCustomMake("");
    setCustomModel("");
    setListModal(null);
    setErrors({});
    setShowForm(true);
  }

  function openEdit(v: Vehicle) {
    setEditingId(v.id);
    const makeT = v.make.trim();
    const inCatalog = VEHICLE_MAKES_SORTED.includes(makeT);
    if (inCatalog) {
      setForm({
        make: makeT,
        model: v.model.trim(),
        colour: v.colour ?? "",
        plate: v.plate ?? "",
        seats: String(v.seats),
      });
      setCustomMake("");
      setCustomModel("");
    } else {
      setForm({
        make: OTHER_MAKE_LABEL,
        model: "",
        colour: v.colour ?? "",
        plate: v.plate ?? "",
        seats: String(v.seats),
      });
      setCustomMake(makeT);
      setCustomModel(v.model.trim());
    }
    setListModal(null);
    setErrors({});
    setShowForm(true);
  }

  function validate(): boolean {
    const e: Partial<FormState> = {};
    const resolvedMake = form.make === OTHER_MAKE_LABEL ? customMake.trim() : form.make.trim();
    const resolvedModel = form.make === OTHER_MAKE_LABEL ? customModel.trim() : form.model.trim();
    if (!resolvedMake) e.make = "Make is required";
    if (!resolvedModel) e.model = "Model is required";
    const s = parseInt(form.seats, 10);
    if (isNaN(s) || s < 1 || s > 9) e.seats = "Seats must be 1–9";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!profile?.id || !validate()) return;
    setSaving(true);
    const resolvedMake = form.make === OTHER_MAKE_LABEL ? customMake.trim() : form.make.trim();
    const resolvedModel = form.make === OTHER_MAKE_LABEL ? customModel.trim() : form.model.trim();
    const payload = {
      make: resolvedMake,
      model: resolvedModel,
      colour: form.colour.trim() || null,
      plate: form.plate.trim().toUpperCase() || null,
      seats: parseInt(form.seats, 10),
    };

    if (editingId) {
      const { error } = await supabase.from("vehicles").update(payload).eq("id", editingId);
      if (error) { showAlert("Error", "Could not update vehicle."); setSaving(false); return; }
    } else {
      const { error } = await supabase.from("vehicles").insert({ ...payload, user_id: profile.id });
      if (error) { showAlert("Error", "Could not add vehicle."); setSaving(false); return; }
    }
    setSaving(false);
    setShowForm(false);
    load();
  }

  function handleDelete(v: Vehicle) {
    showAlert("Remove vehicle", `Remove ${v.make} ${v.model}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await supabase.from("vehicles").update({ active: false }).eq("id", v.id);
          load();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {vehicles.length === 0 && !showForm && (
              <View style={styles.emptyState}>
                <Ionicons name="car-outline" size={48} color={Colors.textTertiary} />
                <Text style={styles.emptyTitle}>No vehicles yet</Text>
                <Text style={styles.emptyBody}>Add your car to start offering rides as a driver.</Text>
              </View>
            )}

            {vehicles.map((v) => (
              <View key={v.id} style={styles.vehicleCard}>
                <View style={styles.vehicleIcon}>
                  <Ionicons name="car-sport" size={26} color={Colors.primary} />
                </View>
                <View style={styles.vehicleInfo}>
                  <Text style={styles.vehicleName}>{v.make} {v.model}</Text>
                  <Text style={styles.vehicleMeta}>
                    {[v.colour, v.plate, `${v.seats} seats`].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View style={styles.vehicleActions}>
                  <TouchableOpacity onPress={() => openEdit(v)} style={styles.actionBtn}>
                    <Ionicons name="create-outline" size={20} color={Colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(v)} style={styles.actionBtn}>
                    <Ionicons name="trash-outline" size={20} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {showForm ? (
              <View style={styles.form}>
                <Text style={styles.formTitle}>{editingId ? "Edit vehicle" : "Add vehicle"}</Text>

                <Field label="Make *" error={errors.make}>
                  <TouchableOpacity
                    style={[styles.select, errors.make && styles.inputError]}
                    onPress={() =>
                      setListModal({
                        title: "Select make",
                        options: makeOptions,
                        selected: form.make,
                        onPick: (v) => {
                          setForm((f) => ({ ...f, make: v, model: "" }));
                          setCustomMake("");
                          setCustomModel("");
                          setErrors((er) => ({ ...er, make: undefined }));
                        },
                      })
                    }
                    activeOpacity={0.75}
                  >
                    <Text
                      style={form.make ? styles.selectValue : styles.selectPlaceholder}
                      numberOfLines={1}
                    >
                      {form.make || "Select make"}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
                  </TouchableOpacity>
                </Field>

                {form.make === OTHER_MAKE_LABEL ? (
                  <View style={styles.customRow}>
                    <View style={{ flex: 1 }}>
                      <Field label="Make (custom) *" error={errors.make}>
                        <TextInput
                          style={[styles.input, errors.make && styles.inputError]}
                          value={customMake}
                          onChangeText={(t) => {
                            setCustomMake(t);
                            setErrors((er) => ({ ...er, make: undefined }));
                          }}
                          placeholder="e.g. Morgan"
                          placeholderTextColor={Colors.textTertiary}
                        />
                      </Field>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Model (custom) *" error={errors.model}>
                        <TextInput
                          style={[styles.input, errors.model && styles.inputError]}
                          value={customModel}
                          onChangeText={(t) => {
                            setCustomModel(t);
                            setErrors((er) => ({ ...er, model: undefined }));
                          }}
                          placeholder="e.g. Plus 4"
                          placeholderTextColor={Colors.textTertiary}
                        />
                      </Field>
                    </View>
                  </View>
                ) : (
                  <Field label="Model *" error={errors.model}>
                    <TouchableOpacity
                      style={[
                        styles.select,
                        errors.model && styles.inputError,
                        !form.make && styles.selectDisabled,
                      ]}
                      disabled={!form.make}
                      onPress={() => {
                        if (!form.make || modelOptions.length === 0) return;
                        setListModal({
                          title: `Models: ${form.make}`,
                          options: modelOptions,
                          selected: form.model,
                          onPick: (v) => {
                            setForm((f) => ({ ...f, model: v }));
                            setErrors((er) => ({ ...er, model: undefined }));
                          },
                        });
                      }}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={form.model ? styles.selectValue : styles.selectPlaceholder}
                        numberOfLines={1}
                      >
                        {!form.make ? "Select make first" : form.model || "Select model"}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
                    </TouchableOpacity>
                  </Field>
                )}
                <Field label="Colour">
                  <TextInput
                    style={styles.input}
                    value={form.colour}
                    onChangeText={(t) => setForm((f) => ({ ...f, colour: t }))}
                    placeholder="e.g. Silver"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </Field>
                <Field label="Number plate">
                  <TextInput
                    style={styles.input}
                    value={form.plate}
                    onChangeText={(t) => setForm((f) => ({ ...f, plate: t }))}
                    placeholder="e.g. ABC123"
                    placeholderTextColor={Colors.textTertiary}
                    autoCapitalize="characters"
                  />
                </Field>
                <Field label="Passenger seats *" error={errors.seats}>
                  <View style={styles.seatsRow}>
                    {[1,2,3,4,5,6,7].map((n) => (
                      <TouchableOpacity
                        key={n}
                        style={[styles.seatChip, form.seats === String(n) && styles.seatChipActive]}
                        onPress={() => setForm((f) => ({ ...f, seats: String(n) }))}
                      >
                        <Text style={[styles.seatChipText, form.seats === String(n) && styles.seatChipTextActive]}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Field>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save vehicle"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                <Text style={styles.addBtnText}>Add a vehicle</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      <VehicleSelectModal
        visible={listModal != null}
        title={listModal?.title ?? ""}
        options={listModal?.options ?? []}
        selectedValue={listModal?.selected ?? ""}
        onClose={() => setListModal(null)}
        onSelect={(v) => listModal?.onPick(v)}
      />
    </SafeAreaView>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
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
  emptyState: { alignItems: "center", paddingVertical: Spacing["3xl"] },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.text, marginTop: Spacing.md },
  emptyBody: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm, maxWidth: 260 },
  vehicleCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.base, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md, ...Shadow.sm },
  vehicleIcon: { width: 48, height: 48, borderRadius: BorderRadius.md, backgroundColor: Colors.primaryLight, justifyContent: "center", alignItems: "center" },
  vehicleInfo: { flex: 1 },
  vehicleName: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  vehicleMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  vehicleActions: { flexDirection: "row", gap: Spacing.sm },
  actionBtn: { width: 36, height: 36, borderRadius: BorderRadius.sm, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  form: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, padding: Spacing.xl, marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm },
  formTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.xl },
  select: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    ...Shadow.sm,
  },
  selectDisabled: { opacity: 0.5 },
  selectPlaceholder: { fontSize: FontSize.base, color: Colors.textTertiary, flex: 1 },
  selectValue: { fontSize: FontSize.base, color: Colors.text, flex: 1 },
  customRow: { flexDirection: "row", gap: Spacing.sm },
  input: { backgroundColor: Colors.inputBackground, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, height: 48, fontSize: FontSize.base, color: Colors.text },
  inputError: { borderColor: Colors.error },
  seatsRow: { flexDirection: "row", gap: Spacing.sm, flexWrap: "wrap" },
  seatChip: { width: 44, height: 44, borderRadius: BorderRadius.sm, borderWidth: 1.5, borderColor: Colors.border, justifyContent: "center", alignItems: "center", backgroundColor: Colors.surface },
  seatChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  seatChipText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  seatChipTextActive: { color: Colors.primaryDark },
  formActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.lg },
  cancelBtn: { flex: 1, height: 48, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, justifyContent: "center", alignItems: "center" },
  cancelBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.textSecondary },
  saveBtn: { flex: 2, height: 48, borderRadius: BorderRadius.sm, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center" },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.textOnPrimary },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, paddingVertical: Spacing.base, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryLight, marginTop: Spacing.md },
  addBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.primary },
});
