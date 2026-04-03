import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { User } from "@/types/database";
import { getRolePalette } from "@/constants/theme";

interface AuthState {
  session: Session | null;
  profile: User | null;
  isLoading: boolean;
  isOnboarded: boolean;
  /** Workplace network admin for a managed (enterprise) organisation only */
  isAdmin: boolean;
  /** Poolyn operator: row in platform_super_admins; can open /super-admin */
  isPlatformSuperAdmin: boolean;
}

interface AuthContextValue extends AuthState {
  /**
   * When true, NavigationGuard allows enterprise admins into (onboarding) so they can
   * complete commuter profile (vehicle, routes, schedule) before using tabs.
   */
  commuterSetupFromAdmin: boolean;
  startCommuterSetupFromAdmin: () => void;
  finishCommuterSetupFromAdmin: () => void;
  /** The palette currently in use: driver=blue, passenger=green, both/flexible=orange */
  rolePalette: ReturnType<typeof getRolePalette>;
  /** For 'both' role users: the mode they are currently in ('driver'|'passenger'|null) */
  activeMode: "driver" | "passenger" | null;
  /** Lets 'both' role users toggle which mode they are in today */
  toggleMode: (mode: "driver" | "passenger") => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: AuthError | Error | null }>;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [commuterSetupFromAdmin, setCommuterSetupFromAdmin] = useState(false);

  const [state, setState] = useState<AuthState>({
    session: null,
    profile: null,
    isLoading: true,
    isOnboarded: false,
    isAdmin: false,
    isPlatformSuperAdmin: false,
  });

  const startCommuterSetupFromAdmin = useCallback(() => {
    setCommuterSetupFromAdmin(true);
  }, []);

  const finishCommuterSetupFromAdmin = useCallback(() => {
    setCommuterSetupFromAdmin(false);
  }, []);

  const fetchOrCreateProfile = useCallback(
    async (_userId: string, _email: string, _fullName?: string) => {
      // First try a direct read (fastest path for existing users)
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", _userId)
        .single();

      if (data) return data;

      // Profile missing — call the SECURITY DEFINER RPC that safely
      // creates the org + user row server-side (no client INSERT needed,
      // no RLS gaps required).
      const { data: bootstrapped, error: rpcError } = await supabase.rpc(
        "bootstrap_user_profile"
      );

      if (rpcError) {
        console.error("bootstrap_user_profile failed:", rpcError.message);
        return null;
      }

      return bootstrapped as User | null;
    },
    []
  );

  const fetchPlatformSuperAdminFlag = useCallback(async (): Promise<boolean> => {
    const { data, error } = await supabase.rpc("is_platform_super_admin");
    if (error) return false;
    return data === true;
  }, []);

  /** Only a paid / formal “managed” workplace network uses the admin console — not legacy organic orgs. */
  const isEnterpriseNetworkAdmin = useCallback(async (profile: User | null) => {
    if (!profile?.org_id || profile.org_role !== "admin") return false;
    const { data, error } = await supabase
      .from("organisations")
      .select("org_type")
      .eq("id", profile.org_id)
      .maybeSingle();
    if (error || !data) return false;
    return data.org_type === "enterprise";
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.session?.user) return;
    const { id, email, user_metadata } = state.session.user;
    const profile = await fetchOrCreateProfile(
      id,
      email ?? "",
      user_metadata?.full_name
    );
    const isPlatformSuperAdmin = await fetchPlatformSuperAdminFlag();
    const isAdmin = await isEnterpriseNetworkAdmin(profile);
    if (profile) {
      setState((prev) => ({
        ...prev,
        profile,
        isOnboarded: profile.onboarding_completed,
        isAdmin,
        isPlatformSuperAdmin,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        profile: null,
        isOnboarded: false,
        isAdmin: false,
        isPlatformSuperAdmin,
      }));
    }
  }, [
    state.session?.user,
    fetchOrCreateProfile,
    fetchPlatformSuperAdminFlag,
    isEnterpriseNetworkAdmin,
  ]);

  useEffect(() => {
    async function applySession(session: Session | null) {
      if (!session?.user) {
        setCommuterSetupFromAdmin(false);
        setState({
          session: null,
          profile: null,
          isLoading: false,
          isOnboarded: false,
          isAdmin: false,
          isPlatformSuperAdmin: false,
        });
        return;
      }
      const { id, email, user_metadata } = session.user;
      const profile = await fetchOrCreateProfile(
        id,
        email ?? "",
        user_metadata?.full_name
      );
      const isPlatformSuperAdmin = await fetchPlatformSuperAdminFlag();
      const isAdmin = await isEnterpriseNetworkAdmin(profile);
      setState({
        session,
        profile,
        isLoading: false,
        isOnboarded: profile?.onboarding_completed ?? false,
        isAdmin,
        isPlatformSuperAdmin,
      });
    }

    supabase.auth.getSession().then(({ data: { session } }) => applySession(session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => subscription.unsubscribe();
  }, [fetchOrCreateProfile, fetchPlatformSuperAdminFlag, isEnterpriseNetworkAdmin]);

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      // TEMP: disabled for local/testing signup flows.
      // Re-enable before production rollout.
      // if (!isWorkEmail(email)) {
      //   return {
      //     error: new Error(
      //       "Please use your work or university email address."
      //     ),
      //   };
      // }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (error) {
        return { error };
      }

      // Supabase can return an obfuscated success for existing emails when
      // email confirmation is enabled. identities.length === 0 indicates
      // the user already exists.
      if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
        return {
          error: new Error("This email is already registered. Please sign in instead."),
        };
      }

      return { error: null };
    },
    []
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error };
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Server request failed — force local session clear so the app
      // can still navigate away cleanly.
      setCommuterSetupFromAdmin(false);
      setState({
        session: null,
        profile: null,
        isLoading: false,
        isOnboarded: false,
        isAdmin: false,
        isPlatformSuperAdmin: false,
      });
    }
  }, []);

  // ── Derived role/mode values ────────────────────────────────────────────────

  const activeMode = useMemo<"driver" | "passenger" | null>(() => {
    if (!state.profile) return null;
    const { role, active_mode } = state.profile;
    if (role === "driver") return "driver";
    if (role === "passenger") return "passenger";
    // 'both' role — use stored active_mode (may be null = flexible/not-yet-set)
    return active_mode ?? null;
  }, [state.profile]);

  const rolePalette = useMemo(
    () => getRolePalette(state.profile?.role ?? "both", activeMode),
    [state.profile?.role, activeMode]
  );

  const toggleMode = useCallback(
    async (mode: "driver" | "passenger") => {
      if (!state.profile?.id) return;
      // Optimistic update
      setState((prev) => ({
        ...prev,
        profile: prev.profile ? { ...prev.profile, active_mode: mode } : null,
      }));
      await supabase
        .from("users")
        .update({ active_mode: mode })
        .eq("id", state.profile.id);
    },
    [state.profile?.id]
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        commuterSetupFromAdmin,
        startCommuterSetupFromAdmin,
        finishCommuterSetupFromAdmin,
        activeMode,
        rolePalette,
        toggleMode,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
