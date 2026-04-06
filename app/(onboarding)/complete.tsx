import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { getNetworkInsights } from "@/lib/networkInsights";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

export default function OnboardingComplete() {
  const router = useRouter();
  const { profile, refreshProfile, finishCommuterSetupFromAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [savingMode, setSavingMode] = useState(false);

  useEffect(() => {
    async function loadInsights() {
      if (!profile) return;
      const insights = await getNetworkInsights(profile);
      setNearbyCount(insights.nearbyRouteCount);
      setMatchCount(insights.potentialMatches);
      setLoading(false);
    }

    loadInsights();
  }, [profile]);

  async function setVisibilityMode(mode: "network" | "nearby") {
    if (!profile?.id || profile.visibility_mode === mode) return;
    setSavingMode(true);
    const { error } = await supabase
      .from("users")
      .update({ visibility_mode: mode })
      .eq("id", profile.id);

    if (!error) {
      await refreshProfile();
    }
    setSavingMode(false);
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  return (
    <View style={styles.container}>
      <Ionicons name="checkmark-circle" size={74} color={Colors.primary} />
      <Text style={styles.title}>You&apos;re in, {firstName}</Text>
      <Text style={styles.body}>
        People going your way are already on Poolyn. Start with your trusted
        network, then expand to any commuter anytime.
      </Text>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[
            styles.modeChip,
            profile?.visibility_mode !== "nearby" && styles.modeChipActive,
          ]}
          onPress={() => setVisibilityMode("network")}
          disabled={savingMode}
        >
          <Text
            style={[
              styles.modeChipText,
              profile?.visibility_mode !== "nearby" && styles.modeChipTextActive,
            ]}
          >
            Your Network
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeChip,
            profile?.visibility_mode === "nearby" && styles.modeChipActive,
          ]}
          onPress={() => setVisibilityMode("nearby")}
          disabled={savingMode}
        >
          <Text
            style={[
              styles.modeChipText,
              profile?.visibility_mode === "nearby" && styles.modeChipTextActive,
            ]}
          >
            Any commuter
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Ionicons name="navigate-outline" size={22} color={Colors.primary} />
          <Text style={styles.statValue}>{loading ? "..." : nearbyCount}</Text>
          <Text style={styles.statLabel}>People near your route</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Ionicons name="git-network-outline" size={22} color={Colors.accent} />
          <Text style={styles.statValue}>{loading ? "..." : matchCount}</Text>
          <Text style={styles.statLabel}>Potential matches found</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} />
      ) : (
        <Text style={styles.insightHint}>
          Keep your reliability high to boost priority and earn extra Flex Credits.
        </Text>
      )}

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => {
          finishCommuterSetupFromAdmin();
          router.replace("/(tabs)/home");
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryBtnText}>Connect</Text>
        <Ionicons name="arrow-forward" size={18} color={Colors.textOnPrimary} />
      </TouchableOpacity>

      <View style={styles.secondaryRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            finishCommuterSetupFromAdmin();
            router.replace("/(tabs)/rides");
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryBtnText}>Offer ride</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            finishCommuterSetupFromAdmin();
            router.replace("/(tabs)/home");
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryBtnText}>Request ride</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
  modeRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  modeChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  modeChipText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  modeChipTextActive: {
    color: Colors.textOnPrimary,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  stat: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  statValue: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
    textAlign: "center",
  },
  statDivider: {
    width: 1,
    height: 48,
    backgroundColor: Colors.border,
  },
  insightHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 48,
    width: "100%",
    gap: Spacing.sm,
  },
  primaryBtnText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
  secondaryRow: {
    flexDirection: "row",
    width: "100%",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
});
