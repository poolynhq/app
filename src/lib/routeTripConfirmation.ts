import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "poolyn_route_confirm_counts_v1";

export type CommuteDirectionKey = "to_work" | "from_work";

type Counts = Partial<Record<CommuteDirectionKey, number>>;

async function readCounts(): Promise<Counts> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== "object" || o === null) return {};
    return o as Counts;
  } catch {
    return {};
  }
}

async function writeCounts(c: Counts): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

/** How many successful trip actions (e.g. posted pickup) already taken for this direction. */
export async function getRouteConfirmationCount(dir: CommuteDirectionKey): Promise<number> {
  const c = await readCounts();
  const n = c[dir];
  return typeof n === "number" && n >= 0 ? n : 0;
}

/**
 * Lone Poolyn: first few uses per direction should double-check destination; after this many,
 * the app can show the route summary without an extra confirmation step.
 */
export const ROUTE_CONFIRMATION_THRESHOLD = 3;

export async function incrementRouteConfirmationCount(dir: CommuteDirectionKey): Promise<void> {
  const c = await readCounts();
  const prev = typeof c[dir] === "number" ? c[dir]! : 0;
  c[dir] = prev + 1;
  await writeCounts(c);
}

export async function needsRouteDestinationDoubleCheck(dir: CommuteDirectionKey): Promise<boolean> {
  const n = await getRouteConfirmationCount(dir);
  return n < ROUTE_CONFIRMATION_THRESHOLD;
}
