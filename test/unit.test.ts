import { expect, test } from "bun:test";
import { clusterOf, displayName, searchKey, segmentOf } from "../scripts/seed";
import { costOf, levelFor, standing, tierFor } from "../shared/schema";
import { admissible, claims, packState, unpackState } from "../worker/auth";
import { safeKey, sniff } from "../worker/photos";
import { blend, NEARBY_SHARE, RANDOM_SHARE, type Tier } from "../worker/queue";

const row = (id: string) => ({
  id,
  name: id,
  email: null,
  segment: "ug",
  class: null,
  major: null,
  department: null,
  dorm: null,
  cluster: null,
  hometown: null,
  photo: null,
  invited_by: null,
  joined_at: null,
  tombstoned_at: null,
});
const rows = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => row(prefix + i));

// ---- the queue ------------------------------------------------------------

test("blend keeps tier order and splices strangers in rather than appending", () => {
  const out = blend(
    [
      { because: "reciprocal", rows: rows(10, "r") },
      { because: "unrated", rows: rows(10, "u") },
    ],
    12,
  );
  expect(out).toHaveLength(12);
  expect(out[0]!.id).toBe("r0");
  expect(out.filter((c) => c.because === "unrated").length).toBeGreaterThanOrEqual(
    Math.round(12 * RANDOM_SHARE) - 1,
  );
  // A rater who stops after six cards has still met a stranger.
  expect(out.slice(0, 6).some((c) => c.because === "unrated")).toBe(true);
});

test("blend never repeats a person across tiers, and keeps the strongest reason", () => {
  const one = [row("a")];
  const out = blend(
    [
      { because: "inviter", rows: one },
      { because: "mutual", rows: one },
      { because: "dorm", rows: one },
    ],
    10,
  );
  expect(out).toHaveLength(1);
  expect(out[0]!.because).toBe("inviter");
});

test("with no graph yet, a batch is all strangers rather than empty", () => {
  const out = blend([{ because: "unrated", rows: rows(3, "u") }], 24);
  expect(out.map((c) => c.id)).toEqual(["u0", "u1", "u2"]);
});

test("a withdrawn row shows as withdrawn and carries nothing else", () => {
  const gone = { ...row("x"), name: "Real Name", major: "Nursing", tombstoned_at: "2026-01-01" };
  const out = blend([{ because: "unrated", rows: [gone] } as Tier], 5);
  expect(out[0]!.name).toBe("withdrawn");
  expect(out[0]!.major).toBeNull();
});

test("where somebody lives never reaches the browser", () => {
  const neighbour = {
    ...row("n"),
    dorm: "Printy Hall",
    cluster: "Printy Hall unit 27",
    hometown: "Xenia, OH",
  };
  const [out] = blend([{ because: "cluster", rows: [neighbour] }], 5);
  // Absent by construction, not merely unrendered: a new view cannot leak it.
  expect(Object.keys(out!)).not.toContain("dorm");
  expect(Object.keys(out!)).not.toContain("cluster");
  expect(Object.keys(out!)).not.toContain("hometown");
  expect(JSON.stringify(out)).not.toContain("Printy");
});

test("proximity is capped so a rater cannot only ever see their own building", () => {
  const out = blend(
    [
      { because: "cluster", rows: rows(20, "c"), cap: NEARBY_SHARE },
      { because: "dorm", rows: rows(20, "d"), cap: NEARBY_SHARE },
      { because: "unrated", rows: rows(20, "u") },
    ],
    24,
  );
  const near = out.filter((c) => c.because === "cluster" || c.because === "dorm");
  expect(near.length).toBeLessThanOrEqual(Math.round(24 * NEARBY_SHARE) * 2);
  // And the strangers still get their quarter even when proximity is abundant.
  expect(out.filter((c) => c.because === "unrated").length).toBeGreaterThanOrEqual(
    Math.round(24 * RANDOM_SHARE) - 1,
  );
});

test("an uncapped tier still fills the batch it has earned", () => {
  const out = blend([{ because: "reciprocal", rows: rows(30, "r") }], 12);
  expect(out.filter((c) => c.because === "reciprocal")).toHaveLength(12);
});

// ---- who gets in ----------------------------------------------------------

const token = (payload: object) =>
  `x.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_")}.y`;

test("only verified accounts inside the hosted domain are admissible", () => {
  const ok = { email: "kk@cedarville.edu", hd: "cedarville.edu", email_verified: true };
  expect(admissible(ok, "cedarville.edu")).toBe(true);
  // A personal Gmail whose address merely looks right.
  expect(admissible({ ...ok, hd: undefined }, "cedarville.edu")).toBe(false);
  // The right workspace, an address somewhere else.
  expect(admissible({ ...ok, email: "kk@example.com" }, "cedarville.edu")).toBe(false);
  expect(admissible({ ...ok, email_verified: false }, "cedarville.edu")).toBe(false);
});

test("claims reads the payload and refuses junk", () => {
  expect(claims(token({ email: "a@b.c" }))?.email).toBe("a@b.c");
  expect(claims("not-a-jwt")).toBeNull();
  expect(claims(token({ sub: "1" }))).toBeNull();
});

test("state carries the invite code through Google and back", () => {
  expect(unpackState(packState("nonce", "abc123"))).toEqual({ nonce: "nonce", invite: "abc123" });
  expect(unpackState(packState("nonce", null))).toEqual({ nonce: "nonce", invite: null });
});

// ---- photographs ----------------------------------------------------------

const bytes = (...n: number[]) => new Uint8Array(n);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

test("sniff reads the magic and ignores what the caller claims", () => {
  expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe("jpg");
  expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))?.ext).toBe("png");
  const webp = new Uint8Array(16);
  webp.set(ascii("RIFF"), 0);
  webp.set(ascii("WEBP"), 8);
  expect(sniff(webp)?.ext).toBe("webp");
  expect(sniff(ascii("<svg onload=alert(1)>"))).toBeNull();
  expect(sniff(bytes())).toBeNull();
});

test("safeKey refuses anything that is not a photo object", () => {
  expect(safeKey("p/2690041-9f8e7d.jpg")).toBe(true);
  expect(safeKey("../people.sqlite")).toBe(false);
  expect(safeKey("p/evil.jpg.sh")).toBe(false);
  expect(safeKey("p/a/b.png")).toBe(false);
});

// ---- seeding --------------------------------------------------------------

const directory = (over: Partial<Parameters<typeof segmentOf>[0]> = {}) => ({
  StudentType: null,
  StudentClass: null,
  Title: null,
  DepartmentDescription: null,
  ...over,
});

test("a job with no student type is staff, whatever standing the row carries", () => {
  // Matthew Clark, adjunct instructor, filed "JR" from whenever he last took
  // a class. 207 rows are in that state and reading the standing first turns
  // every one of them into a student.
  expect(
    segmentOf(
      directory({
        StudentClass: "JR",
        Title: "Adjunct Instructor - Engineering and Computer Science",
        DepartmentDescription: "Engineering and Computer Scien",
      }),
    ),
  ).toBe("staff");
  expect(segmentOf(directory({ Title: "Professor of Chemistry" }))).toBe("staff");
  expect(segmentOf(directory({ DepartmentDescription: "Food Service" }))).toBe("staff");

  // But a student who also holds a campus job keeps their student type, and
  // that is what stops the branch above from catching them.
  expect(segmentOf(directory({ StudentType: "UG", StudentClass: "SO", Title: "Grounds" }))).toBe(
    "ug",
  );
});

test("standing beats a lagging student type", () => {
  // Hope Hawthorne: graduate standing under a type that still says UG. All
  // 468 of them have no residence hall, against 63-88% of every undergraduate
  // standing, which is what settles it.
  expect(segmentOf(directory({ StudentType: "UG", StudentClass: "GR" }))).toBe("grad");
  expect(segmentOf(directory({ StudentType: "UG", StudentClass: "GR", Title: "Grounds" }))).toBe(
    "grad",
  );
  // The dual enrolled, typed either way, are named by their standing.
  expect(segmentOf(directory({ StudentType: "DE", StudentClass: "HS" }))).toBe("de");
  expect(segmentOf(directory({ StudentType: "UG", StudentClass: "HS" }))).toBe("de");
  expect(segmentOf(directory({ StudentType: "UG", StudentClass: "SR" }))).toBe("ug");
  expect(segmentOf(directory({ StudentType: "GS", StudentClass: "P3" }))).toBe("grad");
  // Nothing to go on but the type.
  expect(segmentOf(directory({ StudentType: "GS", StudentClass: "" }))).toBe("grad");
  expect(segmentOf(directory())).toBe("other");
});

test("people are named what they are called, not what the registrar filed", () => {
  expect(displayName({ Nickname: "Kate", FirstName: "Katherine", LastName: "Nagel" })).toBe(
    "Kate Nagel",
  );
  expect(displayName({ Nickname: "", FirstName: "Katherine", LastName: "Nagel" })).toBe(
    "Katherine Nagel",
  );
});

test("searchKey drops titles and punctuation so a name is found either way", () => {
  expect(searchKey("Dr. Kyung-Hwa Kim")).toBe("kyung hwa kim");
  expect(searchKey("Kyung Hwa Kim")).toBe("kyung hwa kim");
});

test("a room number gives up a floor or a suite, whichever the hall publishes", () => {
  // Three digits: the first is a floor, and a floor is ~150 people.
  expect(clusterOf("Willetts Hall", "206")).toBe("Willetts Hall floor 2");
  expect(clusterOf("College View Apartment A", "201-2")).toBe("College View Apartment A floor 2");
  // A block letter in front is decoration; the floor is still in there.
  expect(clusterOf("Carr Hall", "C115")).toBe("Carr Hall floor 1");
  // Two digits plus a bedroom letter: 27 is the suite, and a suite is eight people.
  expect(clusterOf("Printy Hall", "27C")).toBe("Printy Hall unit 27");
  expect(clusterOf("Maddox Hall", "05D")).toBe("Maddox Hall unit 5");
  expect(clusterOf("Walker Hall", "B3")).toBe("Walker Hall unit 3");
  // Nothing to go on, and nothing invented.
  expect(clusterOf("Printy Hall", "")).toBeNull();
  expect(clusterOf(null, "206")).toBeNull();
  expect(clusterOf("Off Campus", "N/A")).toBeNull();
});

test("two people in the same unit of different halls are not neighbours", () => {
  expect(clusterOf("Printy Hall", "27C")).not.toBe(clusterOf("Lawlor Hall", "27C"));
});

// ---- the card -------------------------------------------------------------

test("the level curve starts fast and keeps costing more", () => {
  expect(levelFor(0)).toBe(1);
  expect(levelFor(4)).toBe(1);
  expect(levelFor(5)).toBe(2);
  expect(levelFor(20)).toBe(3);
  expect(levelFor(405)).toBe(10);
  // Each level costs more than the last, which is the whole point of the shape.
  const steps = [2, 3, 4, 5, 6].map((l) => costOf(l) - costOf(l - 1));
  expect(steps).toEqual([5, 15, 25, 35, 45]);
});

test("standing reports where you are inside the level, not just the level", () => {
  const at = standing(32);
  expect(at.level).toBe(3);
  expect(at.tier).toBe("uncommon");
  expect(at.toNext).toBe(13);
  expect(at.progress).toBeCloseTo((32 - 20) / (45 - 20));
  // A fresh account is at the start of level one, not halfway through nothing.
  expect(standing(0).progress).toBe(0);
  expect(standing(0).toNext).toBe(5);
});

test("tiers arrive in order and stop at legendary", () => {
  expect([1, 3, 5, 7, 10, 40].map(tierFor)).toEqual([
    "common",
    "uncommon",
    "rare",
    "holo",
    "legendary",
    "legendary",
  ]);
});
