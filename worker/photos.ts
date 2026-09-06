/**
 * Profile photos, as objects in R2.
 *
 * No image library anywhere. The page resizes on a canvas before uploading
 * and the ingest script resizes before posting, so the worker's whole job is
 * to check that what arrived really is an image, cap its size, and put it. A
 * decoder is exactly the dependency you do not want in the hot path of an app
 * that accepts files from four thousand strangers.
 */

/** Two megabytes after the sender has already resized. Larger is a bug or a probe. */
export const MAX_BYTES = 2 * 1024 * 1024;

const MAGIC: [number[], string, string][] = [
  [[0xff, 0xd8, 0xff], "jpg", "image/jpeg"],
  [[0x89, 0x50, 0x4e, 0x47], "png", "image/png"],
];

/**
 * Trust the bytes, never the content-type header. A caller who says "image"
 * and sends a script is the only interesting case, and the header is the part
 * they control.
 */
export function sniff(bytes: Uint8Array): { ext: string; type: string } | null {
  for (const [magic, ext, type] of MAGIC) {
    if (magic.every((b, i) => bytes[i] === b)) return { ext, type };
  }
  const ascii = (at: number, text: string) =>
    [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { ext: "webp", type: "image/webp" };
  return null;
}

/** A key that cannot address anything but a photo. */
export const safeKey = (key: string) => /^p\/[a-z0-9-]+\.(jpg|png|webp)$/.test(key);

export async function put(bucket: R2Bucket, personId: string, bytes: Uint8Array) {
  const kind = sniff(bytes);
  if (!kind || bytes.byteLength > MAX_BYTES) return null;
  // The random suffix is a cache buster. The same path serving a new face is
  // the one thing a browser is guaranteed to get wrong.
  const key = `p/${personId}-${crypto.randomUUID().slice(0, 6)}.${kind.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  return key;
}

export async function drop(bucket: R2Bucket, key: string | null) {
  if (key && safeKey(key)) await bucket.delete(key);
}
