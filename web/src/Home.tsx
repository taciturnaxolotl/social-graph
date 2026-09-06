/**
 * The page. Placing people is not a tab you choose, it is what is in front of
 * you.
 *
 * Search sits above the card rather than behind a nav, because looking
 * somebody up is the same task as placing them, not a different one: you
 * thought of a person, or you want to change an answer, and either way it
 * ends in pressing a number.
 *
 * Which is why choosing a result does not open a second, smaller rating
 * control beside their name. It puts them at the front of the queue and gets
 * out of the way, so they arrive on the same card as everybody else — same
 * photograph, same ten buttons, same note field, same undo. There was a whole
 * parallel widget here doing that job worse, and on a phone it was eleven
 * targets across 390 pixels.
 */

import { useEffect, useRef, useState } from "react";
import { type Candidate, CLASSES } from "../../shared/schema";
import { Avatar } from "./Avatar";
import * as api from "./api";
import { Rate } from "./Rate";

/** Fewer letters than this matches half the school, so it waits. */
const MIN_QUERY = 2;

export function facts(person: Candidate): string {
  /*
   * What helps somebody recognise a face, and nothing more than that.
   *
   * The hall and the hometown would both help and neither is here: the server
   * does not send them, because a card that prints where somebody lives to
   * everybody shown their face is an address book. The photograph is doing
   * the recognising; this line only has to disambiguate two people with one
   * name.
   *
   * The directory's department column is a job for a student — the dining
   * hall they work in — and a discipline for staff, so it is shown only to
   * the half it describes.
   */
  return [
    person.major ?? (person.segment === "staff" ? person.department : null),
    person.class ? CLASSES[person.class] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function Home({
  answered,
  onCount,
  say,
}: {
  answered: number;
  onCount(): void;
  say(m: string, tone?: string): void;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  /** Which result the arrow keys are on. */
  const [cursor, setCursor] = useState(0);
  /** The person a search sent to the front of the queue. */
  const [pinned, setPinned] = useState<Candidate | null>(null);
  const token = useRef(0);
  const box = useRef<HTMLInputElement>(null);

  const searching = query.trim().length >= MIN_QUERY;

  useEffect(() => {
    if (!searching) {
      setPeople([]);
      setSearched(false);
      return;
    }
    const mine = ++token.current;
    const timer = setTimeout(async () => {
      const found = await api.search(query.trim()).catch(() => []);
      if (mine !== token.current) return;
      setPeople(found);
      setCursor(0);
      setSearched(true);
    }, 140);
    return () => clearTimeout(timer);
  }, [query, searching]);

  /** Send them to the front of the queue and get out of the way. */
  function open(person: Candidate) {
    setPinned(person);
    setQuery("");
  }

  /*
   * Up and down through the results, Enter to choose, without leaving the
   * search box — the same bargain the rest of the app makes, where the
   * keyboard does the whole task and the mouse is optional.
   */
  function keys(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!people.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor((at) => Math.min(people.length - 1, Math.max(0, at + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = people[cursor];
      if (person) open(person);
    } else if (event.key === "Escape") {
      setQuery("");
      box.current?.blur();
    }
  }

  return (
    <>
      <div className="searchbar">
        <label className="sr-only" htmlFor="search">
          search people by name
        </label>
        <input
          id="search"
          ref={box}
          className="input"
          type="search"
          placeholder="search by name"
          // Names are not sentences and not dictionary words: no capitalising,
          // no autocorrect, no red underlines under everybody's surname.
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={keys}
        />
        {query && (
          <button type="button" className="btn btn-ghost" onClick={() => setQuery("")}>
            clear
          </button>
        )}
      </div>

      {/* Hidden, not unmounted: the queue, the undo history and the outbox all
          live in here, and a search should not cost you any of them. */}
      <div hidden={searching}>
        <Rate active={!searching} pinned={pinned} answered={answered} onCount={onCount} say={say} />
      </div>

      {searching && (
        <section className="results" aria-label="search results" aria-live="polite">
          {searched && !people.length && (
            <p className="muted">nobody by that name is in the study.</p>
          )}
          {people.length > 0 && (
            <ul>
              {people.map((person, i) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className={`result${i === cursor ? " on" : ""}`}
                    onClick={() => open(person)}
                    onMouseMove={() => setCursor(i)}
                  >
                    <Avatar person={person} size={36} />
                    <span className="who-text">
                      <span className="rname">{person.name}</span>
                      <span className="facts">{facts(person)}</span>
                    </span>
                    {person.strength !== undefined && (
                      <span className="placed-at">
                        {person.strength || "–"}
                        <span className="sr-only"> placed already</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
