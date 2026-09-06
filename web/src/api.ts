/* Every call the page makes. One place, so a route rename breaks the build. */

import type { Candidate, Me, Segment, Settings } from "../../shared/schema";

export class NeedsSignIn extends Error {
  constructor(readonly canSignIn: boolean) {
    super("sign in");
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { signIn?: boolean };
    throw new NeedsSignIn(body.signIn !== false);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

const send = <T>(path: string, method: string, body: unknown) =>
  call<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const me = () => call<Me>("/api/me");
export const queue = (n = 24) =>
  call<{ people: Candidate[] }>(`/api/queue?n=${n}`).then((r) => r.people);
export const rate = (subject: string, strength: number, context?: string) =>
  send("/api/rate", "POST", { subject, strength, context });
export const skip = (subject: string) => send("/api/skip", "POST", { subject });
export const undo = (subject: string) => send("/api/undo", "POST", { subject });
export const search = (q: string) =>
  call<{ people: Candidate[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.people);
export const lists = () => call<{ majors: string[]; dorms: string[] }>("/api/lists");
export const save = (patch: {
  name?: string;
  major?: string | null;
  dorm?: string | null;
  accent?: string | null;
  flavour?: string | null;
}) => send<Me>("/api/me", "PATCH", patch);
export const withdraw = () =>
  send<{ withdrawn: boolean }>("/api/me/withdraw", "POST", { confirm: "withdraw" });
export const signOut = () => send("/auth/out", "POST", {});
export const dropPhoto = () => call<Me>("/api/me/photo", { method: "DELETE" });
export const uploadPhoto = (blob: Blob) =>
  call<Me>("/api/me/photo", { method: "POST", body: blob, headers: { "content-type": blob.type } });
export const settings = () => call<Settings>("/api/admin");
export const setSegments = (segments: Segment[]) =>
  send<Settings>("/api/admin", "PUT", { segments });

/**
 * Shrink before uploading.
 *
 * A phone hands over four thousand pixels of a face that will be shown at two
 * hundred, and neither the worker nor R2 has an image library to fix that
 * with. The browser already has a decoder and an encoder, so the resize
 * happens here, where the picture already is.
 */
export async function shrink(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("could not encode"))),
      "image/jpeg",
      0.85,
    ),
  );
}
