/**
 * The rating loop, which is the whole product.
 *
 * Everything here serves one number: how many people somebody places before
 * they get bored. So the card never waits on the network. A batch is fetched
 * ahead and refilled while the previous one is still being answered, answers
 * post in the background, and the next face is up the moment a key goes down.
 * A failed post is retried on the next answer rather than dropped, because
 * losing an edge to a flaky connection is worse than sending it twice.
 *
 * The keyboard is the real interface: one through nine, zero for ten, space
 * for a stranger. Thumbs get the same thing as a grid of targets big enough
 * to hit while walking.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ANCHORS, type Candidate, MAX_CONTEXT, REASONS, UNKNOWN } from "../../shared/schema";
import { Avatar } from "./Avatar";
import * as api from "./api";
import { facts } from "./Home";
import { useHints } from "./settings";

/** Refill when the batch runs this low, so the queue is never empty on screen. */
const REFILL_AT = 8;

interface Answer {
  person: Candidate;
  strength: number | "skip";
  /** Free text, because a fixed list would decide in advance what a tie is. */
  where?: string;
}

interface Props {
  /** False while search is on screen: the card is still mounted but not listening. */
  active: boolean;
  /** A person chosen from search, who jumps the queue. */
  pinned: Candidate | null;
  /** The one running total, so the card and the account can never disagree. */
  answered: number;
  onCount(): void;
  say(m: string, tone?: string): void;
}

export function Rate({ active, pinned, answered, onCount, say }: Props) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  /** Where the rater met this person, if they felt like saying. Cleared per card. */
  const [where, setWhere] = useState("");
  /**
   * The number picked but not yet sent.
   *
   * Choosing and submitting are two steps on purpose. They used to be one, and
   * the card flew past the moment you touched a number — which is fast, and
   * also means a misread name is already recorded, and means the note field
   * below can never be filled in because the person it belongs to is gone.
   */
  const [chosen, setChosen] = useState<number | null>(null);
  const hints = useHints();
  const queue = useRef<Candidate[]>([]);
  const history = useRef<Answer[]>([]);
  const pending = useRef<Answer[]>([]);
  /*
   * Every id this session has already put in front of you.
   *
   * A refill asks the server for people you have not rated, and the server is
   * right at the moment it answers — but answers post in the background, so a
   * refill fired while a handful are still in flight comes back holding people
   * you have just placed. They are no longer in the queue to be deduplicated
   * against, so without this they come round a second time.
   */
  const seen = useRef(new Set<string>());
  const fetching = useRef(false);
  const alive = useRef(true);

  const refill = useCallback(async () => {
    if (fetching.current || !alive.current) return;
    fetching.current = true;
    redraw();
    try {
      const batch = await api.queue(24);
      const fresh = batch.filter((p) => !seen.current.has(p.id));
      for (const p of fresh) seen.current.add(p.id);
      queue.current.push(...fresh);
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), "err");
    } finally {
      fetching.current = false;
      if (alive.current) redraw();
    }
  }, [say]);

  /** Drain the outbox in order; a failure leaves the rest for the next answer. */
  const flush = useCallback(
    async (answer: Answer) => {
      pending.current.push(answer);
      while (pending.current.length) {
        const next = pending.current[0]!;
        try {
          if (next.strength === "skip") await api.skip(next.person.id);
          else await api.rate(next.person.id, next.strength, next.where);
          pending.current.shift();
        } catch {
          return;
        }
      }
      onCount();
    },
    [onCount],
  );

  const commit = useCallback(
    (strength: number | "skip") => {
      const person = queue.current.shift();
      if (!person) return;
      // A note about somebody you have never heard of is not a note.
      const note =
        strength === UNKNOWN || strength === "skip" ? undefined : where.trim() || undefined;
      history.current.push({ person, strength, where: note });
      setWhere("");
      setChosen(null);
      void flush({ person, strength, where: note });
      if (queue.current.length < REFILL_AT) void refill();
      redraw();
    },
    [flush, refill, where],
  );

  /**
   * Pick an answer from the keyboard and put focus on it, which is what
   * clicking the cell does and what lets the browser's own Enter handling
   * take it from there.
   */
  const choose = useCallback((value: number) => {
    setChosen(value);
    document.getElementById(value === UNKNOWN ? "choice-none" : `choice-${value}`)?.focus();
  }, []);

  /** Send the pending choice and move on. Nothing happens until this runs. */
  const submit = useCallback(() => {
    if (chosen !== null) commit(chosen);
  }, [chosen, commit]);

  const undo = useCallback(() => {
    const last = history.current.pop();
    if (!last) return;
    queue.current.unshift(last.person);
    setWhere(last.where ?? "");
    // Put the answer back where it was, so undo is a correction and not a retype.
    setChosen(last.strength === "skip" ? null : last.strength);
    void api.undo(last.person.id).catch(() => {});
    redraw();
  }, []);

  useEffect(() => {
    alive.current = true;
    void refill();
    return () => {
      alive.current = false;
    };
  }, [refill]);

  /*
   * Somebody searched for. They go to the front rather than into a rating
   * widget of their own, and they are pulled out of wherever else they were
   * sitting in the queue so they cannot come round a second time.
   */
  useEffect(() => {
    if (!pinned) return;
    if (queue.current[0]?.id === pinned.id) return;
    queue.current = [pinned, ...queue.current.filter((p) => p.id !== pinned.id)];
    seen.current.add(pinned.id);
    setChosen(null);
    setWhere("");
    redraw();
  }, [pinned]);

  useEffect(() => {
    if (!active) return;
    function key(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const radio = tag === "INPUT" && (target as HTMLInputElement).type === "radio";
      /*
       * Space belongs to whatever the keyboard is on. Overriding it on a
       * focused button fires two things at once, and one of them is a wrong
       * edge. On a radio it is free: in a group where the arrows move the
       * selection, focus and answer are already the same thing and space has
       * nothing left to do.
       */
      const onButton = /^(button|a)$/i.test(tag);
      // Typing a note, or in any other text field: nothing gets through.
      const editing = /^(textarea|select)$/i.test(tag) || (tag === "INPUT" && !radio);

      /*
       * Enter is not here. The answer is a real form with a real submit
       * button, so the browser submits it — from the note field, from the
       * scale, from anywhere inside. Which is why choosing by keyboard moves
       * focus onto the radio: it puts the caret in the form, the way clicking
       * the cell would have.
       */
      if (editing) return;
      /*
       * Two keys for the commonest answer. Space is where a thumb already
       * rests, and x is where a hand on the number row already is — and
       * unlike space it is not also the page-down key, so it does not have to
       * stand aside for whatever happens to have focus.
       */
      if (event.key === "x") {
        event.preventDefault();
        return choose(UNKNOWN);
      }
      if (event.key === " " && !onButton) {
        event.preventDefault();
        return choose(UNKNOWN);
      }

      const digit = "1234567890".indexOf(event.key);
      if (digit >= 0) {
        event.preventDefault();
        return choose(digit + 1);
      }
      if (event.key === "s") return commit("skip");
      if (event.key === "Backspace" || event.key === "z") {
        event.preventDefault();
        return undo();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [active, choose, commit, undo]);

  const person = queue.current[0];

  if (!person) {
    return (
      <section className="empty">
        <h2>{fetching.current ? "finding people…" : "that is everyone we can show you"}</h2>
        {!fetching.current && (
          <p className="muted">
            the graph grows when other people join. share your invite link, then come back.
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      {/* The card holds the person and nothing else. Everything you do to them
          happens on the page below it, which is what makes the two read as two
          things rather than one long column of controls in a box. */}
      {/*
       * Nothing announces itself when text is swapped in place, so a screen
       * reader would answer one question and be handed the next in silence.
       * The live region is the wrapper, which stays put; the card inside it
       * is keyed so the entrance animation still restarts per person.
       */}
      <div aria-live="polite" aria-atomic="true">
        <section className="rating" key={person.id}>
          <Avatar person={person} size={176} />
          <h2 className="name">{person.name}</h2>
          {facts(person) && <p className="facts">{facts(person)}</p>}
          {REASONS[person.because] && <span className="badge">{REASONS[person.because]}</span>}
        </section>
      </div>

      <form
        className="answer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/*
         * Native radios, visually hidden inside the cells you can see.
         *
         * A fieldset with eleven radios is one tab stop, arrow keys move the
         * answer, and the grouping is announced without a word of ARIA. The
         * hand written version of this was a roving tabindex and a keydown
         * handler that between them did worse than the platform does for
         * free. The two halves are laid out apart and still one group,
         * because radios group by name and not by container.
         */}
        <fieldset className="choices">
          <legend className="question">how well do you know them?</legend>

          {/* Low to high, left to right, with the ends labelled so the
              direction reads without counting. */}
          <div className="scale">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <label key={n} className="step" style={{ "--step": n / 10 } as React.CSSProperties}>
                <input
                  id={`choice-${n}`}
                  className="sr-only"
                  type="radio"
                  name="strength"
                  checked={chosen === n}
                  onChange={() => setChosen(n)}
                />
                <span aria-hidden="true">{n}</span>
                <span className="sr-only">{n} out of 10</span>
              </label>
            ))}
          </div>
          <div className="anchors" aria-hidden="true">
            <span>{ANCHORS[0]}</span>
            <span>{ANCHORS[1]}</span>
          </div>

          {/* After the scale, not before it, and no wider than its own words:
              this is the answer for when none of the ten apply, and a full
              width bar reads as a banner rather than one more choice. */}
          <div className="none">
            <span className="muted" aria-hidden="true">
              or
            </span>
            <label className="btn btn-outline">
              <input
                id="choice-none"
                className="sr-only"
                type="radio"
                name="strength"
                checked={chosen === UNKNOWN}
                onChange={() => setChosen(UNKNOWN)}
              />
              never heard of them {hints && <span className="kbd">x</span>}
            </label>
          </div>
        </fieldset>

        <label className="field where">
          <span className="label">
            where did you meet them? <span className="muted">optional</span>
          </span>
          <input
            className="input"
            value={where}
            maxLength={MAX_CONTEXT}
            placeholder="a class, a hall, a team, a friend"
            // A sentence about a person, not a password: capitalise it, spell
            // check it, and label the phone's return key with what it does.
            autoCapitalize="sentences"
            spellCheck={true}
            enterKeyHint="send"
            onChange={(e) => setWhere(e.target.value)}
          />
        </label>

        <div className="commit">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={chosen === null}
            aria-describedby="commit-hint"
          >
            next {hints && <span className="kbd">enter</span>}
          </button>
          <span className="muted small" id="commit-hint">
            {chosen === null
              ? "pick a number to continue"
              : chosen === UNKNOWN
                ? "never heard of them"
                : `you know them ${chosen} out of 10`}
          </span>
        </div>
      </form>

      <div className="foot">
        <button
          type="button"
          className="btn btn-ghost"
          aria-keyshortcuts="s"
          onClick={() => commit("skip")}
        >
          ask me later {hints && <span className="kbd">s</span>}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          aria-keyshortcuts="z"
          onClick={undo}
          disabled={!history.current.length}
        >
          undo {hints && <span className="kbd">z</span>}
        </button>
        <span className="tally">{answered} answered</span>
      </div>
    </>
  );
}
