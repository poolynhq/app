import AsyncStorage from "@react-native-async-storage/async-storage";

/** Local calendar date `YYYY-MM-DD` (device timezone). */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dailyLocationStorageKey(dateStr: string): string {
  return `poolyn_daily_loc_v1_${dateStr}`;
}

export async function hasCompletedDailyLocationCheckForDate(dateStr: string): Promise<boolean> {
  const v = await AsyncStorage.getItem(dailyLocationStorageKey(dateStr));
  return v === "done";
}

export async function markDailyLocationCheckComplete(dateStr: string): Promise<void> {
  await AsyncStorage.setItem(dailyLocationStorageKey(dateStr), "done");
}
