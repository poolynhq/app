import { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { OrgPaywallScreen } from "@/components/OrgPaywallScreen";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { showAlert } from "@/lib/platformAlert";
import { Colors } from "@/constants/theme";
import type { OrganisationNetworkStatus } from "@/types/database";

export default function OrgPaywallRoute() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const [status, setStatus] = useState<OrganisationNetworkStatus | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.org_id) {
        if (!cancelled) setStatus(null);
        return;
      }
      const { data } = await supabase
        .from("organisations")
        .select("status")
        .eq("id", profile.org_id)
        .single();
      if (!cancelled) {
        setStatus((data?.status as OrganisationNetworkStatus) ?? null);
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
          organisationStatus={status ?? undefined}
          onActivateNetwork={() => {
            showAlert(
              status === "grace" ? "Update payment" : "Activate network",
              status === "grace"
                ? "Stripe billing is not wired in this build yet. When live, this opens your subscription."
                : "Stripe checkout is not wired in this build yet. When billing is live, this opens activation."
            );
          }}
          onContinueAsIndividual={async () => {
            await refreshProfile();
            router.replace("/(tabs)");
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
