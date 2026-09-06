/**
 * Copies the directory's photographs into R2, one PUT per person.
 *
 * Recognition is most of what makes a one-to-ten answer accurate; a page of
 * initials asks people to rate names, which is a different and much worse
 * question. The directory's photo endpoint needs a signed-in Cedarville
 * session, so this runs on your laptop with your own account and posts each
 * image through the worker's ingest route. Nothing here ever hands a session
 * to the server.
 *
 *   INGEST_TOKEN=… bun run photos
 *   INGEST_TOKEN=… bun run photos --origin https://graph.example.edu
 *   bun run photos --dry-run          fetch and count, upload nothing
 *
 * The cookie comes from cedarstalk's own auth helper, so sign in there once
 * from Raycast and this reuses it. Progress is written through to
 * .data/photos-done.json, so a run that dies is resumed rather than repeated.
 */

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = process.env.CEDARSTALK ?? "../cedarstalk-raycast";
const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
const origin = flag("origin", "http://localhost:5173");
const dry = argv.includes("--dry-run");
const limit = Number(flag("limit", "0")) || Number.POSITIVE_INFINITY;
const token = process.env.INGEST_TOKEN;

if (!dry && !token) {
  console.error("set INGEST_TOKEN (the worker's secret), or pass --dry-run");
  process.exit(1);
}

/*
 * Resolved from the working directory, not from this file. A bare relative
 * specifier in a dynamic import is resolved against the importing module, so
 * "../cedarstalk-raycast" quietly means something different here than it does
 * in every other path in this script.
 */
const { mintCookie, BASE_URL } = (await import(
  pathToFileURL(resolve(source, "scripts/lib.mjs")).href
)) as { mintCookie(): Promise<string>; BASE_URL: string };

const DONE = ".data/photos-done.json";
await mkdir(".data", { recursive: true });
const done: Record<string, string> = await Bun.file(DONE)
  .json()
  .catch(() => ({}));

const db = new Database(`${source}/data/directory.db`, { readonly: true });
const rows = db
  .query<{ Id: string; PhotoUrl: string }, []>(
    `SELECT Id, PhotoUrl FROM people WHERE PhotoUrl IS NOT NULL AND PhotoUrl != '' ORDER BY Id`,
  )
  .all()
  .filter((row) => !done[row.Id])
  .slice(0, limit);
db.close();

console.log(`${rows.length} photos to fetch (${Object.keys(done).length} already done)`);
if (!rows.length) process.exit(0);

const cookie = await mintCookie();
let ok = 0;
let failed = 0;
let skipped = 0;
let written = 0;

async function one(row: { Id: string; PhotoUrl: string }) {
  const url = row.PhotoUrl.startsWith("http") ? row.PhotoUrl : `${BASE_URL}${row.PhotoUrl}`;
  const image = await fetch(url, {
    headers: { cookie, referer: `${BASE_URL}/cedarinfo/directory` },
  });
  if (!image.ok) throw new Error(`directory ${image.status}`);
  const bytes = await image.arrayBuffer();
  // A near-empty response is the placeholder the directory serves for somebody
  // with no photograph, and it is worse than initials: it says "no face" in grey.
  if (bytes.byteLength < 1024) {
    skipped++;
    return;
  }
  if (dry) {
    ok++;
    return;
  }

  const put = await fetch(`${origin}/api/ingest/photo/${row.Id}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" },
    body: bytes,
  });
  if (!put.ok) throw new Error(`ingest ${put.status} ${await put.text()}`);
  const body = (await put.json()) as { key?: string; skipped?: string };
  done[row.Id] = body.key ?? `skipped:${body.skipped}`;
  ok++;
}

/** Six at a time: polite to the registrar, and the whole run still fits in minutes. */
const WIDTH = 6;
const queue = [...rows];

await Promise.all(
  Array.from({ length: WIDTH }, async () => {
    while (queue.length) {
      const row = queue.shift()!;
      try {
        await one(row);
      } catch (err) {
        failed++;
        console.error(`${row.Id}: ${err instanceof Error ? err.message : err}`);
      }
      // Write through periodically, so a crash never re-fetches the lot.
      if (++written % 50 === 0) {
        await Bun.write(DONE, JSON.stringify(done));
        console.log(`  ${ok} uploaded, ${skipped} without a photo, ${failed} failed`);
      }
    }
  }),
);

if (!dry) await Bun.write(DONE, JSON.stringify(done));
console.log(`${ok} ${dry ? "fetched" : "uploaded"}, ${skipped} without a photo, ${failed} failed`);
