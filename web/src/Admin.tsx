/**
 * Which slices of the directory are live.
 *
 * Everyone is seeded — undergraduates, graduate students, dual-enrolled high
 * schoolers, staff — because re-importing later would mean re-deciding who
 * exists. What each switch changes is who the queue may show and who search
 * may find, which is the actual research decision: a study of residential
 * undergraduates and a study of the whole institution are this database with
 * a different set of boxes ticked.
 *
 * Anyone who has signed in stays visible whatever their segment. Turning
 * somebody invisible after they consented would be the wrong way round.
 */

import { useEffect, useState } from "react";
import { SEGMENT_LABELS, SEGMENTS, type Segment, type Settings } from "../../shared/schema";
import * as api from "./api";

export function Admin({ say }: { say(m: string, tone?: string): void }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void api
      .settings()
      .then(setSettings)
      .catch((err) => say(String(err.message ?? err), "err"));
  }, [say]);

  if (!settings) return <section className="stack" />;

  async function toggle(segment: Segment, on: boolean) {
    const current = settings?.segments ?? [];
    const next = on ? [...current, segment] : current.filter((s) => s !== segment);
    setSettings(await api.setSegments(next).then((r) => ({ ...settings!, segments: r.segments })));
    say("saved", "ok");
  }

  const live = settings.segments;
  const shown = SEGMENTS.reduce(
    (n, s) => n + (live.includes(s) ? (settings.counts[s]?.total ?? 0) : 0),
    0,
  );

  return (
    <section className="stack">
      <div className="card">
        <h3>population</h3>
        <p className="muted">
          which slices of the directory the queue may show. everyone who has signed in stays visible
          whatever is ticked here.
        </p>
        {SEGMENTS.map((segment) => {
          const count = settings.counts[segment] ?? { total: 0, joined: 0 };
          return (
            <label className="row segment" key={segment}>
              <input
                type="checkbox"
                checked={live.includes(segment)}
                onChange={(e) => toggle(segment, e.target.checked)}
              />
              <span className="rname">{SEGMENT_LABELS[segment]}</span>
              <span className="facts">
                {count.total.toLocaleString()} seeded · {count.joined.toLocaleString()} joined
              </span>
            </label>
          );
        })}
        <p className="muted small">{shown.toLocaleString()} people in the live population</p>
      </div>
    </section>
  );
}
