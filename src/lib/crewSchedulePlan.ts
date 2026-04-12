import type { CrewMemberMapPin, CrewScheduleMode } from "@/lib/crewMessaging";

/** Normalize any integer to 0..1439 */
export function modMinutes(m: number): number {
  return ((m % 1440) + 1440) % 1440;
}

export function formatMinutesAsTime(mins: number): string {
  const m = modMinutes(Math.round(mins));
  const h24 = Math.floor(m / 60);
  const mi = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${mi.toString().padStart(2, "0")} ${ampm}`;
}

export type RiderReadyLine = {
  userId: string;
  label: string;
  readyByMinutes: number;
};

export type CrewSchedulePlanResult = {
  totalDriveMin: number;
  driverDepartMinutes: number;
  destinationArrivalMinutes: number;
  riderLines: RiderReadyLine[];
};

/**
 * Plan driver departure, destination arrival, and per-rider "ready by" times.
 * Splits the base corridor minutes across legs and adds each pickup detour in visit order.
 */
export function computeCrewSchedulePlan(params: {
  mode: CrewScheduleMode;
  /** Minutes from midnight for anchor (arrival at destination or driver departure). */
  anchorMinutes: number;
  /** Home to work (or active leg) duration in minutes, from profile route. */
  baseCorridorMinutes: number;
  /** Pickups in visit order with extra minutes each. */
  orderedPickups: { pin: CrewMemberMapPin; extraMin: number }[];
}): CrewSchedulePlanResult {
  const anchor = modMinutes(params.anchorMinutes);
  const extras = params.orderedPickups.map((o) => Math.max(0, o.extraMin));
  const sumExtra = extras.reduce((a, b) => a + b, 0);
  const base = Math.max(1, params.baseCorridorMinutes);
  const totalDriveMin = Math.max(1, Math.round(base + sumExtra));

  let driverDepartMinutes: number;
  let destinationArrivalMinutes: number;

  if (params.mode === "arrival") {
    destinationArrivalMinutes = anchor;
    driverDepartMinutes = modMinutes(anchor - totalDriveMin);
  } else {
    driverDepartMinutes = anchor;
    destinationArrivalMinutes = modMinutes(anchor + totalDriveMin);
  }

  const n = params.orderedPickups.length;
  const legBase = n === 0 ? base : base / (n + 1);
  const riderLines: RiderReadyLine[] = [];
  let cum = driverDepartMinutes;
  for (let i = 0; i < n; i++) {
    const extra = extras[i] ?? 0;
    cum = modMinutes(cum + legBase + extra);
    const name = (params.orderedPickups[i].pin.fullName || "Rider").trim();
    riderLines.push({
      userId: params.orderedPickups[i].pin.userId,
      label: name,
      readyByMinutes: modMinutes(cum - 5),
    });
  }

  return {
    totalDriveMin,
    driverDepartMinutes,
    destinationArrivalMinutes,
    riderLines,
  };
}
