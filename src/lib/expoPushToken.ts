import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

export async function saveExpoPushTokenForUser(userId: string, token: string): Promise<void> {
  const t = token.trim();
  if (!t) return;

  await supabase.from("user_push_tokens").upsert(
    { user_id: userId, expo_push_token: t, updated_at: new Date().toISOString() },
    { onConflict: "user_id,expo_push_token" }
  );
}

export function shouldRegisterPushOnThisPlatform(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}
