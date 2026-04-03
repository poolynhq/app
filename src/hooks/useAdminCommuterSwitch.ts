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
      // Use group root (not .../index) so web matches the same route as NavigationGuard / join-org.
      router.push("/(onboarding)/");
      return;
    }
    router.push("/(tabs)/");
  }, [profile?.onboarding_completed, router, startCommuterSetupFromAdmin]);
}
