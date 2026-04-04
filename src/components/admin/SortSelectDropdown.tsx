import { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export type SortOption<T extends string> = { key: T; label: string };

export function SortSelectDropdown<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel = "Sort list",
}: {
  value: T;
  options: SortOption<T>[];
  onChange: (v: T) => void;
  accessibilityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const currentLabel = options.find((o) => o.key === value)?.label ?? String(value);

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        activeOpacity={0.75}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {currentLabel}
        </Text>
        <Ionicons name="chevron-down" size={20} color={Colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <Pressable style={styles.overlayDismiss} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            {options.map((o) => {
              const selected = o.key === value;
              return (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {o.label}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark" size={22} color={Colors.primary} />
                  ) : (
                    <View style={styles.optionSpacer} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    ...Shadow.sm,
  },
  triggerText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.text,
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  overlayDismiss: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    zIndex: 2,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    ...Shadow.lg,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  optionSelected: {
    backgroundColor: Colors.primaryLight,
  },
  optionText: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
  },
  optionTextSelected: {
    fontWeight: FontWeight.semibold,
    color: Colors.primaryDark,
  },
  optionSpacer: { width: 22 },
});
