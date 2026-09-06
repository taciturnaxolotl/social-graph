/**
 * Your card, which gets better the more of the study you do.
 *
 * A prototype, and an unashamed one. Ten thousand people are being asked to do
 * something repetitive for nothing, and a number that only goes up is the
 * cheapest honest motivator there is — honest because you cannot level by
 * answering badly, only by answering more. Nothing here touches what the data
 * is worth.
 *
 * The shape is a trading card because everybody already knows how to read one:
 * a name bar, a window with the art in it, a stat block, and a rarity line
 * along the bottom. It is deliberately louder than the rest of the app, which
 * is quiet on purpose everywhere else. A trophy is allowed to be a trophy.
 */

import { useRef } from "react";
import { CLASSES, type Me, standing, TIER_UNLOCK, tierFor } from "../../shared/schema";
import { Avatar } from "./Avatar";

const SEGMENTS: Record<string, string> = {
  ug: "undergraduate",
  grad: "graduate",
  de: "dual enrolled",
  staff: "faculty",
  other: "cedarville",
};

/** The mark in the corner, the way a card tells you what it is at a glance. */
const MARK: Record<string, string> = {
  common: "\u25cf",
  uncommon: "\u25c6",
  rare: "\u2605",
  holo: "\u2726",
  legendary: "\u2726",
};

export function Card({ me }: { me: Me }) {
  const at = standing(me.rated);
  const frame = useRef<HTMLDivElement>(null);

  /*
   * The holographic sheen follows the pointer, which is the entire trick that
   * makes a foil card feel like an object rather than a picture of one. Two
   * custom properties, read by the gradients in the stylesheet; no state, so
   * moving the mouse never re-renders anything.
   */
  function tilt(event: React.PointerEvent<HTMLDivElement>) {
    const node = frame.current;
    if (!node || at.level < 5) return;
    const box = node.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    node.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
    node.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    node.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
    node.style.setProperty("--ry", `${((x - 0.5) * 9).toFixed(2)}deg`);
  }

  function rest() {
    const node = frame.current;
    if (!node) return;
    for (const p of ["--px", "--py", "--rx", "--ry"]) node.style.removeProperty(p);
  }

  // The line under the name: what they told us, never what we guessed.
  const kind = me.major ?? (me.segment === "staff" ? me.department : null);
  const year = me.class ? CLASSES[me.class] : null;
  const next = tierFor(at.level + 1);
  const line = [kind ?? SEGMENTS[me.segment], year].filter(Boolean).join(" · ");

  const stats: [string, number][] = [
    ["placed", me.rated],
    ["notes written", me.notes],
    ["brought in", me.recruited],
  ];

  return (
    <div className="card-stage">
      <div ref={frame} className={`tcg ${at.tier}`} onPointerMove={tilt} onPointerLeave={rest}>
        <div className="tcg-sheen" aria-hidden="true" />
        {/* The card is a picture of numbers that are all written out below it,
            so the tier is the one thing a screen reader would otherwise miss. */}
        <p className="sr-only">
          level {at.level}, {at.tier}
        </p>

        {/* The name plate, with the level beside the name the way a card does
            it, and the one number that is about other people on the right. */}
        <header className="tcg-plate">
          <span className="tcg-name">{me.name}</span>
          <span className="tcg-lv">
            lv<b>{at.level}</b>
          </span>
          <span className="tcg-hp">
            <small>known by</small>
            <b>{me.ratedBy}</b>
          </span>
        </header>

        {/* Portrait, filling the width, with a hairline inside the frame — the
            proportion and the inner line are most of why a card reads as one. */}
        <div className="tcg-art">
          <Avatar person={me} size={420} />
        </div>

        <p className="tcg-print">{line}</p>

        <dl className="tcg-moves">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <footer className="tcg-foot">
          <span className="tcg-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, Math.round(at.progress * 100))}%` }} />
          </span>
          <span className="tcg-rarity">
            {at.tier} <span aria-hidden="true">{MARK[at.tier]}</span>
          </span>
        </footer>
      </div>

      <p className="muted small">
        {at.toNext} more to level {at.level + 1}
        {/* Only promise a new look when the next level actually changes one. */}
        {next !== at.tier ? `, which unlocks ${TIER_UNLOCK[next]}` : ""}
      </p>
    </div>
  );
}
