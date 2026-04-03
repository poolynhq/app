import { supabase } from "@/lib/supabase";

/** Resolves users.avatar_url: full URL passthrough, or storage path in `avatars` bucket. */
export function resolveAvatarDisplayUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl?.trim()) return null;
  const v = avatarUrl.trim();
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  const { data } = supabase.storage.from("avatars").getPublicUrl(v);
  return data.publicUrl;
}
