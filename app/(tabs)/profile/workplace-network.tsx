import { useCallback, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { useOrgAffiliations } from "@/hooks/useOrgAffiliations";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type FlowStep = "list" | "intro" | "confirm" | "admin_block";

type LeaveTarget = {
  organisationId: string;
  name: string;
  isAdmin: boolean;
};

export default function WorkplaceNetworkScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { affiliations, reloadAffiliations } = useOrgAffiliations(profile?.id);
  const [step, setStep] = useState<FlowStep>("list");
  const [target, setTarget] = useState<LeaveTarget | null>(null);
  const [leaving, setLeaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reloadAffiliations();
    }, [reloadAffiliations])
  );

  async function runLeave(orgId: string) {
    setLeaving(true);
    const { error } = await supabase.rpc("poolyn_leave_organisation", { p_org_id: orgId });
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
      showAlert("Could not leave organisation", msg || "Please try again.");
      return;
    }
    await refreshProfile();
    await reloadAffiliations();
    setTarget(null);
    setStep("list");
    showAlert(
      "Left organisation",
      "You have been removed from that workplace network on Poolyn."
    );
  }

  function beginLeave(a: (typeof affiliations)[number]) {
    setTarget({
      organisationId: a.organisationId,
      name: a.org.name ?? "this organisation",
      isAdmin: a.membershipRole === "admin",
    });
    setStep(a.membershipRole === "admin" ? "admin_block" : "intro");
  }

  function resetFlow() {
    setTarget(null);
    setStep("list");
  }

  const headerBack = () => {
    if (step === "list") router.back();
    else resetFlow();
  };

  if (affiliations.length === 0) {
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
          <Text style={styles.title}>Workplace networks</Text>
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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBack}
          onPress={headerBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Workplace networks</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === "list" && (
          <>
            <Text style={styles.leadSmall}>Your organisations</Text>
            <Text style={[styles.body, { marginBottom: Spacing.lg }]}>
              You can belong to up to three workplace networks. Manage each one below.
            </Text>
            {affiliations.map((a) => (
              <View key={a.organisationId} style={styles.orgCard}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.orgTitle}>{a.org.name ?? "Organisation"}</Text>
                  <Text style={styles.orgMeta}>
                    {a.org.org_type === "enterprise" ? "Workplace network" : "Community network"}
                    {a.membershipRole === "admin" ? " · Admin" : ""}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.leaveLink}
                  onPress={() => beginLeave(a)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={"Leave " + (a.org.name ?? "organisation")}
                >
                  <Text style={styles.leaveLinkText}>Leave</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {step === "intro" && target && !target.isAdmin && (
          <>
            <Text style={styles.lead}>Leave {target.name}?</Text>
            <View style={styles.warnCard}>
              <Ionicons name="warning-outline" size={22} color={Colors.warning} />
              <Text style={styles.warnText}>
                Leaving removes you from this organisation on Poolyn. This affects matching priority,
                workplace-only features for that network, and pickup settings tied to it when it was
                your only network.
              </Text>
            </View>
            <Text style={styles.sectionTitle}>What you keep</Text>
            <Text style={styles.body}>
              Your account, points, Flex credits, and commute credits stay on your profile.
            </Text>
            <Text style={styles.sectionTitle}>Rejoining</Text>
            <Text style={styles.body}>
              If you leave an organisation team, you must be invited again before you can rejoin.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setStep("confirm")}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textBtn} onPress={resetFlow}>
              <Text style={styles.textBtnLabel}>Cancel</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "confirm" && target && (
          <>
            <Text style={styles.lead}>Confirm</Text>
            <Text style={styles.body}>
              You will leave {target.name} immediately. This cannot be undone from here without a new
              invite from an organisation admin.
            </Text>
            <TouchableOpacity
              style={[styles.destructiveBtn, leaving && { opacity: 0.7 }]}
              onPress={() =>
                showAlert(
                  "Leave this organisation?",
                  "If you leave this organisation team, you must be invited again before you can rejoin.",
                  [
                    { text: "Not now", style: "cancel" },
                    {
                      text: "Leave organisation",
                      style: "destructive",
                      onPress: () => void runLeave(target.organisationId),
                    },
                  ]
                )
              }
              disabled={leaving}
              activeOpacity={0.85}
            >
              {leaving ? (
                <ActivityIndicator color={Colors.textOnPrimary} />
              ) : (
                <Text style={styles.destructiveBtnText}>Leave organisation</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.textBtn} onPress={() => setStep("intro")}>
              <Text style={styles.textBtnLabel}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === "admin_block" && target && (
          <>
            <Text style={styles.lead}>Transfer admin first</Text>
            <Text style={styles.body}>
              Organisation admins cannot leave {target.name} until someone else is the admin.
              Transfer admin from the button below, then return here to leave as a member.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/(tabs)/profile/transfer-workplace-admin")}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Open transfer admin</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textBtn} onPress={resetFlow}>
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
  leadSmall: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  orgCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.sm,
  },
  orgTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.text },
  orgMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  leaveLink: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm },
  leaveLinkText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.error },
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
