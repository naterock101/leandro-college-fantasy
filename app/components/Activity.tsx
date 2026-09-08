import { useMemo } from "react";

import { cap, shortDate } from "../../lib/format.mjs";
import { useViewState } from "../hooks/useViewState";
import { Dropdown } from "./Dropdown";
import { Owned, TeamName } from "./TeamName";
import type { Data, Result } from "../types";

/**
 * Everything that has already happened, under one manager filter.
 *
 * Head to head is the argument - it is the league tiebreaker - and the
 * timeline is the whole week, so the two views share a filter and nothing
 * else.
 */
export function Activity({ data, note }: { data: Data; note: string | null }) {
  /* empty = every manager */
  const [sel, setSel] = useViewState<string[]>("activity.managers", []);
  const [view, setView] = useViewState<"h2h" | "timeline">("activity.view", "h2h");

  const managers = useMemo(
    () => data.standings.map((r) => r.manager).slice().sort(),
    [data]
  );

  /* headToHead is written oldest first; the history reads newest first. */
  const h2hGames = useMemo(
    () =>
      data.headToHead
        .filter(
          (h) =>
            sel.length === 0 ||
            sel.includes(h.winner.manager) ||
            sel.includes(h.loser.manager)
        )
        .reverse(),
    [data, sel]
  );

  /* Newest first the whole way down: weeks descend, and within a week the games
     descend too, so the very top of the page is the last game that finished. */
  const timeline = useMemo(() => {
    const all = data.results ?? [];
    const keep = all.filter(
      (r) =>
        sel.length === 0 ||
        (r.winner.manager && sel.includes(r.winner.manager)) ||
        (r.loser.manager && sel.includes(r.loser.manager))
    );
    const weeks = new Map<string, Result[]>();
    for (const r of keep) {
      if (!weeks.has(r.key)) weeks.set(r.key, []);
      weeks.get(r.key)!.push(r);
    }
    return [...weeks.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, games]) => ({
        key,
        label: games[0].seasonType === "postseason"
          ? `Postseason ${games[0].week}`
          : `Week ${games[0].week}`,
        games: games.slice().reverse(),
        /* Points belong to the winner, so a filtered week counts only the wins
           the selected managers actually had - their team losing to another
           manager's team is in `games`, but those points are not theirs.
           Unfiltered, this is every point the league scored that week. */
        points: games.reduce(
          (n, g) =>
            g.winner.manager && (sel.length === 0 || sel.includes(g.winner.manager))
              ? n + g.points
              : n,
          0
        ),
      }));
  }, [data, sel]);

  return (
    <>
      <div className="filters">
        <Dropdown
          name="activity"
          summary={
            sel.length === 0
              ? "All managers"
              : sel.length === 1
              ? cap(sel[0])
              : `${sel.length} managers`
          }
          allLabel="All managers"
          options={managers.map((m) => ({ value: m, label: cap(m) }))}
          selected={sel}
          onClear={() => setSel([])}
          onToggle={(m) =>
            setSel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))
          }
        />

        <div className="seg">
          {(["h2h", "timeline"] as const).map((k) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>
              {k === "h2h" ? "Head to head" : "Timeline"}
            </button>
          ))}
        </div>

      </div>

      {view === "h2h" && (
        <>
          <p className="asof">
            {h2hGames.length} scored game{h2hGames.length === 1 ? "" : "s"}, newest first.
            Every game with a drafted team on both sides - the league tiebreaker.
          </p>

          {h2hGames.map((h, i) => (
            <div className="gow" key={`${h.date}-${h.winner.team}-${i}`}>
              <span className="mono muted d">{shortDate(h.date)}</span>
              <span className="mu">
                <b>{cap(h.winner.manager)}</b>&rsquo;s <TeamName team={h.winner.team} /> beat{" "}
                <b>{cap(h.loser.manager)}</b>&rsquo;s <TeamName team={h.loser.team} />
                {h.sameManager && <em className="self"> own goal</em>}
                {h.upset && <em className="upset"> upset · {h.spread!.formatted}</em>}
              </span>
              <span className="mono muted wk">
                {h.seasonType === "postseason" ? `P${h.week}` : `Wk ${h.week}`}
              </span>
              <span className="mono muted score">{h.score}</span>
            </div>
          ))}

          {!h2hGames.length && (
            <p className="caption">
              {note ??
                (data.headToHead.length === 0
                  ? "No game between two drafted teams has been scored yet."
                  : "No games match that filter.")}
            </p>
          )}
        </>
      )}

      {view === "timeline" && (
        <>
          <p className="asof">
            Every scored game with a drafted team in it, newest first.{" "}
            {sel.length > 0 && `Filtered to ${sel.map(cap).join(", ")}.`}
          </p>

          {timeline.map((w) => (
            <section key={w.key}>
              <h2>
                {w.label}
                <span className="cw">
                  {w.games.length} game{w.games.length === 1 ? "" : "s"} · {w.points} pts
                </span>
              </h2>
              {w.games.map((g, i) => (
                <div className="gow" key={`${g.date}-${g.winner.team}-${i}`}>
                  <span className="mono muted d">{shortDate(g.date)}</span>
                  <span className="mu">
                    <Owned side={g.winner} /> beat <Owned side={g.loser} />
                    {g.sameManager && <em className="self"> own goal</em>}
                    {g.upset && g.line && <em className="upset"> upset · {g.line}</em>}
                  </span>
                  <span className="mono muted score">{g.score}</span>
                  {/* Points belong to the winner. Under a manager filter the
                      list still shows the games their teams lost, so a badge
                      that is not theirs is dimmed - otherwise a filtered week
                      reads as "+3" on a game they lost while the heading above
                      it correctly says 0. A loss worth nothing to anyone gets
                      a blank, which says it more plainly than a 0. */}
                  <span
                    className={`mono stakes${
                      g.winner.manager && (sel.length === 0 || sel.includes(g.winner.manager))
                        ? ""
                        : " them"
                    }`}
                  >
                    {g.points ? `+${g.points}` : ""}
                  </span>
                </div>
              ))}
            </section>
          ))}

          {!timeline.length && (
            <p className="caption">
              {note ?? "No scored games match that filter."}
            </p>
          )}
        </>
      )}
    </>
  );
}

export const css = `
    .upset{color:var(--teal);font-style:normal;font-size:11px;white-space:nowrap}
    /* a points badge that belongs to a manager the filter is not about */
    .stakes.them{color:var(--dim);font-weight:400}
    .wk{font-size:11px;width:34px;text-align:right;flex-shrink:0;color:var(--dim)}
`;
