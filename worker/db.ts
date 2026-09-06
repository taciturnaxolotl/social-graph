/**
 * Every D1 query, in one file.
 *
 * Two rules live here rather than in the routes, because both are easy to
 * forget and expensive to get wrong: a rating may never name a withdrawn
 * person, and withdrawing takes the edges with it. Routes call these
 * functions; nothing else writes SQL.
 */

import type { Candidate, Person, Segment } from "../shared/schema";
import { isSegment } from "../shared/schema";

export const now = () => new Date().toISOString();

/** Crockford-ish base32: short enough to read aloud off a whiteboard. */
export function id(bytes = 10): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => alphabet[b % 32]).join("");
}

/**
 * Names arrive with titles and middle initials attached. Reducing them all to
 * the same key is what makes search find "Kyung-Hwa Kim" from "kyung hwa".
 */
export function searchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|prof|professor|rev|jr|sr|ii|iii|iv)\.?\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(" ")
    .trim();
}

export interface Row {
  id: string;
  name: string;
  email: string | null;
  segment: string;
  class: string | null;
  major: string | null;
  department: string | null;
  dorm: string | null;
  cluster: string | null;
  hometown: string | null;
  photo: string | null;
  invited_by: string | null;
  joined_at: string | null;
  tombstoned_at: string | null;
}

export const COLUMNS = `p.id, p.name, p.email, p.segment, p.class, p.major, p.department,
  p.dorm, p.cluster, p.hometown, p.photo, p.invited_by, p.joined_at, p.tombstoned_at`;

const SELECT = `SELECT ${COLUMNS} FROM people p`;

/**
 * The public face of a row, and the one place that decides what leaves the
 * server. The hall, the room cluster and the hometown are absent by
 * construction rather than by the page choosing not to draw them, so a new
 * view cannot leak them by accident. A withdrawn person keeps an id and
 * nothing else.
 */
export function toPerson(row: Row): Person {
  if (row.tombstoned_at) {
    return {
      id: row.id,
      name: "withdrawn",
      segment: "other",
      class: null,
      major: null,
      department: null,
      photo: null,
      joined: false,
    };
  }
  return {
    id: row.id,
    name: row.name,
    segment: isSegment(row.segment) ? row.segment : "other",
    class: row.class,
    major: row.major,
    department: row.department,
    photo: row.photo,
    joined: row.joined_at !== null,
  };
}

// ---- people ---------------------------------------------------------------

export const person = (db: D1Database, personId: string) =>
  db.prepare(`${SELECT} WHERE p.id = ?1`).bind(personId).first<Row>();

export const byEmail = (db: D1Database, email: string) =>
  db.prepare(`${SELECT} WHERE p.email = ?1`).bind(email.toLowerCase()).first<Row>();

export async function create(
  db: D1Database,
  p: {
    name: string;
    email?: string | null;
    segment?: Segment;
    invitedBy?: string | null;
    joined?: boolean;
  },
): Promise<Row> {
  const personId = id();
  await db
    .prepare(
      `INSERT INTO people (id, name, search, email, segment, invited_by, joined_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      personId,
      p.name.trim(),
      searchKey(p.name),
      p.email?.toLowerCase() ?? null,
      p.segment ?? "other",
      p.invitedBy ?? null,
      p.joined ? now() : null,
      now(),
    )
    .run();
  return (await person(db, personId))!;
}

/**
 * Mark a seeded row as a person who actually turned up.
 *
 * The directory already knew their name and their address; signing in is
 * consent, not creation, so the row keeps its id and every rating already
 * pointing at it.
 */
export async function join(
  db: D1Database,
  personId: string,
  invitedBy: string | null,
): Promise<Row> {
  await db
    .prepare(
      `UPDATE people SET joined_at = coalesce(joined_at, ?2), invited_by = coalesce(invited_by, ?3)
       WHERE id = ?1`,
    )
    .bind(personId, now(), invitedBy)
    .run();
  return (await person(db, personId))!;
}

export interface Patch {
  name?: string;
  major?: string | null;
  dorm?: string | null;
  photo?: string | null;
}

/**
 * Correcting your hall throws away the room the directory had for you.
 *
 * The cluster was derived from a room number in that building; once you say
 * you live somewhere else, it points at a floor you are not on, and a wrong
 * neighbour is worse than no neighbour. The directory will hand us a new one
 * at the next snapshot if it ever catches up.
 */
const keepsCluster = (current: Row, patch: Patch) =>
  patch.dorm === undefined || (patch.dorm ?? null) === current.dorm;

export async function updateProfile(db: D1Database, current: Row, patch: Patch) {
  if (current.tombstoned_at) return;
  const name = patch.name?.trim() || current.name;
  await db
    .prepare(
      `UPDATE people SET name = ?2, search = ?3, major = ?4, dorm = ?5, photo = ?6, cluster = ?7
       WHERE id = ?1 AND tombstoned_at IS NULL`,
    )
    .bind(
      current.id,
      name,
      searchKey(name),
      patch.major === undefined ? current.major : patch.major,
      patch.dorm === undefined ? current.dorm : patch.dorm,
      patch.photo === undefined ? current.photo : patch.photo,
      keepsCluster(current, patch) ? current.cluster : null,
    )
    .run();
}

/**
 * Withdrawal: the person goes, the shape they were part of stays.
 *
 * Everything that identifies them is destroyed — name, photograph, address,
 * hall, year — and the row survives only as an opaque id, which it keeps so a
 * re-seed cannot bring them back as somebody new. They are never shown to
 * anyone again.
 *
 * The connections are deliberately kept. When somebody rates you a nine, that
 * is a fact they authored about their own social world, and deleting it
 * because *you* left edits *their* contribution. Withdrawals also will not be
 * random — they cluster among the people who feel most exposed, who are
 * exactly the structurally interesting ones — so removing those nodes puts a
 * systematic hole in the measures this study exists to compute.
 *
 * The honest word for what is left is pseudonymous, not anonymous: a node
 * with forty edges, a timestamp and a degree can be picked out by somebody who
 * already knows part of the network. The page says so rather than implying
 * otherwise, and no new edge can be drawn to them — see `rate`.
 */
export function tombstone(db: D1Database, personId: string) {
  return db.batch([
    // Not a rating and not evidence of anything: "ask me later" about a person
    // who has left is a queue artefact, so it goes.
    db.prepare(`DELETE FROM skips WHERE rater = ?1 OR subject = ?1`).bind(personId),
    db.prepare(`DELETE FROM sessions WHERE person = ?1`).bind(personId),
    db.prepare(`DELETE FROM invites WHERE person = ?1`).bind(personId),
    db
      .prepare(
        `UPDATE people SET name = 'withdrawn', search = '', email = NULL, major = NULL,
           department = NULL, dorm = NULL, hometown = NULL, class = NULL, photo = NULL,
           invited_by = NULL, tombstoned_at = ?2
         WHERE id = ?1`,
      )
      .bind(personId, now()),
  ]);
}

/**
 * Search is scoped the same way the queue is: a person outside the live
 * segments is not in the study, and being findable by name would be a way
 * around the switch rather than a feature.
 */
export async function search(
  db: D1Database,
  query: string,
  me: Row,
  segments: Segment[],
): Promise<Candidate[]> {
  const key = searchKey(query);
  if (!key) return [];
  const gate = segmentGate(segments, 4);
  /*
   * Rank by where the match falls, not by how short the name is.
   *
   * Typing "kate" should offer Kate Nagel before Alexander Kately, and both
   * before anyone who merely contains the letters. So: a name that starts
   * with what you typed, then a *word* that starts with it — which is what
   * catches a surname — then anything else, and only then alphabetically.
   */
  const rows = await db
    .prepare(
      `SELECT ${COLUMNS}, r.strength AS strength FROM people p
       LEFT JOIN ratings r ON r.rater = ?1 AND r.subject = p.id
       WHERE p.tombstoned_at IS NULL AND p.id <> ?1 AND p.search LIKE ?3 AND ${gate.sql}
       ORDER BY
         CASE
           WHEN p.search LIKE ?2 || '%' THEN 0
           WHEN p.search LIKE '% ' || ?2 || '%' THEN 1
           ELSE 2
         END,
         length(p.search), p.name
       LIMIT 20`,
    )
    .bind(me.id, key, `%${key}%`, ...gate.values)
    .all<Row & { strength: number | null }>();
  return rows.results.map((row) => ({
    ...toPerson(row),
    because: "search" as const,
    ...(row.strength === null ? {} : { strength: row.strength }),
  }));
}

/**
 * Who may be shown, expressed once.
 *
 * Signing in overrides the segment switch in one direction only: somebody who
 * turned up is a participant whatever slice they were seeded into, because
 * turning them invisible after they consented would be the wrong way round.
 */
export function segmentGate(segments: Segment[], from: number): { sql: string; values: string[] } {
  if (!segments.length) return { sql: "p.joined_at IS NOT NULL", values: [] };
  const holes = segments.map((_, i) => `?${from + i}`).join(", ");
  return { sql: `(p.joined_at IS NOT NULL OR p.segment IN (${holes}))`, values: [...segments] };
}

// ---- ratings --------------------------------------------------------------

export async function rate(
  db: D1Database,
  rater: string,
  subject: string,
  strength: number,
  context: string | null = null,
) {
  if (rater === subject) return;
  const target = await person(db, subject);
  if (!target || target.tombstoned_at) return;
  await db.batch([
    db.prepare(`DELETE FROM skips WHERE rater = ?1 AND subject = ?2`).bind(rater, subject),
    db
      .prepare(
        // coalesce, so correcting a number from the search list never silently
        // throws away the note that was written with the first answer.
        `INSERT INTO ratings (rater, subject, strength, updated_at, context)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (rater, subject) DO UPDATE SET
           strength = ?3, updated_at = ?4, context = coalesce(?5, ratings.context)`,
      )
      .bind(rater, subject, strength, now(), context),
  ]);
}

export const unrate = (db: D1Database, rater: string, subject: string) =>
  db.prepare(`DELETE FROM ratings WHERE rater = ?1 AND subject = ?2`).bind(rater, subject).run();

export const skip = (db: D1Database, rater: string, subject: string) =>
  db
    .prepare(`INSERT OR REPLACE INTO skips (rater, subject, at) VALUES (?1, ?2, ?3)`)
    .bind(rater, subject, now())
    .run();

/** Everything the card counts, in one round trip. */
export async function counts(db: D1Database, personId: string) {
  const row = await db
    .prepare(
      `SELECT (SELECT count(*) FROM ratings WHERE rater = ?1) AS rated,
              (SELECT count(*) FROM ratings WHERE subject = ?1 AND strength > 0) AS ratedBy,
              (SELECT count(*) FROM ratings WHERE rater = ?1 AND context IS NOT NULL) AS notes,
              (SELECT count(*) FROM people WHERE invited_by = ?1 AND joined_at IS NOT NULL)
                AS recruited`,
    )
    .bind(personId)
    .first<{ rated: number; ratedBy: number; notes: number; recruited: number }>();
  return row ?? { rated: 0, ratedBy: 0, notes: 0, recruited: 0 };
}

// ---- sessions and invites -------------------------------------------------

export async function openSession(db: D1Database, personId: string, days = 30): Promise<string> {
  const token = id(20);
  await db
    .prepare(`INSERT INTO sessions (id, person, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(token, personId, now(), new Date(Date.now() + days * 86400_000).toISOString())
    .run();
  return token;
}

export const sessionPerson = (db: D1Database, token: string) =>
  db
    .prepare(
      `SELECT ${COLUMNS} FROM people p JOIN sessions s ON s.person = p.id
       WHERE s.id = ?1 AND s.expires_at > ?2 AND p.tombstoned_at IS NULL`,
    )
    .bind(token, now())
    .first<Row>();

export const closeSession = (db: D1Database, token: string) =>
  db.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(token).run();

/** One durable code per person: an invite link you can print on a flyer. */
export async function inviteCode(db: D1Database, personId: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT code FROM invites WHERE person = ?1`)
    .bind(personId)
    .first<{ code: string }>();
  if (existing) return existing.code;
  const code = id(6);
  await db
    .prepare(`INSERT INTO invites (code, person, created_at) VALUES (?1, ?2, ?3)`)
    .bind(code, personId, now())
    .run();
  return code;
}

export const inviter = (db: D1Database, code: string) =>
  db
    .prepare(
      `SELECT ${COLUMNS} FROM people p JOIN invites i ON i.person = p.id
       WHERE i.code = ?1 AND p.tombstoned_at IS NULL`,
    )
    .bind(code.toLowerCase())
    .first<Row>();

// ---- settings -------------------------------------------------------------

export async function liveSegments(db: D1Database): Promise<Segment[]> {
  const row = await db
    .prepare(`SELECT value FROM settings WHERE key = 'segments'`)
    .first<{ value: string }>();
  try {
    const parsed = JSON.parse(row?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSegment) : [];
  } catch {
    return [];
  }
}

export const setSegments = (db: D1Database, segments: Segment[]) =>
  db
    .prepare(`INSERT INTO settings (key, value) VALUES ('segments', ?1)
              ON CONFLICT (key) DO UPDATE SET value = ?1`)
    .bind(JSON.stringify(segments))
    .run();

export const majors = (db: D1Database) =>
  db.prepare(`SELECT name FROM majors ORDER BY name`).all<{ name: string }>();

export const dorms = (db: D1Database) =>
  db
    .prepare(`SELECT dorm AS name, count(*) AS n FROM people WHERE dorm IS NOT NULL
              GROUP BY dorm ORDER BY n DESC`)
    .all<{ name: string; n: number }>();

export const segmentCounts = (db: D1Database) =>
  db
    .prepare(
      `SELECT segment, count(*) AS total, sum(joined_at IS NOT NULL) AS joined
       FROM people WHERE tombstoned_at IS NULL GROUP BY segment`,
    )
    .all<{ segment: string; total: number; joined: number }>();
