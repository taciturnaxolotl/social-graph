/**
 * Your card: a specimen plate, of the kind a herbarium sheet carries.
 *
 * Ten thousand people are being asked to do something repetitive for nothing,
 * and a number that only goes up is the cheapest honest motivator there is —
 * honest because you cannot level by answering badly, only by answering more.
 *
 * It was a Pokémon card twice, and both times it was cosplay rather than
 * design: a gold border with no reason to be gold, energy pips for a game
 * mechanic that does not exist, weakness and retreat columns repurposed as
 * trivia. Decoration pretending to be information, in four hues that had
 * nothing to do with each other or with the rest of the app.
 *
 * A specimen plate is the same idea done honestly. It is genuinely
 * collectible, it carries a collection number and a date because those are
 * real facts about a specimen, and it belongs to an app called The Cedar Tree
 * rather than to somebody else's set. Nothing on it is borrowed.
 *
 * Levelling changes what the card appears to be *made of* — plain stock, a
 * printed rule, a blind-embossed seal, a gilt edge, a foil stamp — rather than
 * repainting it. The paper is the same colour at level one and level ten,
 * which is what keeps a reward from reading as a costume change.
 */

import { useRef } from "react";
import {
  ACCENTS,
  CLASSES,
  type Me,
  SCHOOLS,
  schoolOf,
  standing,
  TIER_UNLOCK,
  tierFor,
} from "../../shared/schema";
import { Avatar } from "./Avatar";

/**
 * A cedar sprig, drawn the way a plate would have it: one stem, needles either
 * side. The triangular christmas-tree shape this replaces was a pictogram; a
 * herbarium sheet has a drawing.
 */
function Sprig() {
  return (
    <svg className="plate-sprig" viewBox="0 0 40 56" aria-hidden="true">
      <title>cedar sprig</title>
      <g fill="none" stroke="currentcolor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M20 54V8" />
        <path d="M20 46 8 40M20 46l12-6M20 38 10 31M20 38l10-7M20 30l-8-6M20 30l8-6M20 22l-6-5M20 22l6-5M20 15l-4-4M20 15l4-4" />
      </g>
    </svg>
  );
}

export function Card({ me }: { me: Me }) {
  const at = standing(me.answers);
  const frame = useRef<HTMLDivElement>(null);
  const next = tierFor(at.level + 1);

  const school = SCHOOLS[schoolOf(me.major, me.department)]!;
  const chosen = me.accent ? ACCENTS[me.accent] : undefined;
  // Your pick, or your school's. It is the ink colour here, not the card's.
  const hue = chosen && chosen.hue >= 0 ? chosen.hue : school.hue;

  /*
   * Only the top two finishes catch the light, and only then does the card
   * lean. A sheet of paper that tilts is a gimmick; gilt and foil catching the
   * light is what those materials actually do.
   */
  function tilt(event: React.PointerEvent<HTMLDivElement>) {
    const node = frame.current;
    if (!node || at.level < 7) return;
    const box = node.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    node.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
    node.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    node.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
    node.style.setProperty("--ry", `${((x - 0.5) * 5).toFixed(2)}deg`);
  }

  function rest() {
    const node = frame.current;
    if (!node) return;
    for (const p of ["--px", "--py", "--rx", "--ry"]) node.style.removeProperty(p);
  }

  const year = me.class ? CLASSES[me.class] : null;
  const rows: [string, number][] = [
    ["answered", me.answers],
    ["noted", me.notes],
    ["known by", me.knownBy],
    ["brought in", me.recruited],
  ];

  return (
    <div className="card-stage">
      <div
        ref={frame}
        className={`plate ${at.tier}`}
        style={{ "--hue": hue } as React.CSSProperties}
        onPointerMove={tilt}
        onPointerLeave={rest}
      >
        <div className="plate-sheen" aria-hidden="true" />
        <p className="sr-only">
          level {at.level}, {at.tier}, {school.label}
        </p>

        <header className="plate-head">
          <span>the cedar tree</span>
          <span>no. {me.id.slice(-4)}</span>
        </header>

        {/* Mounted, with the corners a photograph is held down by. */}
        <div className="plate-mount">
          <Avatar person={me} size={420} />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
        </div>

        <div className="plate-label">
          <h3>{me.name}</h3>
          <p className="plate-species">{me.major ?? school.label}</p>
          <p className="plate-coll">coll. 2026{year ? ` · ${year}` : ""}</p>
        </div>

        {/* Dot leaders, because that is how a printed index reads. */}
        <dl className="plate-rows">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {me.flavour && <p className="plate-flavour">{me.flavour}</p>}

        <footer className="plate-foot">
          <span className="plate-seal" title={school.label}>
            <Sprig />
          </span>
          <span className="plate-level">
            lv {at.level} <small>{at.tier}</small>
          </span>
        </footer>
      </div>

      <p className="muted small">
        {at.toNext} more to level {at.level + 1}
        {/* Only promise a new finish when the next level actually changes one. */}
        {next !== at.tier ? `, which unlocks ${TIER_UNLOCK[next]}` : ""}
      </p>
    </div>
  );
}
