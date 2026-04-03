import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "@/lib/supabase";

const AVATAR_MAX_WIDTH = 640;
const AVATAR_JPEG_QUALITY = 0.62;

/**
 * Resize + JPEG-compress so Storage gets a small body (helps avoid 502/503 timeouts).
 * Falls back to the original URI if manipulation fails (e.g. some web edge cases).
 */
export async function prepareAvatarJpegBuffer(uri: string): Promise<ArrayBuffer> {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: AVATAR_MAX_WIDTH } }],
      {
        compress: AVATAR_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    const res = await fetch(manipulated.uri);
    if (!res.ok) {
      throw new Error(`compress fetch ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 0) {
      return buf;
    }
    throw new Error("empty compressed buffer");
  } catch {
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error(`Could not read image (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) {
      throw new Error("Image is empty");
    }
    return buf;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** HTTP status from StorageApiError (do not use JSON `statusCode` for retry logic). */
function storageHttpStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: number }).status;
    return typeof s === "number" && Number.isFinite(s) ? s : null;
  }
  return null;
}

function storageStatusCodeField(err: unknown): string | null {
  if (err && typeof err === "object" && "statusCode" in err) {
    const c = (err as { statusCode?: string }).statusCode;
    return c != null ? String(c) : null;
  }
  return null;
}

/** Prefer raw bytes + Content-Type; multipart Blob uploads often return 400 from the Storage gateway on web. */
function toStorageFileBody(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

export type AvatarUploadResult =
  | { ok: true; path: string }
  | { ok: false; message: string; statusCode: string | null };

/**
 * Authenticated bucket upload (session must be present). Retries only on 5xx.
 * Signed-URL uploads are avoided here: they can fail or disagree with row rules on some hosts.
 */
export async function uploadUserAvatarJpeg(
  userId: string,
  body: ArrayBuffer
): Promise<AvatarUploadResult> {
  const path = `${userId}/avatar.jpg`;
  const fileBody = toStorageFileBody(body);

  let lastMsg = "Upload failed";
  let lastHttp: number | null = null;
  let lastAppCode: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.storage.from("avatars").upload(path, fileBody, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: true,
    });
    if (!error) {
      return { ok: true, path };
    }
    lastMsg = error.message || lastMsg;
    lastHttp = storageHttpStatus(error);
    lastAppCode = storageStatusCodeField(error);

    const retry5xx = lastHttp != null && lastHttp >= 500 && lastHttp < 600;
    if (retry5xx && attempt < 2) {
      await sleep(700 * (attempt + 1) ** 2);
      continue;
    }
    break;
  }
  const codeLabel =
    lastHttp != null
      ? String(lastHttp)
      : lastAppCode;
  return { ok: false, message: lastMsg, statusCode: codeLabel };
}
