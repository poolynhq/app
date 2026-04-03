import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type TabKey = "upcoming" | "past";

export default function MyRides() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("upcoming");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Rides</Text>
      </View>

      <View style={styles.tabs}>
        {(["upcoming", "past"] as TabKey[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.tabTextActive,
              ]}
            >
              {tab === "upcoming" ? "Upcoming" : "Past"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.emptyState}>
        <View style={styles.emptyIcon}>
          <Ionicons
            name={activeTab === "upcoming" ? "calendar-outline" : "time-outline"}
            size={48}
            color={Colors.textTertiary}
          />
        </View>
        <Text style={styles.emptyTitle}>
          {activeTab === "upcoming"
            ? "Your next ride appears here"
            : "Your ride history appears here"}
        </Text>
        <Text style={styles.emptyBody}>
          {activeTab === "upcoming"
            ? "Offer or request a ride to start building your commute network."
            : "Completed rides unlock reliability insights and badges."}
        </Text>
        {activeTab === "upcoming" && (
          <TouchableOpacity style={styles.ctaButton} activeOpacity={0.8}>
            <Ionicons name="add" size={20} color={Colors.textOnPrimary} />
            <Text style={styles.ctaText}>
              {profile?.role === "passenger"
                ? "Find a ride"
                : "Offer a ride"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize["2xl"],
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  tab: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.textOnPrimary,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    paddingBottom: Spacing["5xl"],
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.borderLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    ...Shadow.md,
  },
  ctaText: {
    color: Colors.textOnPrimary,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
  },
});
