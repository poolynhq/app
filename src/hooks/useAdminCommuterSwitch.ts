import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

/** Enterprise admin: open commuter tabs, or commuter onboarding first if not completed. */
export function useAdminCommuterSwitch() {
  const router = useRouter();
  const { profile, startCommuterSetupFromAdmin } = useAuth();

  return useCallback(() => {
    if (!profile?.onboarding_completed) {
      startCommuterSetupFromAdmin();
    }
    router.push("/(tabs)/home");
  }, [profile?.onboarding_completed, router, startCommuterSetupFromAdmin]);
}
