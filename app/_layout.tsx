import { useEffect } from "react";
import {
  Slot,
  useGlobalSearchParams,
  usePathname,
  useRouter,
  useSegments,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Colors } from "@/constants/theme";
import {
  isAccountSignupBlockedOnWeb,
  isWebPublicAuthPath,
  MARKETING_BLOCKED_AUTH_SEGMENTS,
} from "@/lib/marketingWebRestrictions";
import {
  isPoolynSignupClosed,
  SIGNUP_CLOSED_AUTH_SEGMENTS,
} from "@/lib/poolynSignupClosed";
import { View, ActivityIndicator, StyleSheet, LogBox, Platform } from "react-native";
import { CommuteLocationGateHost } from "@/components/CommuteLocationGateHost";
import { StripeProviderGate } from "@/components/StripeProviderGate";

if (__DEV__) {
  LogBox.ignoreLogs([/expo-notifications: Android Push notifications/]);
}

SplashScreen.preventAutoHideAsync();

/** Canonical path from the address bar (source of truth on web static export). */
function getBrowserPathname(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") return "";
  let p = window.location.pathname || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (/\/index\.html$/i.test(p)) {
    p = p.replace(/\/index\.html$/i, "") || "/";
  }
  return p || "/";
}

function normalizeRouterPath(path: string): string {
  const p = (path || "/").replace(/\/$/, "") || "/";
  return p;
}

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
  const pathname = usePathname();
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
        router.replace("/(tabs)/home");
      }
      return;
    }

    const inAuthGroup = segments[0] === "(auth)";
    const inPasswordReset = inAuthGroup && segments.at(1) === "reset-password";
    const inOnboardingGroup = segments[0] === "(onboarding)";
    const inPublicGroup = segments[0] === "(public)";
    const browserPath = getBrowserPathname();
    const routerPath = normalizeRouterPath(pathname);
    /** URL bar is the source of truth; do not treat routerPath "still on /" as marketing when user already opened /sign-in etc. */
    const onPublicWebMarketing =
      Platform.OS === "web" &&
      (browserPath === "/" || browserPath === "/terms");
    const inBusinessSetup = inAuthGroup && segments.at(1) === "business-sign-up";
    const nextParam = Array.isArray(searchParams.next)
      ? searchParams.next[0]
      : searchParams.next;
    const wantsBusinessSetup = nextParam === "business-sign-up";

    if (!session) {
      /*
       * Web marketing: `app/index.tsx` often yields segments like ["index"], not "(public)".
       * expo-router pathname can also hydrate as /sign-in while the address bar is still /.
       * Never send anonymous visitors on / or /terms to sign-in; reconcile router to the URL.
       * If the router already moved to sign-in (etc.) while the bar is briefly still `/`, do not
       * replace back to `/` or the Sign in action is cancelled.
       */
      if (Platform.OS === "web") {
        const bar = browserPath;
        if (bar === "/" || bar === "/terms") {
          if (bar === "/" && routerPath !== "/" && routerPath !== "/terms") {
            if (!isWebPublicAuthPath(routerPath)) {
              router.replace("/");
              return;
            }
            return;
          }
          if (bar === "/terms" && routerPath !== "/terms") {
            router.replace("/(public)/terms");
            return;
          }
          const authChild = segments.at(1);
          if (
            inAuthGroup &&
            authChild &&
            MARKETING_BLOCKED_AUTH_SEGMENTS.has(authChild) &&
            isAccountSignupBlockedOnWeb()
          ) {
            router.replace("/");
            return;
          }
          return;
        }
      }

      const authChildForClosed = segments.at(1);
      if (
        isPoolynSignupClosed() &&
        inAuthGroup &&
        authChildForClosed &&
        SIGNUP_CLOSED_AUTH_SEGMENTS.has(authChildForClosed)
      ) {
        router.replace("/(auth)/signup-closed");
        return;
      }

      if (!segments[0] && !onPublicWebMarketing) return;

      const authChild = segments.at(1);
      if (
        Platform.OS === "web" &&
        inAuthGroup &&
        authChild &&
        MARKETING_BLOCKED_AUTH_SEGMENTS.has(authChild) &&
        isAccountSignupBlockedOnWeb()
      ) {
        router.replace("/");
        return;
      }

      if (!inAuthGroup && !inPublicGroup && !onPublicWebMarketing) {
        router.replace("/(auth)/sign-in");
      }
    } else if (inPasswordReset) {
      return;
    } else if (session && !isAdmin && segments[0] === "(admin)") {
      router.replace("/(tabs)/home");
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
      if (inAuthGroup) {
        router.replace("/(tabs)/home");
        return;
      }
      if (inOnboardingGroup && !commuterSetupFromAdmin && !onboardingLocationFromProfile) {
        router.replace(isAdmin ? "/(admin)/" : "/(tabs)/home");
        return;
      }
    } else {
      if (inAuthGroup || (inOnboardingGroup && !onboardingLocationFromProfile)) {
        router.replace("/(tabs)/home");
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
    pathname,
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
      <StripeProviderGate>
        <StatusBar style="dark" />
        <NavigationGuard />
        <CommuteLocationGateHost />
      </StripeProviderGate>
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
