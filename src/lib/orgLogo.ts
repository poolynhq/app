import { supabase } from "@/lib/supabase";
import type { Organisation } from "@/types/database";
import type { StorageError } from "@supabase/storage-js";

export function organisationSettingsRecord(
  settings: Organisation["settings"]
): Record<string, unknown> {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    return { ...(settings as Record<string, unknown>) };
  }
  return {};
}

/** Public URL for org logo in `org-logos` when `settings.logo_path` is set. */
export function getOrganisationLogoPublicUrl(org: Organisation | null | undefined): string | null {
  const lp = String(organisationSettingsRecord(org?.settings ?? null).logo_path ?? "").trim();
  if (!lp) return null;
  return supabase.storage.from("org-logos").getPublicUrl(lp).data.publicUrl ?? null;
}

/**
 * Insert-only upload: avoids upsert (which can require extra SELECT/UPDATE policy paths).
 * Removes any existing object at `path` first, then uploads with upsert disabled.
 */
export async function uploadOrganisationLogoObject(
  path: string,
  fileBody: Blob | File | ArrayBuffer | Uint8Array,
  options: { contentType: string }
): Promise<{ error: StorageError | null }> {
  const bucket = supabase.storage.from("org-logos");
  await bucket.remove([path]);
  const { error } = await bucket.upload(path, fileBody, {
    contentType: options.contentType,
    cacheControl: "3600",
    upsert: false,
  });
  return { error };
}
