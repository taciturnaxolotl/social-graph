/**
 * Your own page: the photo, the two facts, the invite link, and the door out.
 *
 * The invite link is not tucked into a menu. It is the mechanism the study
 * grows by, so it sits above the fold with a button that copies it.
 */

import { useEffect, useState } from "react";
import type { Me } from "../../shared/schema";
import { Avatar } from "./Avatar";
import * as api from "./api";
import { setHints, useHints } from "./settings";

export function You({
  me,
  refresh,
  say,
}: {
  me: Me;
  refresh(): Promise<void>;
  say(m: string, tone?: string): void;
}) {
  const [name, setName] = useState(me.name);
  const [major, setMajor] = useState(me.major ?? "");
  const [dorm, setDorm] = useState(me.dorm ?? "");
  const [lists, setLists] = useState<{ majors: string[]; dorms: string[] }>({
    majors: [],
    dorms: [],
  });
  const [confirm, setConfirm] = useState("");
  const [copied, setCopied] = useState(false);
  const hints = useHints();

  useEffect(() => {
    void api
      .lists()
      .then(setLists)
      .catch(() => {});
  }, []);

  const url = `${location.origin}/i/${me.inviteCode}`;

  async function upload(file: File | undefined) {
    if (!file) return;
    say("uploading…");
    try {
      await api.uploadPhoto(await api.shrink(file));
      await refresh();
      say("photo updated", "ok");
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), "err");
    }
  }

  return (
    <section className="stack">
      <div className="identity">
        <Avatar person={me} size={72} />
        <div>
          <h2>{me.name}</h2>
          <p className="facts">{me.email}</p>
          <div className="row">
            <label className="btn btn-outline">
              {me.photo ? "change photo" : "add a photo"}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
            {me.photo && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  await api.dropPhoto();
                  await refresh();
                }}
              >
                remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* A real form, so Enter in any field saves it — which is what every
          other form on the web does and what the browser does for free the
          moment there is a submit button inside a form element. */}
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.save({ name, major: major.trim() || null, dorm: dorm.trim() || null });
            await refresh();
            say("saved", "ok");
          } catch (err) {
            say(err instanceof Error ? err.message : String(err), "err");
          }
        }}
      >
        <h3>profile</h3>
        <p className="muted">
          your major and hall are how the app finds people you are likely to know.
        </p>
        <label className="field">
          <span className="label">name</span>
          <input
            className="input"
            maxLength={80}
            value={name}
            autoComplete="name"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">major</span>
          <input
            className="input"
            list="majors"
            placeholder="start typing"
            value={major}
            enterKeyHint="done"
            onChange={(e) => setMajor(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">residence hall</span>
          <input
            className="input"
            list="dorms"
            placeholder="off campus"
            value={dorm}
            enterKeyHint="done"
            onChange={(e) => setDorm(e.target.value)}
          />
        </label>
        <datalist id="majors">
          {lists.majors.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <datalist id="dorms">
          {lists.dorms.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <button type="submit" className="btn btn-primary">
          save
        </button>
      </form>

      <div className="card">
        <h3>this device</h3>
        <label className="segment">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} />
          <span className="rname">show keyboard shortcuts</span>
        </label>
      </div>

      <div className="card">
        <h3>your invite link</h3>
        <p className="muted">invite others to expand the graph!</p>
        <div className="row grow">
          <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              await navigator.clipboard.writeText(url).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <p className="muted small">
          {me.rated} people placed · {me.ratedBy} people know you
        </p>
      </div>

      <div className="card">
        <h3>leaving</h3>
        <p className="muted">
          withdrawing will remove your name and photo from the graph and will cease recommending
          your profile to others.
        </p>
        <p className="muted">
          the connections other people drew stay in the dataset without your name on them, because
          they are part of how those people described their own world. a pattern of connections can
          sometimes identify a person even without a name. it cannot be undone.
        </p>
        <div className="row grow">
          <input
            className="input"
            placeholder="type withdraw"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-destructive"
            onClick={async () => {
              if (confirm.trim().toLowerCase() !== "withdraw")
                return say('type "withdraw" first', "err");
              await api.withdraw();
              location.href = "/?withdrawn=1";
            }}
          >
            withdraw from the study
          </button>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            await api.signOut();
            location.href = "/";
          }}
        >
          sign out
        </button>
      </div>
    </section>
  );
}
