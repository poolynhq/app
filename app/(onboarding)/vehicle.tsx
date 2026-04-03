import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from "react-native";
import { showAlert } from "@/lib/platformAlert";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { VehicleSelectModal } from "@/components/VehicleSelectModal";
import {
  OTHER_MAKE_LABEL,
  VEHICLE_COLOURS,
  VEHICLE_CLASSES,
  VEHICLE_MAKES_SORTED,
  VEHICLE_MODELS_BY_MAKE,
  SEAT_OPTIONS,
} from "@/constants/vehicleCatalog";
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

export default function VehicleSetup() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();

  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [customMake, setCustomMake] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [colour, setColour] = useState("");
  const [plate, setPlate] = useState("");
  const [seats, setSeats] = useState(4);
  const [vehicleClass, setVehicleClass] = useState("sedan");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listModal, setListModal] = useState<ListModalConfig | null>(null);

  const makeOptions = useMemo(() => [...VEHICLE_MAKES_SORTED, OTHER_MAKE_LABEL], []);
  const modelOptions = useMemo(() => {
    if (!selectedMake || selectedMake === OTHER_MAKE_LABEL) return [];
    return VEHICLE_MODELS_BY_MAKE[selectedMake] ?? [];
  }, [selectedMake]);

  const resolvedMake =
    selectedMake === OTHER_MAKE_LABEL ? customMake.trim() : selectedMake.trim();
  const resolvedModel =
    selectedMake === OTHER_MAKE_LABEL ? customModel.trim() : selectedModel.trim();

  const hasPlate = plate.trim().length > 0;
  const hasLicence = licenceNumber.trim().length > 0;
  const hasPhoto = !!photoUri;
  const hasAnyVehicleInput =
    !!resolvedMake ||
    !!resolvedModel ||
    !!colour.trim() ||
    !!plate.trim() ||
    !!photoUri;
  const allVerifiable = hasPlate && hasLicence && hasPhoto;

  async function pickPhoto(useCamera: boolean) {
    const permMethod = useCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;

    const { granted } = await permMethod();
    if (!granted) {
      showAlert(
        "Permission needed",
        `Please allow access to your ${useCamera ? "camera" : "photo library"} in settings.`
      );
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [16, 9],
          quality: 0.8,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [16, 9],
          quality: 0.8,
        });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  function showPhotoOptions() {
    if (Platform.OS === "web") {
      pickPhoto(false);
      return;
    }
    showAlert("Vehicle photo", "How would you like to add a photo?", [
      { text: "Take a photo", onPress: () => pickPhoto(true) },
      { text: "Choose from gallery", onPress: () => pickPhoto(false) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function uploadVehiclePhoto(vehicleId: string): Promise<string | null> {
    if (!photoUri || !profile?.id) return null;

    setUploading(true);
    try {
      const ext = photoUri.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${profile.id}/${vehicleId}.${ext}`;

      const response = await fetch(photoUri);
      const blob = await response.blob();

      const { error } = await supabase.storage
        .from("vehicle-photos")
        .upload(path, blob, {
          contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
          upsert: true,
        });

      if (error) {
        console.error("Upload error:", error.message);
        return null;
      }

      return path;
    } catch (e) {
      console.error("Photo upload failed:", e);
      return null;
    } finally {
      setUploading(false);
    }
  }

  const [makeError, setMakeError] = useState("");
  const [modelError, setModelError] = useState("");
  const [plateError, setPlateError] = useState("");

  async function handleContinue() {
    let valid = true;
    setMakeError("");
    setModelError("");
    setPlateError("");

    if (hasAnyVehicleInput) {
      if (!selectedMake) {
        setMakeError("Please select a vehicle make.");
        valid = false;
      } else if (selectedMake === OTHER_MAKE_LABEL) {
        if (customMake.trim().length < 2) {
          setMakeError("Enter your vehicle make (e.g. Morgan).");
          valid = false;
        }
        if (customModel.trim().length < 2) {
          setModelError("Enter your vehicle model.");
          valid = false;
        }
      } else if (!selectedModel) {
        setModelError("Please select a model for this make.");
        valid = false;
      }
      if (
        hasPlate &&
        !/^[A-Za-z0-9]{2,10}$/.test(plate.trim().replace(/\s/g, ""))
      ) {
        setPlateError("Please enter a valid alphanumeric plate.");
        valid = false;
      }
    }

    if (!valid) return;

    setLoading(true);

    if (profile?.id) {
      if (hasAnyVehicleInput) {
        const { data: vehicle, error: vehicleError } = await supabase
          .from("vehicles")
          .insert({
            user_id: profile.id,
            make: resolvedMake,
            model: resolvedModel,
            colour: colour.trim() || null,
            plate: hasPlate ? plate.trim().toUpperCase() : null,
            seats,
            vehicle_class: vehicleClass,
          })
          .select("id")
          .single();

        if (vehicleError) {
          setLoading(false);
          showAlert("Something went wrong", "Could not save vehicle details. Please try again.");
          return;
        }

        if (vehicle?.id && photoUri) {
          const photoPath = await uploadVehiclePhoto(vehicle.id);
          if (photoPath) {
            await supabase
              .from("vehicles")
              .update({ photo_url: photoPath })
              .eq("id", vehicle.id);
          }
        }
      }

      const userUpdate: Record<string, unknown> = {
        onboarding_completed: true,
      };
      if (hasLicence) {
        userUpdate.licence_number = licenceNumber.trim();
      }

      const { error: userError } = await supabase
        .from("users")
        .update(userUpdate)
        .eq("id", profile.id);

      if (userError) {
        setLoading(false);
        showAlert("Something went wrong", "Could not update your profile. Please try again.");
        return;
      }

      await refreshProfile();
    }

    setLoading(false);
    router.replace("/(onboarding)/complete");
  }

  async function handleSkip() {
    if (!profile?.id) {
      router.replace("/(onboarding)/complete");
      return;
    }

    setLoading(true);
    const userUpdate: Record<string, unknown> = {
      onboarding_completed: true,
    };

    if (hasLicence) userUpdate.licence_number = licenceNumber.trim();

    const { error } = await supabase
      .from("users")
      .update(userUpdate)
      .eq("id", profile.id);

    setLoading(false);

    if (error) {
      showAlert("Something went wrong", "Could not finish onboarding. Please try again.");
      return;
    }

    await refreshProfile();
    router.replace("/(onboarding)/complete");
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: "100%" }]} />
        </View>

        <Text style={styles.step}>Step 4 of 4</Text>
        <Text style={styles.title}>Vehicle details (optional)</Text>
        <Text style={styles.subtitle}>
          Add this now for faster trust and matching, or skip and add it when
          you offer your first ride.
        </Text>

        {/* Vehicle info — dropdowns */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Make</Text>
          <TouchableOpacity
            style={[styles.select, makeError ? styles.selectError : null]}
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
                  if (makeError) setMakeError("");
                },
              })
            }
            activeOpacity={0.75}
          >
            <Text
              style={selectedMake ? styles.selectValue : styles.selectPlaceholder}
              numberOfLines={1}
            >
              {selectedMake || "Select make"}
            </Text>
            <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
          {makeError ? <Text style={styles.validationError}>{makeError}</Text> : null}
        </View>

        {selectedMake === OTHER_MAKE_LABEL ? (
          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Make (custom)</Text>
              <TextInput
                style={[styles.input, makeError ? styles.inputError : null]}
                placeholder="e.g. Morgan"
                placeholderTextColor={Colors.textTertiary}
                value={customMake}
                onChangeText={(t) => {
                  setCustomMake(t);
                  if (makeError) setMakeError("");
                }}
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Model (custom)</Text>
              <TextInput
                style={[styles.input, modelError ? styles.inputError : null]}
                placeholder="e.g. Plus 4"
                placeholderTextColor={Colors.textTertiary}
                value={customModel}
                onChangeText={(t) => {
                  setCustomModel(t);
                  if (modelError) setModelError("");
                }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Model</Text>
            <TouchableOpacity
              style={[
                styles.select,
                modelError ? styles.selectError : null,
                !selectedMake && styles.selectDisabled,
              ]}
              disabled={!selectedMake}
              onPress={() => {
                if (!selectedMake || modelOptions.length === 0) return;
                setListModal({
                  title: `Models: ${selectedMake}`,
                  options: modelOptions,
                  selected: selectedModel,
                  onPick: (v) => {
                    setSelectedModel(v);
                    if (modelError) setModelError("");
                  },
                });
              }}
              activeOpacity={0.75}
            >
              <Text
                style={selectedModel ? styles.selectValue : styles.selectPlaceholder}
                numberOfLines={1}
              >
                {!selectedMake
                  ? "Select make first"
                  : selectedModel || "Select model"}
              </Text>
              <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
            </TouchableOpacity>
            {modelError ? <Text style={styles.validationError}>{modelError}</Text> : null}
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Vehicle size class</Text>
          <Text style={styles.hint}>
            Used for fair cost sharing. You cannot change per-trip rates.
          </Text>
          <TouchableOpacity
            style={styles.select}
            onPress={() =>
              setListModal({
                title: "Vehicle size class",
                options: VEHICLE_CLASSES.map((vc) => vc.label),
                selected: VEHICLE_CLASSES.find((vc) => vc.value === vehicleClass)?.label ?? "",
                onPick: (label) => {
                  const vc = VEHICLE_CLASSES.find((c) => c.label === label);
                  if (vc) setVehicleClass(vc.value);
                },
              })
            }
            activeOpacity={0.75}
          >
            <Text style={styles.selectValue} numberOfLines={1}>
              {VEHICLE_CLASSES.find((vc) => vc.value === vehicleClass)?.label ?? "Sedan"}
            </Text>
            <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Colour</Text>
            <TouchableOpacity
              style={styles.select}
              onPress={() =>
                setListModal({
                  title: "Colour",
                  options: [...VEHICLE_COLOURS],
                  selected: colour,
                  onPick: (v) => setColour(v),
                })
              }
              activeOpacity={0.75}
            >
              <Text
                style={colour ? styles.selectValue : styles.selectPlaceholder}
                numberOfLines={1}
              >
                {colour || "Select colour"}
              </Text>
              <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Seats available</Text>
            <TouchableOpacity
              style={styles.select}
              onPress={() =>
                setListModal({
                  title: "Seats (passenger capacity)",
                  options: SEAT_OPTIONS.map(String),
                  selected: String(seats),
                  onPick: (v) => setSeats(parseInt(v, 10)),
                })
              }
              activeOpacity={0.75}
            >
              <Text style={styles.selectValue} numberOfLines={1}>
                {seats}
              </Text>
              <Ionicons name="chevron-down" size={20} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Vehicle photo */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Vehicle photo</Text>
          <TouchableOpacity
            style={styles.photoArea}
            onPress={showPhotoOptions}
            activeOpacity={0.7}
          >
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons
                  name="camera-outline"
                  size={32}
                  color={Colors.textTertiary}
                />
                <Text style={styles.photoPlaceholderText}>
                  Take or upload a photo of your vehicle
                </Text>
              </View>
            )}
            {photoUri && (
              <View style={styles.photoOverlay}>
                <Ionicons
                  name="create-outline"
                  size={18}
                  color={Colors.textOnPrimary}
                />
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.fieldHint}>
            Optional but recommended. Only visible to passengers in your active
            pool.
          </Text>
        </View>

        {/* Verification section */}
        <View style={styles.divider} />
        <View style={styles.sectionHeader}>
          <Ionicons
            name="shield-checkmark-outline"
            size={22}
            color={Colors.primary}
          />
          <Text style={styles.sectionTitle}>Safety verification</Text>
        </View>
        <Text style={styles.sectionDesc}>
          We verify these details to ensure everyone&apos;s safety. Providing all
          three earns you the{" "}
          <Text style={{ fontWeight: "700", color: Colors.primaryDark }}>
            Verified Driver
          </Text>{" "}
          badge. Verified drivers get more ride requests and higher trust
          scores.
        </Text>

        {/* Registration number */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Vehicle registration number</Text>
          <View
            style={[
              styles.inputWithIcon,
              plateError ? styles.inputError : null,
            ]}
          >
            <Ionicons
              name="document-text-outline"
              size={20}
              color={plateError ? Colors.error : hasPlate ? Colors.primary : Colors.textTertiary}
              style={styles.fieldIcon}
            />
            <TextInput
              style={styles.inputInner}
              placeholder="e.g. ABC123 or 1AB2CD"
              placeholderTextColor={Colors.textTertiary}
              value={plate}
              onChangeText={(t) => {
                setPlate(t);
                if (plateError) setPlateError("");
              }}
              autoCapitalize="characters"
            />
            {hasPlate && !plateError && (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={Colors.success}
              />
            )}
          </View>
          {plateError ? (
            <Text style={styles.validationError}>{plateError}</Text>
          ) : (
            <Text style={styles.fieldHint}>
              Optional now. Needed later when you offer rides and for full
              verification.
            </Text>
          )}
        </View>

        {/* Licence number — optional */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Driver&apos;s licence number</Text>
          <View style={styles.inputWithIcon}>
            <Ionicons
              name="card-outline"
              size={20}
              color={hasLicence ? Colors.primary : Colors.textTertiary}
              style={styles.fieldIcon}
            />
            <TextInput
              style={styles.inputInner}
              placeholder="e.g. 012345678"
              placeholderTextColor={Colors.textTertiary}
              value={licenceNumber}
              onChangeText={setLicenceNumber}
            />
            {hasLicence && (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={Colors.success}
              />
            )}
          </View>
          <Text style={styles.fieldHint}>
            Optional but recommended. Needed for the Verified Driver badge.
          </Text>
        </View>

        {/* Badge status */}
        {allVerifiable ? (
          <View style={styles.badgeEarned}>
            <View style={styles.badgeIconWrap}>
              <Ionicons
                name="shield-checkmark"
                size={28}
                color={Colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.badgeTitle}>
                Verified Driver badge unlocked
              </Text>
              <Text style={styles.badgeDesc}>
                We&apos;ll verify your details and award the badge shortly. Verified
                drivers get:
              </Text>
              <View style={styles.perkList}>
                {[
                  "Priority in passenger matching",
                  "Visible trust badge on your profile",
                  "Higher match score with new users",
                  "Bonus points on your first 5 rides",
                ].map((perk, i) => (
                  <View key={i} style={styles.perkRow}>
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={Colors.primary}
                    />
                    <Text style={styles.perkText}>{perk}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.badgeHint}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={Colors.textSecondary}
            />
            <Text style={styles.badgeHintText}>
              {!hasPlate && !hasLicence && !hasPhoto
                ? "Add your registration, licence number, and a vehicle photo to earn the Verified Driver badge."
                : !hasPlate
                ? "Add your registration when you are ready to unlock the Verified Driver badge."
                : !hasLicence && !hasPhoto
                ? "Add your licence number and a vehicle photo to unlock the Verified Driver badge."
                : !hasLicence
                ? "Add your licence number to unlock the Verified Driver badge."
                : !hasPhoto
                ? "Add a vehicle photo to complete verification and unlock the badge."
                : ""}
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.button,
              (loading || uploading) && styles.buttonDisabled,
            ]}
            onPress={handleContinue}
            disabled={loading || uploading}
            activeOpacity={0.8}
          >
            {uploading ? (
              <>
                <ActivityIndicator size="small" color={Colors.textOnPrimary} />
                <Text style={styles.buttonText}>Uploading photo...</Text>
              </>
            ) : (
              <>
                <Text style={styles.buttonText}>
                  {loading ? "Saving..." : "Finish setup"}
                </Text>
                <Ionicons
                  name="checkmark"
                  size={20}
                  color={Colors.textOnPrimary}
                />
              </>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkip}
          disabled={loading || uploading}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>

      {listModal ? (
        <VehicleSelectModal
          visible
          title={listModal.title}
          options={listModal.options}
          selectedValue={listModal.selected}
          onClose={() => setListModal(null)}
          onSelect={(v) => listModal.onPick(v)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 70,
    paddingBottom: Spacing["3xl"],
  },
  progress: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    marginBottom: Spacing.xl,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  step: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginBottom: Spacing["2xl"],
    lineHeight: 22,
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  row: { flexDirection: "row", gap: Spacing.md },
  inputGroup: { marginBottom: Spacing.lg },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    height: 48,
    fontSize: FontSize.base,
    color: Colors.text,
    ...Shadow.sm,
  },
  inputError: {
    borderColor: Colors.error,
  },
  select: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    ...Shadow.sm,
  },
  selectError: {
    borderColor: Colors.error,
  },
  selectDisabled: {
    opacity: 0.55,
  },
  selectValue: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
    marginRight: Spacing.sm,
  },
  selectPlaceholder: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.textTertiary,
    marginRight: Spacing.sm,
  },
  validationError: {
    fontSize: FontSize.xs,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  inputWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    height: 52,
    ...Shadow.sm,
  },
  fieldIcon: { marginRight: Spacing.sm },
  inputInner: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  fieldHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
  photoArea: {
    height: 180,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: "dashed",
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  photoPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
  },
  photoPlaceholderText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
  },
  photoPreview: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  photoOverlay: {
    position: "absolute",
    bottom: Spacing.sm,
    right: Spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  sectionDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
    lineHeight: 21,
  },
  badgeEarned: {
    flexDirection: "row",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.base,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  badgeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.primaryDark,
    marginBottom: Spacing.xs,
  },
  badgeDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: Spacing.sm,
  },
  perkList: { gap: Spacing.xs },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  perkText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  badgeHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.base,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  badgeHintText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing["2xl"],
  },
  backBtn: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  button: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadow.md,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  skipBtn: {
    alignSelf: "center",
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  skipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
});
