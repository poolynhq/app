import { Platform } from "react-native";

/**
 * Supabase Storage on web often rejects raw ArrayBuffer/Uint8Array with HTTP 400 (vague "schema" errors).
 * Prefer Blob with an explicit MIME type. Native: Blob when available, else Uint8Array.
 */
export function storageUploadBody(buffer: ArrayBuffer, contentType: string): Blob | Uint8Array {
  const ct = contentType.split(";")[0].trim() || "application/octet-stream";
  if (Platform.OS === "web" || typeof Blob !== "undefined") {
    try {
      return new Blob([buffer], { type: ct });
    } catch {
      /* fall through */
    }
  }
  return new Uint8Array(buffer);
}

/**
 * Picker URIs on web are often `blob:http://...` with no file extension.
 * Guessing type from `uri.split(".").pop()` breaks Storage (bad path + invalid Content-Type).
 */
export function logoObjectNameAndContentType(
  uri: string,
  responseContentType: string | null,
  bytes: ArrayBuffer
): { objectName: string; contentType: string } {
  const base = "logo";
  const ct = (responseContentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct === "image/jpeg" || ct === "image/jpg") {
    return { objectName: `${base}.jpg`, contentType: "image/jpeg" };
  }
  if (ct === "image/png") {
    return { objectName: `${base}.png`, contentType: "image/png" };
  }
  if (ct === "image/webp") {
    return { objectName: `${base}.webp`, contentType: "image/webp" };
  }

  const pathOnly = uri.split("?")[0];
  const extMatch = pathOnly.match(/\.(jpe?g|png|webp)$/i);
  if (extMatch) {
    const e = extMatch[1].toLowerCase();
    if (e === "jpeg" || e === "jpg") {
      return { objectName: `${base}.jpg`, contentType: "image/jpeg" };
    }
    if (e === "png") {
      return { objectName: `${base}.png`, contentType: "image/png" };
    }
    if (e === "webp") {
      return { objectName: `${base}.webp`, contentType: "image/webp" };
    }
  }

  const n = Math.min(16, bytes.byteLength);
  const v = n > 0 ? new Uint8Array(bytes.slice(0, n)) : new Uint8Array(0);
  if (v.length >= 3 && v[0] === 0xff && v[1] === 0xd8 && v[2] === 0xff) {
    return { objectName: `${base}.jpg`, contentType: "image/jpeg" };
  }
  if (
    v.length >= 8 &&
    v[0] === 0x89 &&
    v[1] === 0x50 &&
    v[2] === 0x4e &&
    v[3] === 0x47
  ) {
    return { objectName: `${base}.png`, contentType: "image/png" };
  }
  if (
    v.length >= 12 &&
    v[0] === 0x52 &&
    v[1] === 0x49 &&
    v[2] === 0x46 &&
    v[3] === 0x46 &&
    v[8] === 0x57 &&
    v[9] === 0x45 &&
    v[10] === 0x42 &&
    v[11] === 0x50
  ) {
    return { objectName: `${base}.webp`, contentType: "image/webp" };
  }

  return { objectName: `${base}.jpg`, contentType: "image/jpeg" };
}
