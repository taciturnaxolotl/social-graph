/**
 * The study's output: a node list and an edge list, as CSV.
 *
 *   bun run export              the local database, ids only
 *   bun run export --remote     the deployed one
 *   bun run export --names      with names attached
 *
 * Names are off by default because almost every question about a network is
 * answerable without knowing whose node is whose. Withdrawn people are absent
 * rather than blank, which is the point of withdrawing.
 */

import { mkdir } from "node:fs/promises";

const remote = process.argv.includes("--remote");
const withNames = process.argv.includes("--names");

async function query<T>(sql: string): Promise<T[]> {
  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "social-graph",
      remote ? "--remote" : "--local",
      "--json",
      `--command=${sql}`,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error("wrangler failed");
  // Wrangler prints one result object per statement, after any banner.
  const parsed = JSON.parse(text.slice(text.indexOf("["))) as { results: T[] }[];
  return parsed[0]?.results ?? [];
}

const quote = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(quote).join(",")).join("\n") + "\n";

/*
 * Withdrawn people are here, and they have to be: their connections stay in
 * the edge list, so dropping their row would leave every one of those edges
 * pointing at a node that does not exist. What is gone is everything that
 * identified them, which was destroyed at the moment they withdrew rather
 * than being filtered out here.
 */
const people = await query<{
  id: string;
  name: string;
  segment: string;
  class: string | null;
  major: string | null;
  department: string | null;
  dorm: string | null;
  joined: number;
  withdrawn: number;
}>(
  `SELECT id, name, segment, class, major, department, dorm,
          (joined_at IS NOT NULL) AS joined, (tombstoned_at IS NOT NULL) AS withdrawn
   FROM people ORDER BY id`,
);

const edges = await query<{
  rater: string;
  subject: string;
  strength: number;
  context: string | null;
  updated_at: string;
}>(`SELECT rater, subject, strength, context, updated_at FROM ratings ORDER BY updated_at`);

await mkdir(".data", { recursive: true });
await Bun.write(
  ".data/nodes.csv",
  csv([
    [
      "id",
      ...(withNames ? ["name"] : []),
      "segment",
      "class",
      "major",
      "department",
      "dorm",
      "joined",
      "withdrawn",
    ],
    ...people.map((p) => [
      p.id,
      // A withdrawn row has no name to give; the column stays for shape.
      ...(withNames ? [p.withdrawn ? "" : p.name] : []),
      p.segment,
      p.class,
      p.major,
      p.department,
      p.dorm,
      p.joined,
      p.withdrawn,
    ]),
  ]),
);
await Bun.write(
  ".data/edges.csv",
  csv([
    ["source", "target", "strength", "where_met", "at"],
    ...edges.map((e) => [e.rater, e.subject, e.strength, e.context, e.updated_at]),
  ]),
);

const withdrawn = people.filter((p) => p.withdrawn).length;
console.log(
  `.data/nodes.csv  ${people.length} people${withNames ? " with names" : " (pseudonymous)"}` +
    (withdrawn ? `, ${withdrawn} withdrawn and unnamed` : ""),
);
console.log(
  `.data/edges.csv  ${edges.length} edges, ${edges.filter((e) => e.strength > 0).length} acquainted`,
);
