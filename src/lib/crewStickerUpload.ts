import { supabase } from "@/lib/supabase";

/** Hosted Storage sometimes returns this when bucket/RLS is misconfigured. */
export function humanizeCrewStickerStorageError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("schema") && m.includes("invalid")) {
    return "Sticker uploads need the crew-stickers storage bucket and policies. Run migrations through 0069 (0069 creates the bucket if you only ran 0068), then retry.";
  }
  if (m.includes("incompatible")) {
    return "Sticker storage rejected the upload. Confirm migrations are applied and you are the crew owner, then try again.";
  }
  return message;
}

function toStorageFileBody(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

/**
 * Uploads JPEG bytes to `crew-stickers/{crewId}/sticker.jpg`. Caller must be crew owner (storage RLS).
 */
export async function uploadCrewStickerJpeg(
  crewId: string,
  body: ArrayBuffer
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const path = `${crewId}/sticker.jpg`;
  const { error } = await supabase.storage.from("crew-stickers").upload(path, toStorageFileBody(body), {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: true,
  });
  if (error) return { ok: false, message: humanizeCrewStickerStorageError(error.message) };
  return { ok: true, path };
}

export function getCrewStickerPublicUrl(storagePath: string): string {
  return supabase.storage.from("crew-stickers").getPublicUrl(storagePath).data.publicUrl;
}
