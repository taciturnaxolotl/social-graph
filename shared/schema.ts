/**
 * The shapes both halves agree on. Imported by the worker and by the page, so
 * a field that changes name breaks the build rather than the study.
 */

/**
 * Zero is a separate answer, not a low one, and it is the one the page makes
 * biggest: most cards are strangers and the loop is only fast if saying so is
 * one key.
 */
export const UNKNOWN = 0;

/**
 * The two ends of the scale, and only the two ends.
 *
 * Four labels under ten buttons cannot line up with any of them — "friend"
 * sits between the seventh and the eighth and belongs to neither — so they
 * read as a caption rather than a calibration. Two, hard against the first
 * and last button, say which way the numbers run, which is the whole job.
 */
export const ANCHORS: [low: string, high: string] = ["barely know them", "closest people"];

/**
 * Which slice of the directory a seeded row came from.
 *
 * Everyone is imported; which segments are live is a setting, so a study
 * about residential undergraduates and a study about the whole institution
 * are the same database with a different switch.
 */
export const SEGMENTS = ["ug", "grad", "de", "staff", "other"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  ug: "undergraduates",
  grad: "graduate and professional",
  de: "dual enrolled",
  staff: "faculty and staff",
  other: "everyone else",
};

/**
 * What one person may know about another.
 *
 * Deliberately without the residence hall, the room and the hometown. Those
 * are the queue's best signals and it uses all three, but a page that prints
 * where somebody lives to everybody who is shown their face is an address
 * book, not a study. The fields exist on the server and stop there.
 */
export interface Person {
  id: string;
  name: string;
  segment: Segment;
  class: string | null;
  major: string | null;
  department: string | null;
  photo: string | null;
  /** True once they have signed in themselves, rather than only being listed. */
  joined: boolean;
}

/** Your own row, which may hold the things nobody else is shown. */
export interface Me extends Person {
  email: string;
  dorm: string | null;
  invitedBy: string | null;
  inviteCode: string;
  /*
   * "answers", not "placed" and not "rated". The database records ratings
   * because that is what an edge weight is called in the literature, but the
   * thing a person does here is answer a question — including the answer
   * "never heard of them", which is neither a rating nor a placement.
   */
  answers: number;
  knownBy: number;
  admin: boolean;
}

export type Because =
  | "inviter"
  | "reciprocal"
  | "mutual"
  | "cluster"
  | "dorm"
  | "cohort"
  | "unrated"
  | "search";

/*
 * Why this face, but only when the answer is a person.
 *
 * "Invited you here" and "known by people you know" tell you something you
 * could act on. "Same major", "you may cross paths", "not yet placed" tell
 * you how the software works, which is not interesting and is one more thing
 * to read on every single card. The proximity tiers are silent on purpose:
 * naming the building would undo the care taken to keep it off the card.
 */
export const REASONS: Partial<Record<Because, string>> = {
  inviter: "invited you here",
  reciprocal: "already placed you",
  mutual: "known by people you know",
};

export interface Candidate extends Person {
  because: Because;
  /** A previous answer, when the card is being revisited from search. */
  strength?: number;
}

export interface Settings {
  segments: Segment[];
  counts: Record<string, { total: number; joined: number }>;
}

/** Long enough for "chem lab sophomore year", short enough not to be an essay. */
export const MAX_CONTEXT = 140;

export const isSegment = (v: unknown): v is Segment =>
  typeof v === "string" && (SEGMENTS as readonly string[]).includes(v);

export const validStrength = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10;

/**
 * Class codes as the directory writes them, as a person would say them.
 *
 * An unmapped code renders as nothing, which is the right outcome for the
 * ones this school does not use consistently.
 */
export const CLASSES: Record<string, string> = {
  FR: "freshman",
  SO: "sophomore",
  JR: "junior",
  SR: "senior",
  GR: "graduate",
  GS: "graduate",
  MG: "graduate",
  P1: "pharmacy",
  P2: "pharmacy",
  P3: "pharmacy",
  P4: "pharmacy",
  HS: "dual enrolled",
  ND: "non-degree",
};
