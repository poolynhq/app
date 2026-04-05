import type { Schedule, WeekdayTimes } from "@/types/database";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * When true, commute matching skips departure-time alignment (for local / QA testing).
 * Set EXPO_PUBLIC_POOLYN_IGNORE_COMMUTE_SCHEDULE=1 in .env — never enable in production builds
 * you ship to real users.
 */
export function shouldIgnoreCommuteSchedule(): boolean {
  const v = process.env.EXPO_PUBLIC_POOLYN_IGNORE_COMMUTE_SCHEDULE;
  return v === "1" || v === "true";
}

function parseDepartMinutes(depart: string | undefined): number | null {
  if (!depart || typeof depart !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(depart.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

type Normalized = {
  usable: boolean;
  times: WeekdayTimes;
  tolerance: number;
};

function normalizeSchedule(s: Schedule | null | undefined): Normalized {
  if (!s || s.active === false) {
    return { usable: false, times: {}, tolerance: 15 };
  }
  if (s.type && s.type !== "fixed_weekly") {
    return { usable: false, times: {}, tolerance: 15 };
  }
  const wt =
    s.weekday_times && typeof s.weekday_times === "object"
      ? (s.weekday_times as WeekdayTimes)
      : {};
  const hasAny = WEEKDAYS.some((day) => {
    const x = wt[day];
    return Boolean(x && typeof x.depart === "string" && x.depart.length > 0);
  });
  if (!hasAny) {
    return { usable: false, times: {}, tolerance: s.tolerance_mins ?? 15 };
  }
  return { usable: true, times: wt, tolerance: s.tolerance_mins ?? 15 };
}

/**
 * Compare two users' fixed weekly departure times (to-work). Returns a 0–1 overlap score
 * and whether the pair should proceed to geometry / detour matching.
 */
export function computePairCommuteScheduleOverlap(
  driverSchedule: Schedule | null | undefined,
  passengerSchedule: Schedule | null | undefined,
  driverFlexMins: number,
  passengerFlexMins: number
): { passes: boolean; ratio: number } {
  if (shouldIgnoreCommuteSchedule()) {
    return { passes: true, ratio: 1 };
  }

  const d = normalizeSchedule(driverSchedule);
  const p = normalizeSchedule(passengerSchedule);

  if (!d.usable && !p.usable) {
    return { passes: true, ratio: 0.75 };
  }
  if (!d.usable || !p.usable) {
    return { passes: true, ratio: 0.65 };
  }

  const threshold =
    (d.tolerance + p.tolerance) / 2 + (driverFlexMins + passengerFlexMins) / 2;

  let both = 0;
  let matched = 0;
  for (const day of WEEKDAYS) {
    const ta = d.times[day];
    const tb = p.times[day];
    if (!ta?.depart || !tb?.depart) continue;
    const ma = parseDepartMinutes(ta.depart);
    const mb = parseDepartMinutes(tb.depart);
    if (ma === null || mb === null) continue;
    both += 1;
    if (Math.abs(ma - mb) <= threshold) matched += 1;
  }

  if (both === 0) {
    return { passes: true, ratio: 0.7 };
  }

  const ratio = matched / both;
  const passes = matched >= 1 && ratio >= 0.2;
  return { passes, ratio };
}
