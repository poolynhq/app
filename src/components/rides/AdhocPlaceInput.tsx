import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { geocodeSuggestPlaces, type GeoSuggestion } from "@/lib/mapboxGeocodeSuggest";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export type PlacePin = { lat: number; lng: number; label: string };

type Props = {
  label: string;
  mapAccessibilityLabel: string;
  value: PlacePin | null;
  onChange: (next: PlacePin | null) => void;
  onOpenMap: () => void;
  /** Mapbox proximity: "lng,lat" or "ip" */
  proximity: string;
  countryCode?: string;
  placeholder?: string;
};

export function AdhocPlaceInput({
  label,
  mapAccessibilityLabel,
  value,
  onChange,
  onOpenMap,
  proximity,
  countryCode,
  placeholder = "Type a city or address, or use the map",
}: Props) {
  const [text, setText] = useState(value?.label ?? "");
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setText(value?.label ?? "");
  }, [value?.label, value?.lat, value?.lng]);

  const runSuggest = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      abortRef.current?.abort();
      const my = ++seq.current;
      timer.current = setTimeout(() => {
        void (async () => {
          if (q.trim().length < 2) {
            setSuggestions([]);
            return;
          }
          abortRef.current = new AbortController();
          setLoading(true);
          const list = await geocodeSuggestPlaces(q, {
            proximity,
            countryCode,
            signal: abortRef.current.signal,
            minLength: 2,
          });
          if (seq.current !== my) return;
          setSuggestions(list);
          setLoading(false);
        })();
      }, 280);
    },
    [proximity, countryCode]
  );

  function selectSuggestion(s: GeoSuggestion) {
    setText(s.label);
    setSuggestions([]);
    onChange({ lat: s.lat, lng: s.lng, label: s.label });
  }

  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor={Colors.textTertiary}
            value={text}
            onChangeText={(t) => {
              setText(t);
              runSuggest(t);
              if (value && t.trim() !== value.label.trim()) {
                onChange(null);
              }
            }}
            autoCorrect={false}
            autoCapitalize="words"
          />
          {loading ? <ActivityIndicator size="small" color={Colors.primary} style={styles.spinner} /> : null}
        </View>
        <TouchableOpacity
          style={styles.mapBtn}
          onPress={onOpenMap}
          accessibilityRole="button"
          accessibilityLabel={mapAccessibilityLabel}
        >
          <Ionicons name="map-outline" size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>
      {suggestions.length > 0 ? (
        <ScrollView
          style={styles.suggestScroll}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {suggestions.map((s, i) => (
            <TouchableOpacity key={`${s.lat},${s.lng},${i}`} style={styles.suggestRow} onPress={() => selectSuggestion(s)}>
              <Ionicons name="location-outline" size={16} color={Colors.textTertiary} />
              <Text style={styles.suggestText} numberOfLines={2}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {value ? (
        <Text style={styles.pinned}>Using pinned coordinates for this place.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: Spacing.md },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  row: { flexDirection: "row", alignItems: "stretch", gap: Spacing.sm },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    minHeight: 48,
    ...Shadow.sm,
  },
  inputIcon: { marginRight: 6 },
  input: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    paddingVertical: Spacing.sm,
  },
  spinner: { marginLeft: 4 },
  mapBtn: {
    width: 48,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestScroll: {
    maxHeight: 200,
    marginTop: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  suggestText: { flex: 1, fontSize: FontSize.xs, color: Colors.text, lineHeight: 18 },
  pinned: {
    fontSize: FontSize.xs,
    color: Colors.primaryDark,
    marginTop: Spacing.xs,
  },
});
