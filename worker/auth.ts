/**
 * Sign-in, which here is also the entire admissions policy.
 *
 * The study is about one school, so membership in that school is the only
 * credential worth checking, and Google Workspace already knows it. We ask
 * Google for an id token, insist on a verified address inside the school's
 * hosted domain, and keep nothing else.
 *
 * The id token's signature is not checked, and does not need to be: it came
 * back over TLS from Google's own token endpoint, in a request carrying our
 * client secret. That is the case Google documents as safe to trust. A token
 * handed to us by a browser would be a different story, and we never take one.
 *
 * The join is exact rather than fuzzy, which is the gift the directory gives
 * us: every seeded row already carries `username@domain`, so the account that
 * signs in *is* the row, with every rating already pointing at it.
 */

import { byEmail, create, join, type Row } from "./db";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export const SESSION = "sg_session";
export const STATE = "sg_state";

export interface Claims {
  email: string;
  name?: string;
  hd?: string;
  email_verified?: boolean;
}

/** The middle segment of a JWT, which is all we read. */
export function claims(idToken: string): Claims | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    return typeof json?.email === "string" ? json : null;
  } catch {
    return null;
  }
}

/**
 * Google's `hd` claim is the authoritative answer to "is this a school
 * account", but an address can only end in a hosted domain if the domain is
 * hosted, so both are required and neither alone is enough.
 */
export const admissible = (c: Claims, domain: string) =>
  c.email_verified !== false && c.hd === domain && c.email.toLowerCase().endsWith("@" + domain);

/**
 * State carries the invite code through Google and back.
 *
 * Putting the code in the round trip rather than in a cookie of its own means
 * the link works first time in a browser that has never seen this site, which
 * is every browser that follows an invitation.
 */
export const packState = (nonce: string, invite: string | null) => `${nonce}.${invite ?? ""}`;
export function unpackState(state: string): { nonce: string; invite: string | null } {
  const dot = state.indexOf(".");
  if (dot < 0) return { nonce: state, invite: null };
  return { nonce: state.slice(0, dot), invite: state.slice(dot + 1) || null };
}

export function startUrl(env: Env, state: string): string {
  const url = new URL(AUTH);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${env.ORIGIN}/auth/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // A hint to the account chooser. The `hd` claim is what actually decides.
  url.searchParams.set("hd", env.ALLOWED_DOMAIN);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchange(env: Env, code: string): Promise<Claims | null> {
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.ORIGIN}/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { id_token?: string };
  return body.id_token ? claims(body.id_token) : null;
}

/** Turn a verified school account into a participating row, once. */
export async function signIn(db: D1Database, who: Claims, inviterId: string | null): Promise<Row> {
  const seeded = await byEmail(db, who.email);
  if (seeded) return await join(db, seeded.id, inviterId);
  // Not in the directory snapshot: a new hire, a transfer, or a stale export.
  // They are still a verified member of the school, so they are still in.
  return await create(db, {
    name: who.name || who.email.split("@")[0]!,
    email: who.email,
    segment: "other",
    invitedBy: inviterId,
    joined: true,
  });
}

export const isAdmin = (env: Env, email: string | null) =>
  Boolean(
    email &&
      (env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .includes(email.toLowerCase()),
  );

export const configured = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
