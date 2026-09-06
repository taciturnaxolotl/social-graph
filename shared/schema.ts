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
/*
 * A card you level up, because a study that needs ten thousand people to do
 * something repetitive for free needs a reason to come back, and a number that
 * only goes up is the cheapest honest one. Nothing here changes what the data
 * is worth — you cannot level by answering badly, only by answering more.
 */
export const TIERS = ["common", "uncommon", "rare", "holo", "legendary"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Placements needed to reach a level, as the inverse of the curve below:
 * 0, 5, 20, 45, 80, 125, 180, 245, 320, 405...
 *
 * Quadratic on purpose. Linear makes level 40 as easy as level 2 and the
 * number stops meaning anything; exponential stalls somebody at level 6
 * forever. This has a first level you reach in a minute and a tenth that costs
 * four hundred, which is roughly the shape of an evening and a term.
 */
export const costOf = (level: number) => 5 * (level - 1) ** 2;

export const levelFor = (placed: number) => 1 + Math.floor(Math.sqrt(Math.max(0, placed) / 5));

export function tierFor(level: number): Tier {
  if (level >= 10) return "legendary";
  if (level >= 7) return "holo";
  if (level >= 5) return "rare";
  if (level >= 3) return "uncommon";
  return "common";
}

/** What each tier is worth looking at for, in the order they arrive. */
export const TIER_UNLOCK: Record<Tier, string> = {
  common: "a plain card",
  uncommon: "a coloured frame",
  rare: "a foil finish",
  holo: "a holographic finish that follows your cursor",
  legendary: "gold, and the art breaks the frame",
};

/**
 * The type line, borrowed wholesale from every card game there has ever been.
 *
 * A card that looks identical for ten thousand people can only ever be so
 * interesting. The school somebody belongs to is the one axis in this data
 * that is both public, stable and visibly different — ten of them — so it
 * gets a colour and a mark, and two people from different schools now hold
 * recognisably different objects.
 *
 * Derived, never stored: the client already has the major and the department,
 * and a column would only be a third copy of the same fact.
 */
export interface School {
  label: string;
  /** oklch hue angle. Chroma and lightness are the stylesheet's business. */
  hue: number;
  mark: string;
}

export const SCHOOLS: Record<string, School> = {
  engineering: { label: "engineering & computer science", hue: 285, mark: "\u2726" },
  science: { label: "science & mathematics", hue: 195, mark: "\u2b21" },
  business: { label: "business", hue: 75, mark: "\u25c8" },
  humanities: { label: "arts & humanities", hue: 15, mark: "\u2766" },
  bible: { label: "biblical & theological studies", hue: 265, mark: "\u271d" },
  health: { label: "allied health & psychology", hue: 25, mark: "\u271a" },
  nursing: { label: "nursing", hue: 350, mark: "\u2719" },
  education: { label: "education & social work", hue: 55, mark: "\u2735" },
  rotc: { label: "military science", hue: 130, mark: "\u2605" },
  cedarville: { label: "cedarville", hue: 160, mark: "\u25c6" },
};

export type SchoolKey = keyof typeof SCHOOLS;

/**
 * Which school a person belongs to, from whatever they have.
 *
 * The self-reported major first, then the directory's department, which is
 * spelled inconsistently and sometimes truncated mid-word — "Engineering and
 * Computer Scien" is a real value — so this matches on fragments rather than
 * on equality.
 */
export function schoolOf(major: string | null, department: string | null): SchoolKey {
  const text = `${major ?? ""} ${department ?? ""}`.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (has("nursing")) return "nursing";
  if (has("engineering", "computer scien", "cyber", "software", "information tech"))
    return "engineering";
  if (has("bibl", "theolog", "ministr", "preach", "missions")) return "bible";
  if (has("pharm", "allied health", "psycholog", "athletic training", "pre-med", "physician"))
    return "health";
  if (has("business", "account", "market", "finance", "economic", "management")) return "business";
  if (has("educat", "social work", "teaching")) return "education";
  if (has("military science", "rotc")) return "rotc";
  if (has("science", "math", "biolog", "chem", "physics", "geolog")) return "science";
  if (has("art", "human", "english", "music", "history", "theatre", "communicat", "language"))
    return "humanities";
  return "cedarville";
}

/**
 * Frames you can put your card in, some of them earned.
 *
 * The default is your school's colour, so a card has a personality before
 * anybody touches a setting. The rest unlock as you go, which is the point:
 * a customisation you already had is not a reason to come back.
 */
export interface Accent {
  label: string;
  hue: number;
  from: number;
}

export const ACCENTS: Record<string, Accent> = {
  school: { label: "your school", hue: -1, from: 1 },
  slate: { label: "slate", hue: 250, from: 1 },
  moss: { label: "moss", hue: 150, from: 3 },
  clay: { label: "clay", hue: 40, from: 3 },
  plum: { label: "plum", hue: 320, from: 5 },
  ice: { label: "ice", hue: 220, from: 5 },
  ember: { label: "ember", hue: 20, from: 7 },
  gold: { label: "gold", hue: 85, from: 10 },
};

export const MAX_FLAVOUR = 60;

export interface Standing {
  level: number;
  tier: Tier;
  placed: number;
  /** How many more placements to the next level. */
  toNext: number;
  /** How far through the current level, 0 to 1. */
  progress: number;
}

export function standing(placed: number): Standing {
  const level = levelFor(placed);
  const floor = costOf(level);
  const ceiling = costOf(level + 1);
  return {
    level,
    tier: tierFor(level),
    placed,
    toNext: ceiling - placed,
    progress: (placed - floor) / (ceiling - floor),
  };
}

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
  /** Placements you bothered to write a note on. */
  notes: number;
  /** People who joined through your link. */
  recruited: number;
  /** A key from ACCENTS, or null to follow your school. */
  accent: string | null;
  /** A line of your own under the art. */
  flavour: string | null;
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
