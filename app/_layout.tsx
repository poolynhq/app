import { useEffect } from "react";
import { Slot, useGlobalSearchParams, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Colors } from "@/constants/theme";
import { View, ActivityIndicator, StyleSheet, LogBox } from "react-native";

if (__DEV__) {
  LogBox.ignoreLogs([/expo-notifications: Android Push notifications/]);
}

SplashScreen.preventAutoHideAsync();

function NavigationGuard() {
  const {
    session,
    isLoading,
    isOnboarded,
    isAdmin,
    isPlatformSuperAdmin,
    commuterSetupFromAdmin,
  } = useAuth();
  const segments = useSegments();
  const searchParams = useGlobalSearchParams<{
    next?: string | string[];
    fromProfile?: string | string[];
  }>();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const fromProfileParam = Array.isArray(searchParams.fromProfile)
      ? searchParams.fromProfile[0]
      : searchParams.fromProfile;
    const onboardingLocationFromProfile =
      segments[0] === "(onboarding)" &&
      segments.at(1) === "location" &&
      fromProfileParam === "1";

    const inSuperAdmin = segments[0] === "super-admin";
    if (inSuperAdmin) {
      if (!session) {
        router.replace("/(auth)/sign-in");
        return;
      }
      if (!isPlatformSuperAdmin) {
        router.replace("/(tabs)/");
      }
      return;
    }

    const inAuthGroup = segments[0] === "(auth)";
    const inPasswordReset = inAuthGroup && segments.at(1) === "reset-password";
    const inOnboardingGroup = segments[0] === "(onboarding)";
    const inPublicGroup = segments[0] === "(public)";
    const inBusinessSetup = inAuthGroup && segments.at(1) === "business-sign-up";
    const nextParam = Array.isArray(searchParams.next)
      ? searchParams.next[0]
      : searchParams.next;
    const wantsBusinessSetup = nextParam === "business-sign-up";

    if (!session) {
      if (!inAuthGroup && !inPublicGroup) router.replace("/(auth)/sign-in");
    } else if (inPasswordReset) {
      return;
    } else if (session && !isAdmin && segments[0] === "(admin)") {
      router.replace("/(tabs)/");
    } else if (isAdmin) {
      if (inAuthGroup) {
        router.replace("/(admin)/");
        return;
      }
      if (inOnboardingGroup && !commuterSetupFromAdmin && !onboardingLocationFromProfile) {
        router.replace("/(admin)/");
        return;
      }
    } else if (!isOnboarded) {
      if (inBusinessSetup) return;
      if (wantsBusinessSetup && inAuthGroup) {
        router.replace("/(auth)/business-sign-up");
        return;
      }
      if (!inOnboardingGroup && !inPublicGroup) router.replace("/(onboarding)/");
    } else {
      if (inAuthGroup || (inOnboardingGroup && !onboardingLocationFromProfile)) {
        router.replace("/(tabs)/");
      }
    }
  }, [
    session,
    isLoading,
    isOnboarded,
    isAdmin,
    isPlatformSuperAdmin,
    commuterSetupFromAdmin,
    segments,
    searchParams.next,
    searchParams.fromProfile,
    router,
  ]);

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <NavigationGuard />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
});
