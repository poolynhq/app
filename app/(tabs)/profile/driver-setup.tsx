import { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { showAlert } from "@/lib/platformAlert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { VehicleSelectModal } from "@/components/VehicleSelectModal";
import {
  OTHER_MAKE_LABEL,
  VEHICLE_COLOURS,
  VEHICLE_MAKES_SORTED,
  VEHICLE_MODELS_BY_MAKE,
} from "@/constants/vehicleCatalog";
import { openDriverBankConnectSetup } from "@/lib/ridePassengerPayment";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type ListModalConfig = {
  title: string;
  options: string[];
  selected: string;
  onPick: (value: string) => void;
};

export default function DriverSetupScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [customMake, setCustomMake] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [colour, setColour] = useState("");
  const [plate, setPlate] = useState("");
  const [seats, setSeats] = useState(4);
  const [listModal, setListModal] = useState<ListModalConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const makeOptions = useMemo(() => [...VEHICLE_MAKES_SORTED, OTHER_MAKE_LABEL], []);
  const modelOptions = useMemo(() => {
    if (!selectedMake || selectedMake === OTHER_MAKE_LABEL) return [];
    return VEHICLE_MODELS_BY_MAKE[selectedMake] ?? [];
  }, [selectedMake]);

  const resolvedMake =
    selectedMake === OTHER_MAKE_LABEL ? customMake.trim() : selectedMake.trim();
  const resolvedModel =
    selectedMake === OTHER_MAKE_LABEL ? customModel.trim() : selectedModel.trim();

  async function onSave() {
    if (!profile?.id) return;
    if (!resolvedMake || !resolvedModel) {
      showAlert("Missing details", "Choose make and model.");
      return;
    }
    if (!colour.trim()) {
      showAlert("Missing details", "Choose a colour.");
      return;
    }
    if (!plate.trim()) {
      showAlert("Missing details", "Enter your registration (number plate).");
      return;
    }
    if (seats < 2) {
      showAlert("Seats", "At least two total seats (including you) are required to carry passengers.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("vehicles").insert({
      user_id: profile.id,
      make: resolvedMake,
      model: resolvedModel,
      colour: colour.trim(),
      plate: plate.trim().toUpperCase(),
      seats,
      vehicle_class: "sedan",
      active: true,
    });
    setSaving(false);
    if (error) {
      showAlert("Could not save", error.message);
      return;
    }
    await refreshProfile();
    showAlert(
      "Next: bank connection",
      "When you host paid trips, each rider pays through Stripe to your Connect account. Connect your bank to go live.",
      [
        { text: "Later", style: "cancel", onPress: () => router.back() },
        {
          text: "Connect bank",
          onPress: () => {
            void (async () => {
              await openDriverBankConnectSetup();
              router.back();
            })();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.eyebrow}>DRIVING ON POOLYN</Text>
          <Text style={styles.title}>Set up your driver profile</Text>
          <Text style={styles.lead}>
            Add the car you will use when you host. You can add more vehicles under Profile later.
          </Text>

          <Text style={styles.label}>Make</Text>
          <TouchableOpacity
            style={styles.select}
            onPress={() =>
              setListModal({
                title: "Select make",
                options: makeOptions,
                selected: selectedMake,
                onPick: (v) => {
                  setSelectedMake(v);
                  setSelectedModel("");
                  setCustomMake("");
                  setCustomModel("");
                },
              })
            }
            activeOpacity={0.75}
          >
            <Text style={selectedMake ? styles.selectVal : styles.selectPh}>
              {selectedMake || "Select make"}
            </Text>
            <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>

          {selectedMake === OTHER_MAKE_LABEL ? (
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Make</Text>
                <TextInput
                  style={styles.input}
                  value={customMake}
                  onChangeText={setCustomMake}
                  placeholder="Make"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Model</Text>
                <TextInput
                  style={styles.input}
                  value={customModel}
                  onChangeText={setCustomModel}
                  placeholder="Model"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>
            </View>
          ) : null}

          {selectedMake && selectedMake !== OTHER_MAKE_LABEL ? (
            <>
              <Text style={styles.label}>Model</Text>
              <TouchableOpacity
                style={styles.select}
                onPress={() =>
                  setListModal({
                    title: "Select model",
                    options: modelOptions.length ? modelOptions : ["Other"],
                    selected: selectedModel,
                    onPick: setSelectedModel,
                  })
                }
                activeOpacity={0.75}
              >
                <Text style={selectedModel ? styles.selectVal : styles.selectPh}>
                  {selectedModel || "Select model"}
                </Text>
                <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
              </TouchableOpacity>
            </>
          ) : null}

          <Text style={styles.label}>Colour</Text>
          <TouchableOpacity
            style={styles.select}
            onPress={() =>
              setListModal({
                title: "Colour",
                options: [...VEHICLE_COLOURS],
                selected: colour,
                onPick: setColour,
              })
            }
            activeOpacity={0.75}
          >
            <Text style={colour ? styles.selectVal : styles.selectPh}>{colour || "Select colour"}</Text>
            <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>

          <Text style={styles.label}>Registration</Text>
          <TextInput
            style={styles.input}
            value={plate}
            onChangeText={(t) => setPlate(t.toUpperCase())}
            placeholder="Number plate"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="characters"
          />

          <Text style={styles.label}>Total seats in the vehicle</Text>
          <View style={styles.stepRow}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setSeats((s) => Math.max(2, s - 1))}>
              <Ionicons name="remove" size={22} color={Colors.primary} />
            </TouchableOpacity>
            <Text style={styles.stepVal}>{seats}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setSeats((s) => Math.min(8, s + 1))}>
              <Ionicons name="add" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, saving && { opacity: 0.65 }]}
            onPress={() => void onSave()}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={Colors.textOnPrimary} />
            ) : (
              <Text style={styles.primaryBtnText}>Save and continue</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <VehicleSelectModal
        visible={!!listModal}
        title={listModal?.title ?? ""}
        options={listModal?.options ?? []}
        selectedValue={listModal?.selected ?? ""}
        onClose={() => setListModal(null)}
        onSelect={(v) => {
          listModal?.onPick(v);
          setListModal(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.xl, paddingBottom: Spacing["4xl"] },
  eyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textTertiary,
    letterSpacing: 0.6,
    marginBottom: Spacing.xs,
  },
  title: { fontSize: FontSize["2xl"], fontWeight: FontWeight.bold, color: Colors.text, marginBottom: Spacing.sm },
  lead: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.lg },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  select: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  selectVal: { fontSize: FontSize.base, color: Colors.text, flex: 1 },
  selectPh: { fontSize: FontSize.base, color: Colors.textTertiary, flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  row: { flexDirection: "row", gap: Spacing.md },
  field: { marginTop: Spacing.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginTop: Spacing.sm },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  stepVal: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text, minWidth: 28, textAlign: "center" },
  primaryBtn: {
    marginTop: Spacing["2xl"],
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    ...Shadow.sm,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
});
