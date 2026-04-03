import { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

type Props = {
  visible: boolean;
  title: string;
  options: string[];
  selectedValue: string;
  placeholder?: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  searchable?: boolean;
};

export function VehicleSelectModal({
  visible,
  title,
  options,
  selectedValue,
  placeholder = "Select…",
  onClose,
  onSelect,
  searchable,
}: Props) {
  const [query, setQuery] = useState("");
  const searchOn = searchable ?? options.length > 14;

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button">
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <View style={{ width: 56 }} />
          </View>
          {searchOn ? (
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={18} color={Colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search…"
                placeholderTextColor={Colors.textTertiary}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query.length > 0 ? (
                <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={20} color={Colors.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <Text style={styles.empty}>No matches. Try another search.</Text>
            }
            renderItem={({ item }) => {
              const active = item === selectedValue;
              return (
                <TouchableOpacity
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={2}>
                    {item}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  cancel: { fontSize: FontSize.base, color: Colors.primary, fontWeight: FontWeight.medium },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.text,
    paddingVertical: 4,
  },
  listContent: { paddingBottom: Spacing["3xl"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
    gap: Spacing.md,
  },
  rowActive: { backgroundColor: Colors.primaryLight },
  rowText: { flex: 1, fontSize: FontSize.base, color: Colors.text },
  rowTextActive: { fontWeight: FontWeight.semibold, color: Colors.primaryDark },
  empty: {
    textAlign: "center",
    color: Colors.textSecondary,
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
});
