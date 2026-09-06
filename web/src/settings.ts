/**
 * Preferences that belong to a device, not to a person.
 *
 * Whether to print the keyboard hints is a fact about the machine in front of
 * you: on for the laptop you place two hundred people from, off for the phone
 * you use in a queue. So it lives in localStorage rather than in D1 — no
 * column, no migration, no round trip, and the answer is allowed to differ
 * between your own two devices, which a server-side flag could not do.
 *
 * The shortcuts themselves are always live. Hiding a hint is not the same as
 * taking the key away, and somebody who has learnt them should not lose them
 * by tidying up their screen.
 */

import { useSyncExternalStore } from "react";

const KEY = "cedar:hints";
const CHANGED = "cedar:settings";

const listeners = new Set<() => void>();

function subscribe(fire: () => void) {
  listeners.add(fire);
  // Another tab on the same device changed it.
  addEventListener("storage", fire);
  addEventListener(CHANGED, fire);
  return () => {
    listeners.delete(fire);
    removeEventListener("storage", fire);
    removeEventListener(CHANGED, fire);
  };
}

/** Off by default: three grey letters on every card, for a shortcut most people never press. */
export const hintsOn = () => localStorage.getItem(KEY) === "on";

export function setHints(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
  dispatchEvent(new Event(CHANGED));
}

export const useHints = () => useSyncExternalStore(subscribe, hintsOn, () => false);
