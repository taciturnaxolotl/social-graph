/*
 * The shell. Reads the account, draws the header, and swaps in one view.
 *
 * Signed out it is a landing page instead, because there is exactly one thing
 * to do there and a tab bar over an empty app is a worse way to say so. An
 * invite code in the URL rides along into the sign-in link.
 */

import { useCallback, useEffect, useState } from "react";
import type { Me } from "../../shared/schema";
import { Admin } from "./Admin";
import * as api from "./api";
import { Home } from "./Home";
import { You } from "./You";

/*
 * "place", not "rate". The database records ratings because that is what an
 * edge weight is called in the literature, but nobody wants to be told they
 * are being rated by their classmates — the word is for products and it reads
 * as a verdict. Placing somebody says what the task actually is: putting a
 * person where they already are in your life.
 */
type Tab = "people" | "you" | "admin";
const TABS: Tab[] = ["people", "you"];
const isTab = (v: string): v is Tab => ["people", "you", "admin"].includes(v);

const ERRORS: Record<string, string> = {
  domain: "that account is not a cedarville.edu account.",
  state: "that sign-in link expired. try again.",
  google: "google turned us down. try again.",
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [canSignIn, setCanSignIn] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    const asked = location.hash.slice(1);
    return isTab(asked) ? asked : "people";
  });
  const [status, setStatus] = useState<{ text: string; tone: string }>({ text: "", tone: "" });

  const say = useCallback((text: string, tone = "") => setStatus({ text, tone }), []);
  const refresh = useCallback(async () => setMe(await api.me()), []);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof api.NeedsSignIn) setCanSignIn(err.canSignIn);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onHash = () => {
      const asked = location.hash.slice(1);
      setTab(isTab(asked) ? asked : "people");
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    say("");
  }, [say]);

  if (!ready) return null;

  const params = new URLSearchParams(location.search);

  if (!me) {
    const invite = params.get("invite");
    const problem = ERRORS[params.get("error") ?? ""];
    return (
      <>
        <Header />
        <p className={`status ${params.get("withdrawn") ? "ok" : "err"}`} role="status">
          {params.get("withdrawn")
            ? "you have been withdrawn. your name, photo and every rating touching you are gone."
            : (problem ?? "")}
        </p>
        <main>
          <section className="landing">
            <h2>who knows whom, at cedarville</h2>
            <p>
              a research project on how a campus actually connects. you place people one to ten on
              how well you know them; that is the whole task, and it takes about a second each.
            </p>
            <p className="muted">
              sign in with your cedarville google account, which is only used to check you go here.
              you can change your photo, major and hall, and you can withdraw at any time, which
              deletes your name and everything either of you said about the other.
            </p>
            {canSignIn ? (
              <a
                className="btn btn-primary"
                href={invite ? `/auth/google?invite=${encodeURIComponent(invite)}` : "/auth/google"}
              >
                sign in with google
              </a>
            ) : (
              <p className="muted">google sign-in is not configured on this server yet.</p>
            )}
          </section>
        </main>
      </>
    );
  }

  const tabs: Tab[] = me.admin ? [...TABS, "admin"] : TABS;

  /*
   * The destinations live in the header rather than in a strip above the
   * content, because there is really only one page here. Rating is what the
   * app is; the rest is somewhere you go once and come back from.
   */
  return (
    <>
      <header>
        <h1>The Cedar Tree</h1>
        <nav>
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              className={name === tab ? "on" : ""}
              aria-current={name === tab ? "page" : undefined}
              onClick={() => {
                location.hash = name;
                setTab(name);
                say("");
              }}
            >
              {name}
            </button>
          ))}
        </nav>
      </header>
      <p className={`status ${status.tone}`} role="status">
        {status.text}
      </p>
      <main>
        {tab === "people" && <Home placed={me.rated} onCount={refresh} say={say} />}
        {tab === "you" && <You me={me} refresh={refresh} say={say} />}
        {tab === "admin" && <Admin say={say} />}
      </main>
    </>
  );
}

const Header = ({ who }: { who?: string }) => (
  <header>
    <h1>The Cedar Tree</h1>
    <p className="muted small">{who ?? ""}</p>
  </header>
);
