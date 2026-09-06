/**
 * What to put in front of you next.
 *
 * The hard part of a study like this is not collecting edges, it is spending
 * somebody's attention well. A uniformly random stranger out of ten thousand
 * is cheap to pick and almost always answered "never heard of them", which is
 * one bit. A person two hops away, or down the hall, is answered with a
 * number, which is the thing we came for.
 *
 * So the queue is tiered, strongest signal first:
 *
 *   inviter     whose link you followed; one guaranteed real edge, and the
 *               reason the invitation system exists at all
 *   reciprocal  people who have already placed you; the edge is half drawn
 *   mutual      friends of friends, scored by the product of both hops
 *   cluster     the same suite or floor, which at this school is most of
 *               what "know" means for a first year
 *   dorm        the same residence hall
 *   cohort      the same major, or the same year
 *   unrated     random, biased towards whoever has been looked at least
 *
 * Random never disappears, and proximity is capped. A queue made only of
 * friends of friends finds one dense component and never learns the rest of
 * the school exists; a queue made of whoever lives nearby is worse, because it
 * looks productive while mapping one building. So a fixed share of every batch
 * is drawn at random however well connected the rater is, and no proximity
 * tier may fill more than an eighth of it.
 */

import type { Because, Candidate, Segment } from "../shared/schema";
import { COLUMNS, type Row, segmentGate, toPerson } from "./db";

/** The share of every batch reserved for strangers, whatever else is available. */
export const RANDOM_SHARE = 0.25;

/**
 * The most of one batch any single proximity tier may fill.
 *
 * Living down the hall is the best signal the directory has and it would
 * happily fill every card, which is exactly the failure: a rater who only
 * ever sees their own building maps their own building. An eighth each means
 * residence contributes at most a quarter of a batch, the same share the
 * strangers get, and everything above it is earned by an edge somebody
 * actually drew.
 */
export const NEARBY_SHARE = 1 / 8;

/** Below this, an edge is too weak to walk across looking for friends of friends. */
export const WALKABLE = 4;

export interface Tier {
  because: Because;
  rows: Row[];
  /** Most of the batch this tier may fill, as a fraction. Uncapped if absent. */
  cap?: number;
}

/**
 * Interleave the tiers into one batch.
 *
 * Ordering is by tier, except that the random tail is spliced in rather than
 * appended: a rater who stops after fifteen cards should still have seen a few
 * strangers, and a tail nobody reaches is not a sample.
 */
export function blend(tiers: Tier[], limit: number): Candidate[] {
  const seen = new Set<string>();
  const picked: Candidate[] = [];
  const random: Candidate[] = [];

  for (const tier of tiers) {
    const into = tier.because === "unrated" ? random : picked;
    const room =
      tier.cap === undefined ? Number.POSITIVE_INFINITY : Math.max(1, Math.round(limit * tier.cap));
    let taken = 0;
    for (const row of tier.rows) {
      if (seen.has(row.id)) continue;
      if (taken >= room) break;
      seen.add(row.id);
      taken++;
      into.push({ ...toPerson(row), because: tier.because });
    }
  }

  const wanted = Math.min(limit, picked.length + random.length);
  // The share is a floor, not a cap: a rater with no graph yet gets a batch of
  // nothing but strangers, which is how everyone starts.
  const strangers = Math.min(
    random.length,
    Math.max(wanted - picked.length, Math.round(wanted * RANDOM_SHARE)),
  );
  const known = picked.slice(0, wanted - strangers);
  const every = Math.max(1, Math.round(1 / RANDOM_SHARE) - 1);

  const out: Candidate[] = [];
  let r = 0;
  for (let i = 0; i < known.length; i++) {
    out.push(known[i]!);
    if ((i + 1) % every === 0 && r < strangers) out.push(random[r++]!);
  }
  while (r < strangers) out.push(random[r++]!);
  return out.slice(0, limit);
}

/**
 * Rows this rater must not be shown: themselves, the withdrawn, anyone they
 * have already answered or deferred, and anyone outside the live segments.
 * `?1` is the rater and `?2` is the batch size; the gate takes `?3` onward.
 */
function exclude(segments: Segment[]) {
  const gate = segmentGate(segments, 3);
  return {
    sql: `p.tombstoned_at IS NULL AND p.id <> ?1
      AND NOT EXISTS (SELECT 1 FROM ratings x WHERE x.rater = ?1 AND x.subject = p.id)
      AND NOT EXISTS (SELECT 1 FROM skips x WHERE x.rater = ?1 AND x.subject = p.id)
      AND ${gate.sql}`,
    values: gate.values,
    /** Where a query's own parameters start, after the rater, limit and gate. */
    next: 3 + gate.values.length,
  };
}

export async function candidates(
  db: D1Database,
  me: Row,
  segments: Segment[],
  limit = 24,
): Promise<Candidate[]> {
  const gate = exclude(segments);
  const base = [me.id, limit, ...gate.values];
  const run = (sql: string, ...extra: unknown[]) =>
    db
      .prepare(sql)
      .bind(...base, ...extra)
      .all<Row>()
      .then((r) => r.results)
      .catch(() => [] as Row[]);

  const [inviter, reciprocal, mutual, nearby, hall, cohort, unrated] = await Promise.all([
    me.invited_by
      ? run(
          `SELECT ${COLUMNS} FROM people p WHERE p.id = ?${gate.next} AND ${gate.sql}`,
          me.invited_by,
        )
      : Promise.resolve([]),

    run(
      `SELECT ${COLUMNS} FROM people p
       JOIN ratings r ON r.rater = p.id AND r.subject = ?1 AND r.strength > 0
       WHERE ${gate.sql}
       ORDER BY r.strength DESC, r.updated_at DESC LIMIT ?2`,
    ),

    /*
     * Friend of a friend, scored by the product of the two hops.
     *
     * Multiplying rather than adding is the load-bearing bit: a strong tie to
     * someone who barely knows the candidate is weak evidence, and so is the
     * reverse. Summing that product over intermediaries then rewards the
     * person several of your friends know.
     */
    run(
      `SELECT ${COLUMNS}, sum(mine.strength * theirs.strength) AS score
       FROM ratings mine
       JOIN ratings theirs ON theirs.rater = mine.subject AND theirs.strength >= ${WALKABLE}
       JOIN people p ON p.id = theirs.subject
       WHERE mine.rater = ?1 AND mine.strength >= ${WALKABLE} AND ${gate.sql}
       GROUP BY p.id ORDER BY score DESC LIMIT ?2`,
    ),

    /*
     * The same suite, or the same floor. One column because the room numbers
     * come in two shapes and only one of them names a floor; see
     * scripts/seed.ts. Whichever it is, it is the tightest grouping the
     * directory publishes, and those are the people you queue for a shower
     * with.
     */
    me.cluster
      ? run(
          `SELECT ${COLUMNS} FROM people p WHERE p.cluster = ?${gate.next} AND ${gate.sql}
           ORDER BY random() LIMIT ?2`,
          me.cluster,
        )
      : Promise.resolve([]),

    me.dorm
      ? run(
          `SELECT ${COLUMNS} FROM people p
           WHERE p.dorm = ?${gate.next} AND (p.cluster IS NULL OR p.cluster IS NOT ?${gate.next + 1})
             AND ${gate.sql}
           ORDER BY random() LIMIT ?2`,
          me.dorm,
          me.cluster,
        )
      : Promise.resolve([]),

    me.major || me.class
      ? run(
          `SELECT ${COLUMNS} FROM people p
           WHERE (p.major IS NOT NULL AND p.major = ?${gate.next}
                  OR p.class IS NOT NULL AND p.class = ?${gate.next + 1})
             AND ${gate.sql}
           ORDER BY (p.major IS ?${gate.next}) DESC, random() LIMIT ?2`,
          me.major,
          me.class,
        )
      : Promise.resolve([]),

    /*
     * Random, but least-looked-at first. Everyone getting a similar number of
     * looks is worth more to the study than everyone getting an equally random
     * one, and it costs nothing to ask for. The random() is the tiebreak that
     * matters most on day one, when every count is zero and sorting on the
     * count alone would hand the first thousand raters the same thousand
     * faces in primary key order.
     */
    run(
      `SELECT ${COLUMNS} FROM people p
       LEFT JOIN (SELECT subject, count(*) AS seen FROM ratings GROUP BY subject) c
         ON c.subject = p.id
       WHERE ${gate.sql}
       ORDER BY coalesce(c.seen, 0), random() LIMIT ?2`,
    ),
  ]);

  return blend(
    [
      { because: "inviter", rows: inviter },
      { because: "reciprocal", rows: reciprocal },
      { because: "mutual", rows: mutual },
      { because: "cluster", rows: nearby, cap: NEARBY_SHARE },
      { because: "dorm", rows: hall, cap: NEARBY_SHARE },
      { because: "cohort", rows: cohort, cap: NEARBY_SHARE },
      { because: "unrated", rows: unrated },
    ],
    limit,
  );
}
