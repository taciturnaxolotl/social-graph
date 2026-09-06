/**
 * Your card, which gets better the more of the study you do.
 *
 * A prototype, and an unashamed one. Ten thousand people are being asked to do
 * something repetitive for nothing, and a number that only goes up is the
 * cheapest honest motivator there is — honest because you cannot level by
 * answering badly, only by answering more. Nothing here touches what the data
 * is worth.
 *
 * The anatomy is a trading card's, closely, because that is the whole appeal:
 * a name plate with a level on it, a type mark, a portrait window, a line of
 * small print, a stat block laid out like a move list, and a set code in the
 * corner. Five sevenths, the proportion of every card anybody has held.
 *
 * Three things make one card different from another: the school you are in,
 * which picks the colour and the mark; the level you have reached, which picks
 * the finish; and the two things you choose yourself.
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

/** The rarity mark, the way a card tells you what it is at a glance. */
const RARITY: Record<string, string> = {
  common: "●",
  uncommon: "◆",
  rare: "★",
  holo: "✦",
  legendary: "✦",
};

/**
 * The cost pips beside a stat, which on a real card are the energy an attack
 * takes. Order of magnitude rather than the number itself, so the row reads at
 * a glance and a hundred and thirty is visibly a different thing from four.
 */
const pips = (value: number) => (value < 1 ? 0 : Math.min(4, Math.ceil(Math.log10(value + 1))));

/** Named, so the four identical pips have something stable to be keyed by. */
const PIPS = ["one", "two", "three", "four"];

/**
 * A cedar, because the app is called The Cedar Tree, and a watermark behind
 * the art is the oldest trick in card design for making a rectangle feel
 * printed rather than rendered.
 */
function Cedar() {
  return (
    <svg className="tcg-cedar" viewBox="0 0 64 84" aria-hidden="true">
      <title>cedar</title>
      <path d="M32 3 47 27h-7l11 19h-7l11 19H29V84h6V65H6l11-19h-7l11-19h-7z" />
    </svg>
  );
}

export function Card({ me }: { me: Me }) {
  const at = standing(me.answers);
  const frame = useRef<HTMLDivElement>(null);
  const next = tierFor(at.level + 1);

  const school = SCHOOLS[schoolOf(me.major, me.department)]!;
  const chosen = me.accent ? ACCENTS[me.accent] : undefined;
  // Your pick, or your school's colour, so a card has a personality before
  // anybody has touched a setting.
  const hue = chosen && chosen.hue >= 0 ? chosen.hue : school.hue;

  /*
   * The sheen follows the pointer, which is the entire trick that makes foil
   * feel like an object rather than a picture of one. Custom properties read
   * by the stylesheet; no state, so moving the mouse never re-renders.
   */
  function tilt(event: React.PointerEvent<HTMLDivElement>) {
    const node = frame.current;
    if (!node || at.level < 5) return;
    const box = node.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    node.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
    node.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    node.style.setProperty("--rx", `${((0.5 - y) * 10).toFixed(2)}deg`);
    node.style.setProperty("--ry", `${((x - 0.5) * 10).toFixed(2)}deg`);
  }

  function rest() {
    const node = frame.current;
    if (!node) return;
    for (const p of ["--px", "--py", "--rx", "--ry"]) node.style.removeProperty(p);
  }

  const year = me.class ? CLASSES[me.class] : null;
  const moves: [string, number][] = [
    ["answered", me.answers],
    ["notes written", me.notes],
    ["brought in", me.recruited],
  ];

  return (
    <div className="card-stage">
      {/* The gold stock, and inside it a body that is tinted rather than
          white. On a real card the colour is the whole interior, not a line
          around the edge, and that turned out to be the whole difference. */}
      <div
        ref={frame}
        className={`tcg ${at.tier}`}
        style={{ "--hue": hue } as React.CSSProperties}
        onPointerMove={tilt}
        onPointerLeave={rest}
      >
        <div className="tcg-body">
          <div className="tcg-sheen" aria-hidden="true" />
          <div className="tcg-grain" aria-hidden="true" />
          <p className="sr-only">
            level {at.level}, {at.tier}, {school.label}
          </p>

          {/* The strip that says what kind of card this is, where a real one
              says STAGE 1 and what it evolves from. */}
          <p className="tcg-stage">
            <b>lv {at.level}</b>
            <span>the cedar tree · {me.joined ? "participant" : "listed"}</span>
          </p>

          <header className="tcg-plate">
            <span className="tcg-name">{me.name}</span>
            <span className="tcg-hp">
              {me.knownBy}
              <small>known by</small>
            </span>
            <span className="tcg-type" title={school.label}>
              {school.mark}
            </span>
          </header>

          <div className="tcg-art">
            <Cedar />
            <Avatar person={me} size={420} />
          </div>

          {/* The line under the art, where a card puts the species, the height
              and the weight in the same breath. */}
          <p className="tcg-species">{[school.label, year].filter(Boolean).join(". ")}.</p>

          <dl className="tcg-moves">
            {moves.map(([label, value]) => (
              <div key={label}>
                <span className="tcg-cost" aria-hidden="true">
                  {PIPS.slice(0, pips(value)).map((pip) => (
                    <i key={pip} />
                  ))}
                </span>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {/* Three labelled columns along the bottom, where weakness,
              resistance and retreat cost go. */}
          <div className="tcg-bottom">
            <span>
              <small>next level</small>
              {at.toNext}
            </span>
            <span>
              <small>rarity</small>
              {at.tier} <i aria-hidden="true">{RARITY[at.tier]}</i>
            </span>
            <span>
              <small>type</small>
              <i aria-hidden="true">{school.mark}</i> {school.label.split(" ")[0]}
            </span>
          </div>

          {me.flavour && <p className="tcg-flavour">{me.flavour}</p>}

          <p className="tcg-fine">
            <span>illus. {me.photo ? "cedarville directory" : "initials"}</span>
            <span>
              cdr·26 <b>{me.id.slice(-4)}</b>/4651 <i aria-hidden="true">{RARITY[at.tier]}</i>
            </span>
          </p>
        </div>
      </div>

      <p className="muted small">
        {at.toNext} more to level {at.level + 1}
        {/* Only promise a new look when the next level actually changes one. */}
        {next !== at.tier ? `, which unlocks ${TIER_UNLOCK[next]}` : ""}
      </p>
    </div>
  );
}
