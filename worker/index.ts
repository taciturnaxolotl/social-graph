/**
 * Every route the page can call, and the sign-in dance in front of them.
 *
 * The shape is deliberately small: one endpoint hands out a batch of people
 * to rate, one records an answer, and the rest is housekeeping. The page
 * holds a queue and posts answers as they happen, so the rating loop never
 * waits on a round trip, which is the only performance requirement this app
 * really has.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Me, Settings } from "../shared/schema";
import { isSegment, MAX_CONTEXT, validStrength } from "../shared/schema";
import {
  admissible,
  configured,
  exchange,
  isAdmin,
  packState,
  SESSION,
  STATE,
  signIn,
  startUrl,
  unpackState,
} from "./auth";
import type { Row } from "./db";
import * as db from "./db";
import * as photos from "./photos";
import { candidates } from "./queue";

type Vars = { who: Row };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const cookieOptions = (env: Env, maxAge: number) =>
  ({
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: env.ORIGIN.startsWith("https://"),
    maxAge,
  }) as const;

async function meBody(env: Env, row: Row): Promise<Me> {
  const [code, tally] = await Promise.all([
    db.inviteCode(env.DB, row.id),
    db.counts(env.DB, row.id),
  ]);
  return {
    ...db.toPerson(row),
    email: row.email ?? "",
    // Your own hall, which is yours to see and to change.
    dorm: row.dorm,
    invitedBy: row.invited_by,
    inviteCode: code,
    answers: tally.answers,
    knownBy: tally.knownBy,
    admin: isAdmin(env, row.email),
  };
}

// ---- invitations ----------------------------------------------------------

/*
 * The whole point of the link: the code survives the trip through Google, so
 * whoever shared it is the newcomer's first card and their first real edge.
 */
app.get("/i/:code", (c) => {
  const code = c.req.param("code");
  if (getCookie(c, SESSION)) return c.redirect("/", 303);
  return c.redirect(`/auth/google?invite=${encodeURIComponent(code)}`, 303);
});

// ---- sign-in --------------------------------------------------------------

app.get("/auth/google", (c) => {
  if (!configured(c.env)) return c.text("google sign-in is not configured", 503);
  const nonce = db.id(16);
  setCookie(c, STATE, nonce, cookieOptions(c.env, 600));
  return c.redirect(startUrl(c.env, packState(nonce, c.req.query("invite") ?? null)), 303);
});

app.get("/auth/callback", async (c) => {
  const { nonce, invite } = unpackState(c.req.query("state") ?? "");
  // The state cookie is the only thing between this route and a sign-in the
  // visitor did not start.
  if (!nonce || nonce !== getCookie(c, STATE)) return c.redirect("/?error=state", 303);
  deleteCookie(c, STATE, { path: "/" });

  const code = c.req.query("code");
  const who = code ? await exchange(c.env, code) : null;
  if (!who) return c.redirect("/?error=google", 303);
  if (!admissible(who, c.env.ALLOWED_DOMAIN)) return c.redirect("/?error=domain", 303);

  const inviter = invite ? await db.inviter(c.env.DB, invite) : null;
  const row = await signIn(c.env.DB, who, inviter?.id ?? null);
  setCookie(c, SESSION, await db.openSession(c.env.DB, row.id), cookieOptions(c.env, 30 * 86400));
  return c.redirect("/", 303);
});

/**
 * A way in when there is no Google client, which is every checkout of this
 * repo before somebody registers one. Both an explicit flag and a loopback
 * origin, so a deployment that forgets one is still shut.
 */
app.get("/auth/dev", async (c) => {
  const local = new URL(c.req.url).hostname === "localhost";
  if (c.env.DEV_LOGIN !== "1" || !local) return c.notFound();
  const email = (c.req.query("email") ?? `dev@${c.env.ALLOWED_DOMAIN}`).toLowerCase();
  const inviter = c.req.query("invite") ? await db.inviter(c.env.DB, c.req.query("invite")!) : null;
  const row = await signIn(
    c.env.DB,
    { email, name: c.req.query("name") ?? email.split("@")[0]!, hd: c.env.ALLOWED_DOMAIN },
    inviter?.id ?? null,
  );
  setCookie(c, SESSION, await db.openSession(c.env.DB, row.id), cookieOptions(c.env, 30 * 86400));
  return c.redirect("/", 303);
});

app.post("/auth/out", async (c) => {
  const token = getCookie(c, SESSION);
  if (token) await db.closeSession(c.env.DB, token);
  deleteCookie(c, SESSION, { path: "/" });
  return c.json({ ok: true });
});

// ---- photos ---------------------------------------------------------------

app.get("/photos/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!photos.safeKey(key)) return c.text("no", 400);
  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.notFound();
  // The key changes whenever the picture does, so this can be cached hard.
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag,
    },
  });
});

/**
 * Bulk ingest, for the directory photographs.
 *
 * A bearer token rather than a session, because the caller is a script on a
 * laptop holding a Cedarville directory cookie, not a person with an account.
 * Unset token means the route does not exist.
 */
app.put("/api/ingest/photo/:id", async (c) => {
  const token = c.env.INGEST_TOKEN;
  if (!token || c.req.header("authorization") !== `Bearer ${token}`) return c.notFound();

  const row = await db.person(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "no such person" }, 404);
  // Somebody who has uploaded their own face, or left, is not overwritten by
  // a bulk job that ran afterwards.
  if (row.tombstoned_at) return c.json({ skipped: "withdrawn" });
  if (row.joined_at && row.photo) return c.json({ skipped: "theirs" });

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const key = await photos.put(c.env.PHOTOS, row.id, bytes);
  if (!key) return c.json({ error: "not an image" }, 415);
  await photos.drop(c.env.PHOTOS, row.photo);
  await db.updateProfile(c.env.DB, row, { photo: key });
  return c.json({ key });
});

// ---- everything below needs a person --------------------------------------

app.use("/api/*", async (c, next) => {
  const token = getCookie(c, SESSION);
  const who = token ? await db.sessionPerson(c.env.DB, token) : null;
  if (!who) return c.json({ error: "sign in", signIn: configured(c.env) }, 401);
  c.set("who", who);
  await next();
});

app.get("/api/me", async (c) => c.json(await meBody(c.env, c.get("who"))));

app.patch("/api/me", async (c) => {
  const who = c.get("who");
  const patch = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown, max: number) =>
    v === null ? null : typeof v === "string" ? v.trim().slice(0, max) || null : undefined;
  await db.updateProfile(c.env.DB, who, {
    name: typeof patch.name === "string" ? patch.name.trim().slice(0, 80) : undefined,
    major: text(patch.major, 80),
    dorm: text(patch.dorm, 60),
  });
  return c.json(await meBody(c.env, (await db.person(c.env.DB, who.id))!));
});

app.post("/api/me/photo", async (c) => {
  const who = c.get("who");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > photos.MAX_BYTES) return c.json({ error: "too large" }, 413);
  const key = await photos.put(c.env.PHOTOS, who.id, bytes);
  if (!key) return c.json({ error: "not an image" }, 415);
  await photos.drop(c.env.PHOTOS, who.photo);
  await db.updateProfile(c.env.DB, who, { photo: key });
  return c.json(await meBody(c.env, (await db.person(c.env.DB, who.id))!));
});

app.delete("/api/me/photo", async (c) => {
  const who = c.get("who");
  await photos.drop(c.env.PHOTOS, who.photo);
  await db.updateProfile(c.env.DB, who, { photo: null });
  return c.json(await meBody(c.env, (await db.person(c.env.DB, who.id))!));
});

/**
 * Withdrawal. Irreversible, and the confirmation is spelled out in the body
 * rather than the URL, so no link and no prefetch can ever perform it.
 */
app.post("/api/me/withdraw", async (c) => {
  const { confirm } = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (confirm !== "withdraw") return c.json({ error: "say withdraw" }, 400);
  const who = c.get("who");
  // The object, not only the column that points at it. Clearing the reference
  // and leaving the face in the bucket is not removing somebody's photograph.
  await photos.drop(c.env.PHOTOS, who.photo);
  await db.tombstone(c.env.DB, who.id);
  deleteCookie(c, SESSION, { path: "/" });
  return c.json({ withdrawn: true });
});

app.get("/api/queue", async (c) => {
  const n = Math.min(48, Math.max(1, Number(c.req.query("n")) || 24));
  const segments = await db.liveSegments(c.env.DB);
  return c.json({ people: await candidates(c.env.DB, c.get("who"), segments, n) });
});

app.post("/api/rate", async (c) => {
  const { subject, strength, context } = (await c.req.json().catch(() => ({}))) as {
    subject?: string;
    strength?: number;
    context?: string;
  };
  if (!subject || !validStrength(strength)) return c.json({ error: "subject and 0-10" }, 400);
  const note = typeof context === "string" ? context.trim().slice(0, MAX_CONTEXT) : "";
  await db.rate(c.env.DB, c.get("who").id, subject, strength, note || null);
  return c.json({ ok: true });
});

app.post("/api/skip", async (c) => {
  const { subject } = (await c.req.json().catch(() => ({}))) as { subject?: string };
  if (subject) await db.skip(c.env.DB, c.get("who").id, subject);
  return c.json({ ok: true });
});

/** Undo, so a misfired keystroke costs a keystroke rather than a wrong edge. */
app.post("/api/undo", async (c) => {
  const { subject } = (await c.req.json().catch(() => ({}))) as { subject?: string };
  if (subject) await db.unrate(c.env.DB, c.get("who").id, subject);
  return c.json({ ok: true });
});

app.get("/api/search", async (c) => {
  const segments = await db.liveSegments(c.env.DB);
  return c.json({
    people: await db.search(c.env.DB, c.req.query("q") ?? "", c.get("who"), segments),
  });
});

app.get("/api/lists", async (c) => {
  const [majors, dorms] = await Promise.all([db.majors(c.env.DB), db.dorms(c.env.DB)]);
  return c.json({
    majors: majors.results.map((m) => m.name),
    dorms: dorms.results.map((d) => d.name),
  });
});

// ---- which slices of the directory are live -------------------------------

app.get("/api/admin", async (c) => {
  if (!isAdmin(c.env, c.get("who").email)) return c.json({ error: "not an admin" }, 403);
  const [segments, counted] = await Promise.all([
    db.liveSegments(c.env.DB),
    db.segmentCounts(c.env.DB),
  ]);
  const counts: Settings["counts"] = {};
  for (const row of counted.results) counts[row.segment] = { total: row.total, joined: row.joined };
  return c.json({ segments, counts } satisfies Settings);
});

app.put("/api/admin", async (c) => {
  if (!isAdmin(c.env, c.get("who").email)) return c.json({ error: "not an admin" }, 403);
  const { segments } = (await c.req.json().catch(() => ({}))) as { segments?: unknown };
  if (!Array.isArray(segments)) return c.json({ error: "send segments" }, 400);
  await db.setSegments(c.env.DB, segments.filter(isSegment));
  return c.json({ segments: segments.filter(isSegment) });
});

app.all("/api/*", (c) => c.json({ error: "no such route" }, 404));

export default app;
