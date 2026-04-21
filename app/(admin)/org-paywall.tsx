import { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { OrgPaywallScreen, type OrgUpgradePlanId } from "@/components/OrgPaywallScreen";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { Colors } from "@/constants/theme";
import type { OrganisationNetworkStatus } from "@/types/database";

const ENTERPRISE_SALES_EMAIL =
  "mailto:hello@poolyn.com?subject=Poolyn%20Orbit%20Enterprise%20upgrade";

export default function OrgPaywallRoute() {
  const router = useRouter();
  const { intent } = useLocalSearchParams<{ intent?: string | string[] }>();
  const intentStr = Array.isArray(intent) ? intent[0] : intent;
  const upgradeIntent = intentStr === "upgrade";

  const { profile, refreshProfile } = useAuth();
  const [status, setStatus] = useState<OrganisationNetworkStatus | null | undefined>(undefined);
  const [orgPlan, setOrgPlan] = useState<string>("free");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.org_id) {
        if (!cancelled) setStatus(null);
        return;
      }
      const { data } = await supabase
        .from("organisations")
        .select("status, plan")
        .eq("id", profile.org_id)
        .single();
      if (!cancelled) {
        setStatus((data?.status as OrganisationNetworkStatus) ?? null);
        setOrgPlan(typeof data?.plan === "string" ? data.plan : "free");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.org_id]);

  if (status === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={[styles.flex, styles.centered]}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.flex}>
        <OrgPaywallScreen
          mode={upgradeIntent ? "upgrade" : "activation"}
          currentOrgPlan={orgPlan}
          organisationStatus={status ?? undefined}
          onActivateNetwork={() => {
            showAlert(
              status === "grace" ? "Update payment" : "Activate network",
              status === "grace"
                ? "Stripe billing is not wired in this build yet. When live, this opens your subscription."
                : "Stripe checkout is not wired in this build yet. When billing is live, this opens activation."
            );
          }}
          onSelectUpgradePlan={(planId: OrgUpgradePlanId) => {
            if (planId === "enterprise") {
              void Linking.openURL(ENTERPRISE_SALES_EMAIL);
              return;
            }
            showAlert(
              "Upgrade plan",
              `When Stripe billing is live, confirming ${planId} will start checkout for your organization.`
            );
          }}
          onContinueAsIndividual={async () => {
            await refreshProfile();
            router.replace("/(tabs)/home");
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center" },
});
