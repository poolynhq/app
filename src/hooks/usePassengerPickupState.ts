import { useCallback, useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "@/lib/supabase";
import { listMyUpcomingRidesAsPassenger, type PassengerUpcomingRide } from "@/lib/passengerRides";
import { runExpireStalePickupRequests } from "@/lib/rideRequests";

export type PassengerPendingRequest = {
  id: string;
  direction: string;
  desired_depart_at: string;
  flexibility_mins: number;
  status: string;
  expires_at: string;
};

export function usePassengerPickupState(passengerId: string | null, enabled: boolean) {
  const [pending, setPending] = useState<PassengerPendingRequest | null>(null);
  const [upcomingRides, setUpcomingRides] = useState<PassengerUpcomingRide[]>([]);

  const load = useCallback(async () => {
    if (!passengerId || !enabled) {
      setPending(null);
      setUpcomingRides([]);
      return;
    }
    await runExpireStalePickupRequests();
    const [pRes, rides] = await Promise.all([
      supabase
        .from("ride_requests")
        .select("id, direction, desired_depart_at, flexibility_mins, status, expires_at")
        .eq("passenger_id", passengerId)
        .eq("status", "pending")
        .maybeSingle(),
      listMyUpcomingRidesAsPassenger(passengerId),
    ]);
    setPending((pRes.data as PassengerPendingRequest | null) ?? null);
    setUpcomingRides(rides);
  }, [passengerId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!passengerId || !enabled) return;

    const channel = supabase
      .channel(`pickup-state-${passengerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_requests",
          filter: `passenger_id=eq.${passengerId}`,
        },
        () => void load()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_passengers",
          filter: `passenger_id=eq.${passengerId}`,
        },
        () => void load()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [passengerId, enabled, load]);

  useEffect(() => {
    if (!passengerId || !enabled) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [passengerId, enabled, load]);

  useEffect(() => {
    if (!passengerId || !enabled) return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") void load();
    });
    return () => sub.remove();
  }, [passengerId, enabled, load]);

  return { pending, upcomingRides, reload: load };
}
