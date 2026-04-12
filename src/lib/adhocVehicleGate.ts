import { supabase } from "@/lib/supabase";

/** Same rules as poolyn_create_adhoc_listing: active vehicle with more than one passenger seat. */
export async function hasAdhocPostingVehicle(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("vehicles")
    .select("id")
    .eq("user_id", userId)
    .eq("active", true)
    .gt("seats", 1)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return !!data;
}
