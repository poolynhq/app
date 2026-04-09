import { useEffect, useRef, useState, useCallback } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { evaluateCommuteStartLocation } from "@/lib/commuteStartLocationCheck";
import {
  localDateKey,
  markDailyLocationCheckComplete,
  hasCompletedDailyLocationCheckForDate,
} from "@/lib/dailyCommuteLocationGate";
import { CommuteStartLocationGateModal } from "@/components/home/CommuteStartLocationGateModal";

/**
 * Lone Poolyn: once per local calendar day, on first app foreground, check commute start vs GPS.
 * No UI if within tolerance; modal only when there is a meaningful delta.
 */
export function CommuteLocationGateHost() {
  const { session, profile } = useAuth();
  const [gate, setGate] = useState<{
    meters: number;
    anchor: "home" | "work";
    canAcceptDifference: boolean;
  } | null>(null);
  const runningRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (!session || !profile?.onboarding_completed) return;
    if (!profile.home_location || !profile.work_location) return;
    if (runningRef.current) return;

    const dateStr = localDateKey();
    const already = await hasCompletedDailyLocationCheckForDate(dateStr);
    if (already) return;

    runningRef.current = true;
    try {
      const r = await evaluateCommuteStartLocation({
        home_location: profile.home_location,
        work_location: profile.work_location,
      });

      if (r.kind === "away_from_start") {
        setGate({
          meters: r.meters,
          anchor: r.anchor,
          canAcceptDifference: r.canAcceptDifference,
        });
        return;
      }

      await markDailyLocationCheckComplete(dateStr);
    } finally {
      runningRef.current = false;
    }
  }, [session, profile]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") void runCheck();
    });

    void runCheck();

    return () => sub.remove();
  }, [runCheck]);

  const dismissGate = useCallback(async () => {
    const dateStr = localDateKey();
    await markDailyLocationCheckComplete(dateStr);
    setGate(null);
  }, []);

  return (
    <CommuteStartLocationGateModal
      visible={!!gate}
      meters={gate?.meters ?? 0}
      anchor={gate?.anchor ?? "home"}
      canAcceptDifference={gate?.canAcceptDifference ?? false}
      onAcceptDifference={dismissGate}
      onDismiss={dismissGate}
    />
  );
}
