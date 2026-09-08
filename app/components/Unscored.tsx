import { useMemo } from "react";

import { shortDate } from "../../lib/format.mjs";
import { Owned } from "./TeamName";
import type { Data, Unscored as UnscoredGame } from "../types";

/* Says what the payload knows and stops there. Nothing upstream distinguishes
   weather from a forfeit from a feed outage, so a sentence that guessed at a
   cause would be confidently wrong in front of the people who watched the game
   - or watched it not happen. */
const why = (u: { reason: string; date: string }) =>
  u.reason === "no result"
    ? `Kicked off ${shortDate(u.date)} and never reported a final score.`
    : u.reason === "tied"
    ? `Ended level on ${shortDate(u.date)}, and this league has no half wins.`
    : `Marked final on ${shortDate(u.date)} with no score in the feed.`;

/**
 * Games that will never be scored.
 *
 * Nothing here is reachable from the live block above: the builder writes a
 * game into gamesOfWeek or into unscored and never both, so the filter that
 * feeds "On the field" cannot see these. That filter has a second guard of
 * its own - it drops anything more than five and a half hours past kickoff -
 * which is what keeps a game that stalls between builds out of the live list
 * until the next run moves it down here.
 */
export function Unscored({ data }: { data: Data }) {
  /* Grouped by the week the game belonged to, oldest first. A game abandoned in
     week 1 stays filed under week 1 however many weeks later it is read,
     because the question it answers is "what happened to that game", and the
     answer is anchored to the week it was supposed to be part of. */
  const weeks = useMemo(() => {
    const byKey = new Map<string, UnscoredGame[]>();
    for (const u of data.unscored ?? []) {
      if (!byKey.has(u.key)) byKey.set(u.key, []);
      byKey.get(u.key)!.push(u);
    }
    return [...byKey.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, games]) => ({
        key,
        label: games[0].seasonType === "postseason"
          ? `Postseason ${games[0].week}`
          : `Week ${games[0].week}`,
        games,
      }));
  }, [data]);

  if (!weeks.length) return null;
  const total = weeks.reduce((n, w) => n + w.games.length, 0);

  return (
    <section className="unscwrap">
      <h2>
        Never scored
        <span className="cw">
          {total} game
          {total === 1 ? "" : "s"}
        </span>
      </h2>
      {weeks.map((w) => (
        <div key={w.key}>
          <p className="wklab">{w.label}</p>
          {w.games.map((u, i) => (
            <div className="unsc" key={`${u.date}-${u.home.team}-${i}`}>
              <span className="mu">
                <Owned side={u.away} />
                <span className="at"> at </span>
                <Owned side={u.home} />
              </span>
              <span className="why">{why(u)}</span>
            </div>
          ))}
        </div>
      ))}
      <p className="caption">
        None of these produced a winner, so none of them count toward points,
        remaining or ceiling.
      </p>
    </section>
  );
}

export const css = `
    /* this sits under games of the week, which ends in its own small print, so
       it needs the same clearer break the live block gets */
    .unscwrap h2{margin-top:32px}
    .wklab{font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.1em;
      text-transform:uppercase;color:var(--muted);margin:14px 0 0}
    .unsc{padding:8px 0;font-size:13px;border-bottom:1px solid rgba(42,61,83,.4)}
    /* the reason is the whole content of the row, so it wraps under the teams
       rather than competing with them for a fixed column on a phone */
    .why{display:block;font-size:11px;line-height:1.45;color:var(--muted);margin-top:2px}
`;
