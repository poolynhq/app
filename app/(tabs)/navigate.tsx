import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { parseGeoPoint } from "@/lib/parseGeoPoint";
import { presentDrivingNavigationPicker } from "@/lib/navigationUrls";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

export default function NavigateHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ poolynMingle?: string | string[] }>();
  const mingleRaw = Array.isArray(params.poolynMingle) ? params.poolynMingle[0] : params.poolynMingle;
  const mingleActive = mingleRaw === "1" || mingleRaw === "true";
  const { profile } = useAuth();
  const home = parseGeoPoint(profile?.home_location as unknown);
  const work = parseGeoPoint(profile?.work_location as unknown);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Navigate</Text>
        <Text style={styles.lead}>
          Open turn-by-turn in your maps app using saved commute pins, or adjust those pins first.
        </Text>

        {mingleActive ? (
          <LinearGradient
            colors={["#EA580C", "#D97706", "#F59E0B"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.mingleHero}
          >
            <View style={styles.mingleHeroTop}>
              <Ionicons name="sparkles" size={22} color="rgba(255,255,255,0.95)" />
              <Text style={styles.mingleHeroTitle}>Mingle Poolyn</Text>
            </View>
            <Text style={styles.mingleHeroBody}>
              Corridor map, role, and pickup settings are on Home under Routine → Mingle Poolyn. Use this when you
              are ready for turn-by-turn to work.
            </Text>
            <TouchableOpacity
              style={styles.mingleHeroBtn}
              disabled={!work}
              onPress={() => work && presentDrivingNavigationPicker(work.lat, work.lng)}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={20} color="#B45309" />
              <Text style={styles.mingleHeroBtnText}>Open directions to work</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.mingleDismiss}
              onPress={() => router.replace("/(tabs)/navigate")}
              hitSlop={12}
            >
              <Text style={styles.mingleDismissText}>Dismiss banner</Text>
            </TouchableOpacity>
          </LinearGradient>
        ) : null}

        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push("/(tabs)/profile/commute-locations")}
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: Colors.primaryLight }]}>
            <Ionicons name="location-outline" size={24} color={Colors.primary} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Commute &amp; pickup</Text>
            <Text style={styles.cardSub}>Update home, work, and pickup preferences</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push("/(tabs)/home")}
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: "#FFFBEB" }]}>
            <Ionicons name="home-outline" size={24} color="#D97706" />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Home — routine commute</Text>
            <Text style={styles.cardSub}>Crew vs Mingle, map, and detour live here</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
        </TouchableOpacity>

        <Text style={styles.section}>Directions</Text>

        <TouchableOpacity
          style={[styles.card, !work && styles.cardDisabled]}
          disabled={!work}
          onPress={() => work && presentDrivingNavigationPicker(work.lat, work.lng)}
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: "#EFF6FF" }]}>
            <Ionicons name="briefcase-outline" size={24} color={Colors.info} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>To workplace</Text>
            <Text style={styles.cardSub}>
              {work ? "Open maps to your saved work pin" : "Set work location in Commute & pickup"}
            </Text>
          </View>
          <Ionicons name="navigate-outline" size={20} color={Colors.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, !home && styles.cardDisabled]}
          disabled={!home}
          onPress={() => home && presentDrivingNavigationPicker(home.lat, home.lng)}
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: "#ECFDF5" }]}>
            <Ionicons name="home-outline" size={24} color={Colors.primary} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>To home</Text>
            <Text style={styles.cardSub}>
              {home ? "Open maps to your saved home pin" : "Set home location in Commute & pickup"}
            </Text>
          </View>
          <Ionicons name="navigate-outline" size={20} color={Colors.textTertiary} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["3xl"],
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  lead: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: Spacing.xl,
  },
  section: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textTertiary,
    letterSpacing: 0.6,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  mingleHero: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    ...Shadow.md,
  },
  mingleHeroTop: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  mingleHeroTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: "#fff",
  },
  mingleHeroBody: {
    fontSize: FontSize.sm,
    color: "rgba(255,255,255,0.9)",
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  mingleHeroBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingVertical: 12,
    borderRadius: BorderRadius.lg,
  },
  mingleHeroBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: "#B45309",
  },
  mingleDismiss: { alignSelf: "center", marginTop: Spacing.sm, paddingVertical: Spacing.xs },
  mingleDismissText: { fontSize: FontSize.xs, color: "rgba(255,255,255,0.85)" },
  cardDisabled: { opacity: 0.55 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  cardSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
