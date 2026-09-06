/**
 * Turns the cedarstalk directory snapshot into the study's population.
 *
 *   bun run seed                    write .data/seed.sql
 *   bun run seed --apply            and load it into the local D1
 *   bun run seed --apply --remote   and load it into the deployed one
 *
 * Everybody in the directory is imported, staff and dual-enrolled high
 * schoolers included, because deciding later who exists would mean importing
 * again. Which slices are *live* is a setting in the app, not a decision made
 * here — see the admin tab.
 *
 * The valuable column is Username. A username plus the school's domain is the
 * Google account, so a seeded row already carries the address the person will
 * sign in with, and signing in claims the row rather than making a second one.
 * That is the difference between an exact join and guessing at names.
 */

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import type { Segment } from "../shared/schema";

const source = process.env.CEDARSTALK ?? "../cedarstalk-raycast";
const domain = process.env.ALLOWED_DOMAIN ?? "cedarville.edu";
const apply = process.argv.includes("--apply");
const remote = process.argv.includes("--remote");

interface DirectoryRow {
  Id: string;
  Username: string;
  FirstName: string;
  LastName: string;
  Nickname: string;
  AddressCity: string | null;
  AddressState: string | null;
  DepartmentDescription: string | null;
  Title: string | null;
  DormName: string | null;
  DormRoom: string | null;
  StudentType: string | null;
  StudentClass: string | null;
}

/**
 * Which slice of the directory a row belongs to.
 *
 * Class standing decides it before student type does, because the dual
 * enrolled are typed as undergraduates and are the one group that certainly
 * is not on campus.
 */
export function segmentOf(row: {
  StudentType: string | null;
  StudentClass: string | null;
  Title: string | null;
  DepartmentDescription: string | null;
}): Segment {
  const type = (row.StudentType ?? "").trim().toUpperCase();
  const standing = (row.StudentClass ?? "").trim().toUpperCase();

  /*
   * Not enrolled, and the directory has a job for you: staff, whatever
   * standing the row still carries.
   *
   * Matthew Clark, adjunct instructor in Engineering and Computer Science, is
   * filed "JR" to this day. Two hundred and seven rows are in that state — no
   * student type, a professorial title, and a class standing left over from
   * whenever they last took a class. Reading the standing first files a
   * professor as a junior.
   *
   * This must test the *absence* of a student type. A resident director or a
   * groundskeeper with StudentType UG is a student who also has a job, and
   * they stay a student.
   */
  if (!type && (row.Title?.trim() || row.DepartmentDescription?.trim())) return "staff";

  /*
   * After that, standing leads, because it is the more specific of the two.
   *
   *   DE / HS   3784   dual enrolled, typed as students, standing says so
   *   UG / GR    468   graduate standing under an undergraduate type
   *
   * That second group is the reason. The type field lags behind somebody
   * moving from a bachelor's into a master's, and the standing does not:
   * every single one of those 468 has no residence hall, against 63 to 88
   * per cent of every undergraduate standing. They are graduates. Some of
   * them also hold campus jobs, which is a different column — `studentWorker`
   * — and not this decision.
   */
  if (standing === "HS") return "de";
  if (["FR", "SO", "JR", "SR"].includes(standing)) return "ug";
  if (["GR", "GS", "MG"].includes(standing) || /^P\d$/.test(standing)) return "grad";
  if (type === "UG" || type === "UGO") return "ug";
  if (type === "GS" || /^P\d$/.test(type)) return "grad";
  return "other";
}

/**
 * The tightest grouping a room number gives away, scoped to its building.
 *
 * The rooms come in two shapes and the difference matters. Willetts 206 is a
 * three digit room whose first digit is a floor: a hundred and fifty people
 * who share a stairwell. Printy 27C is a suite, where 27 is the unit and C is
 * the bedroom: eight people who share a bathroom. Some halls put a block
 * letter in front — Carr C115, Walker B3 — and it is decoration, so it comes
 * off first.
 *
 * One column rather than two, because the queue only ever asks one question,
 * are these two people neighbours, and the honest answer is whichever grain
 * the building happens to publish.
 *
 * This never leaves the server. It picks whose face comes next and nothing
 * else; see shared/schema.ts.
 */
export function clusterOf(dorm: string | null, room: string | null): string | null {
  const digits = /^[A-Za-z]?(\d+)/.exec((room ?? "").trim())?.[1];
  if (!dorm?.trim() || !digits) return null;
  const hall = dorm.trim();
  return digits.length >= 3 ? `${hall} floor ${digits[0]}` : `${hall} unit ${Number(digits)}`;
}

/** The name a person is actually called: the directory's nickname, then the surname. */
export const displayName = (row: { Nickname: string; FirstName: string; LastName: string }) =>
  `${(row.Nickname || row.FirstName || "").trim()} ${(row.LastName || "").trim()}`.trim();

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

const q = (v: string | null | undefined) =>
  v === null || v === undefined || v === "" ? "NULL" : `'${v.replace(/'/g, "''")}'`;

/** One statement per chunk: ten thousand single-row inserts is a slow import. */
function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Everything below has side effects, so it only runs when this file is the command. */
async function main() {
  const db = new Database(`${source}/data/directory.db`, { readonly: true });
  const people = db
    .query<DirectoryRow, []>(
      `SELECT Id, Username, FirstName, LastName, Nickname, AddressCity, AddressState,
              DepartmentDescription, Title, DormName, DormRoom, StudentType, StudentClass
       FROM people WHERE Username IS NOT NULL AND Username != '' ORDER BY Id`,
    )
    .all();
  db.close();

  const stamp = new Date().toISOString();
  const counts: Record<string, number> = {};

  const values = people.map((row) => {
    const name = displayName(row);
    const segment = segmentOf(row);
    counts[segment] = (counts[segment] ?? 0) + 1;
    const hometown = [row.AddressCity, row.AddressState].filter(Boolean).join(", ");
    return `(${[
      q(row.Id),
      q(name),
      q(searchKey(name)),
      q(`${row.Username.toLowerCase()}@${domain}`),
      q(segment),
      // Meaningless for anyone who is not a student, and actively wrong on a
      // professor's card, so it stops here rather than at the point of display.
      q(segment === "staff" ? null : row.StudentClass?.trim() || null),
      q(row.DepartmentDescription?.trim() || null),
      q(row.DormName?.trim() || null),
      q(clusterOf(row.DormName, row.DormRoom)),
      q(hometown || null),
      q(stamp),
    ].join(", ")})`;
  });

  /*
   * Safe to re-run, and the rule is whether the person can edit the column.
   *
   * Class standing, department, hometown and the room cluster have no field
   * in the profile, so nobody can have contradicted them and a fresh snapshot
   * in August should carry them forward. Name, photograph and major are typed
   * by the person and are never touched. The residence hall is the awkward
   * one — it is directory data until somebody corrects it, so it refreshes
   * only for rows nobody has signed into.
   *
   * A headstone is never written to at all.
   */
  const columns =
    "id, name, search, email, segment, class, department, dorm, cluster, hometown, created_at";
  const refresh = [
    ...["segment", "class", "department", "cluster", "hometown"].map((c) => `${c} = excluded.${c}`),
    "dorm = CASE WHEN people.joined_at IS NULL THEN excluded.dorm ELSE people.dorm END",
  ].join(",\n    ");

  const lines = [
    "-- generated by scripts/seed.ts; safe to re-run",
    ...chunks(values, 400).map(
      (part) =>
        `INSERT INTO people\n  (${columns})\nVALUES\n  ${part.join(",\n  ")}\n` +
        `ON CONFLICT (id) DO UPDATE SET\n    ${refresh}\n` +
        `  WHERE people.tombstoned_at IS NULL;`,
    ),
  ];

  // The programme list, so the profile's major field offers real majors.
  const tsv = await Bun.file(`${source}/data/major-school.tsv`).text();
  const majors = tsv
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"))
    .filter((cells) => cells[1] === "major" && cells[0])
    .map((cells) => `(${q(cells[0]!.trim())}, ${q(cells[2]?.trim())}, ${q(cells[3]?.trim())})`);

  lines.push(
    `INSERT OR IGNORE INTO majors (name, department, school) VALUES\n  ${majors.join(",\n  ")};`,
  );

  await mkdir(".data", { recursive: true });
  await Bun.write(".data/seed.sql", lines.join("\n\n") + "\n");

  console.log(`${people.length} people → .data/seed.sql`);
  for (const [segment, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${segment.padEnd(6)} ${n}`);
  }
  console.log(`${majors.length} majors`);

  if (apply) {
    const args = [
      "d1",
      "execute",
      "social-graph",
      "--file=.data/seed.sql",
      remote ? "--remote" : "--local",
      "-y",
    ];
    console.log(`\nwrangler ${args.join(" ")}`);
    const proc = Bun.spawn(["bunx", "wrangler", ...args], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    process.exit(await proc.exited);
  } else {
    console.log(`\nload it with:  bun run seed --apply${remote ? " --remote" : ""}`);
  }
}

if (import.meta.main) await main();
