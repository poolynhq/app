import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type Step = "intro" | "confirm" | "admin_block";

export default function WorkplaceNetworkScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>("intro");
  const [leaving, setLeaving] = useState(false);

  const isOrgAdmin = profile?.org_role === "admin";
  const hasOrg = Boolean(profile?.org_id);

  if (!hasOrg) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBack}
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Workplace network</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.body}>
            You are not in a workplace network on Poolyn. There is nothing to leave.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  async function runLeave() {
    setLeaving(true);
    const { error } = await supabase.rpc("poolyn_leave_organisation");
    setLeaving(false);
    if (error) {
      const msg = error.message ?? "";
      if (
        msg.includes("organisation_admin_must_transfer") ||
        msg.toLowerCase().includes("transfer")
      ) {
        setStep("admin_block");
        showAlert(
          "Transfer admin first",
          "Organisation admins must transfer admin to another member before leaving the network. Use Transfer admin, then return here."
        );
        return;
      }
      showAlert("Could not leave network", msg || "Please try again.");
      return;
    }
    await refreshProfile();
    showAlert(
      "You left the network",
      "You are now an independent Explorer. Your points and Flex balances are unchanged."
    );
    router.back();
  }

  function goLeaveFlow() {
    setStep("confirm");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBack}
          onPress={() => {
            if (step === "intro") router.back();
            else setStep("intro");
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Workplace network</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === "intro" && (
          <>
            <View style={styles.warnCard}>
              <Ionicons name="warning-outline" size={22} color={Colors.warning} />
              <Text style={styles.warnText}>
                Leaving removes you from your organisation on Poolyn. This affects matching priority,
                workplace-only features, and any commuter pickup location tied to the network.
              </Text>
            </View>
            <Text style={styles.sectionTitle}>What you keep</Text>
            <Text style={styles.body}>
              Your account, points, Flex credits, and commute credits stay on your profile. You can
              keep using Poolyn as an independent Explorer.
            </Text>
            <Text style={styles.sectionTitle}>What you lose</Text>
            <Text style={styles.body}>
              Organisation verification, network-priority matching, and admin-granted workplace
              benefits tied to that network. You may need a new invite to rejoin later.
            </Text>
            {isOrgAdmin ? (
              <View style={styles.adminCard}>
                <Ionicons name="shield-outline" size={20} color={Colors.primary} />
                <Text style={styles.adminCardText}>
                  You are the organisation admin. Transfer admin to a colleague first, then you can
                  leave as a normal member.
                </Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryBtn, isOrgAdmin && styles.secondaryBtn]}
              onPress={() =>
                isOrgAdmin
                  ? router.push("/(tabs)/profile/transfer-workplace-admin")
                  : goLeaveFlow()
              }
              activeOpacity={0.85}
            >
              <Text
                style={[styles.primaryBtnText, isOrgAdmin && styles.secondaryBtnText]}
              >
                {isOrgAdmin ? "Transfer admin" : "Continue to leave network"}
              </Text>
            </TouchableOpacity>
            {!isOrgAdmin ? (
              <TouchableOpacity style={styles.textBtn} onPress={() => router.back()}>
                <Text style={styles.textBtnLabel}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}

        {step === "confirm" && (
          <>
            <Text style={styles.lead}>Are you sure?</Text>
            <Text style={styles.body}>
              You will leave your workplace network immediately and become an Explorer. This cannot
              be undone from here without a new admin invite.
            </Text>
            <TouchableOpacity
              style={[styles.destructiveBtn, leaving && { opacity: 0.7 }]}
              onPress={() =>
                showAlert("Leave workplace network?", "You will lose network membership now.", [
                  { text: "Not now", style: "cancel" },
                  {
                    text: "Leave network",
                    style: "destructive",
                    onPress: () => void runLeave(),
                  },
                ])
              }
              disabled={leaving}
              activeOpacity={0.85}
            >
              {leaving ? (
                <ActivityIndicator color={Colors.textOnPrimary} />
              ) : (
                <Text style={styles.destructiveBtnText}>Leave network</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.textBtn} onPress={() => setStep("intro")}>
              <Text style={styles.textBtnLabel}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "admin_block" && (
          <>
            <Text style={styles.lead}>Transfer admin first</Text>
            <Text style={styles.body}>
              Organisation admins cannot leave until someone else is the admin. Transfer admin from
              the button below, then open this screen again to leave as a member.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/(tabs)/profile/transfer-workplace-admin")}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Open transfer admin</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textBtn} onPress={() => setStep("intro")}>
              <Text style={styles.textBtnLabel}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerBack: { width: 36, height: 36, justifyContent: "center", alignItems: "flex-start" },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.text },
  scroll: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing["4xl"] },
  center: { flex: 1, padding: Spacing.xl, justifyContent: "center" },
  warnCard: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "flex-start",
    backgroundColor: "#FFF8E6",
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: "#F5E0A8",
  },
  warnText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  sectionTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  lead: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  body: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  adminCard: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "flex-start",
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
    ...Shadow.sm,
  },
  adminCardText: { flex: 1, fontSize: FontSize.sm, color: Colors.primaryDark, lineHeight: 20 },
  primaryBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.base + 2,
    alignItems: "center",
    ...Shadow.md,
  },
  primaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  secondaryBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  secondaryBtnText: { color: Colors.primary },
  destructiveBtn: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.error,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.base + 2,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  destructiveBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  textBtn: { marginTop: Spacing.lg, alignItems: "center", padding: Spacing.sm },
  textBtnLabel: { fontSize: FontSize.base, color: Colors.primary, fontWeight: FontWeight.medium },
});
