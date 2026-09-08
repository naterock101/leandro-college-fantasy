import { useMemo } from "react";

import { cap, tally } from "../../lib/format.mjs";
import { useViewState } from "../hooks/useViewState";
import type { Data } from "../types";

/**
 * The table, the week strip above it and the small print under it.
 *
 * Which week is on screen and which manager is expanded are this component's
 * own state and nothing else's: the page shell keeps the tab, the payload and
 * the poll, and everything below that belongs to the section that draws it.
 */
export function Leaderboard({ data }: { data: Data }) {
  const [week, setWeek] = useViewState("leaderboard.week", -1);
  const [open, setOpen] = useViewState<string | null>("leaderboard.open", null);

  /* A poll that falls back to the bundled copy can return fewer weeks than the
     one this index was picked against, so never trust it to still be in range. */
  const weekIdx = week >= 0 && week < data.byWeek.length ? week : -1;
  const live = weekIdx < 0;

  const board = useMemo(() => {
    if (weekIdx < 0) return data.standings.map((r) => ({ ...r, delta: 0, live: true }));
    const w = data.byWeek[weekIdx];
    return Object.entries(w.cumulative)
      .map(([manager, c]) => {
        const base = data.standings.find((s) => s.manager === manager)!;
        return { ...base, points: c.points, wins: c.wins, losses: c.losses,
                 delta: w.delta[manager] ?? 0, live: false };
      })
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.manager.localeCompare(b.manager));
  }, [data, weekIdx]);

  /* Weeks appear in byWeek only once they have a played game, so summing them
     covers the season to date - every week already under way - and never the
     ones still ahead. That makes the live pair the sum of the week pairs.
     One week short of a total leaves the season without one either. */
  const scored = data.byWeek.reduce((n, w) => n + w.games, 0);
  const slated = data.byWeek.every((w) => typeof w.scheduled === "number")
    ? data.byWeek.reduce((n, w) => n + (w.scheduled ?? 0), 0)
    : undefined;

  return (
    <>
      <div className="weeks">
        <button className={live ? "on" : ""} onClick={() => setWeek(-1)}>Live</button>
        {data.byWeek.map((w, i) => (
          <button key={w.key} className={weekIdx === i ? "on" : ""} onClick={() => setWeek(i)} title={`${tally(w.games, w.scheduled)} games scored`}>
            {w.seasonType === "postseason" ? `P${w.week}` : w.week}
          </button>
        ))}
      </div>
      {data.byWeek.length > 0 && (
        <p className="asof">
          {live
            ? `Season to date · ${tally(scored, slated)} games scored`
            : `As of ${data.byWeek[weekIdx].label.toLowerCase()} · ${tally(data.byWeek[weekIdx].games, data.byWeek[weekIdx].scheduled)} games scored`}
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th className="r">#</th><th>Manager</th>
            <th className="r">W-L</th>
            {live && data.projection && <th className="r">Proj</th>}
            <th className="r">Pts</th>
            <th className="r">{live ? "Left" : "+/-"}</th><th className="r">Ceil</th>
          </tr>
        </thead>
        <tbody>
          {board.map((r, i) => {
            const isOpen = open === r.manager;
            const teams = Object.values(r.teams).sort((a, b) => b.points - a.points || a.draft.localeCompare(b.draft));
            return [
              <tr key={r.manager} className="row" onClick={() => setOpen(isOpen ? null : r.manager)}>
                <td className="r rank">{i + 1}</td>
                <td className="name">{cap(r.manager)}<span className={`caret ${isOpen ? "up" : ""}`}>›</span></td>
                <td className="r mono">{r.wins}-{r.losses}</td>
                {live && data.projection && (() => {
                  const pr = data.projection!.managers[r.manager];
                  if (!pr) return <td className="r mono muted">-</td>;
                  const dir = pr.rankDelta > 0 ? "up" : pr.rankDelta < 0 ? "down" : "flat";
                  return (
                    <td className="r mono proj">
                      {pr.wins}-{pr.losses}
                      <span
                        className={`arrow ${dir}`}
                        title={dir === "flat"
                          ? "Projected to hold this position"
                          : `Projected to move ${Math.abs(pr.rankDelta)} ${dir}`}
                      >
                        {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}
                      </span>
                    </td>
                  );
                })()}
                <td className="r pts">{r.points}</td>
                <td className="r mono muted">{live ? r.remaining : r.delta > 0 ? `+${r.delta}` : "0"}</td>
                <td className="r mono ceil">{r.ceiling}</td>
              </tr>,
              isOpen && (
                <tr key={r.manager + "-d"} className="detail">
                  <td colSpan={live && data.projection ? 7 : 6}>
                    {teams.map((t) => (
                      <div className="team" key={t.team}>
                        <span className={`tier ${t.tier}`}>{t.tier === "p4" ? 3 : 2}</span>
                        <span className="tn">{t.draft}</span>
                        <span className="mono muted cf">{t.conf}</span>
                        <span className="mono wl">{t.wins}-{t.losses}</span>
                        <span className="mono tp">{t.points}</span>
                      </div>
                    ))}
                    {r.collisionLoss > 0 && (
                      <div className="note">
                        Ceiling docked {r.collisionLoss} for upcoming games between two of your own teams.
                      </div>
                    )}
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>

      <p className="caption">
        {live && data.projection && (
          <>
            Proj is W-L after {data.projection.label.toLowerCase()} if every betting
            favourite wins, and the arrow is where that would move you in the table.
            {data.projection.unprojected > 0 &&
              ` ${data.projection.unprojected} of ${data.projection.games} games have no line and are left out.`}{" "}
          </>
        )}
        Ceiling is current points plus every remaining scheduled game, less any games
        between two of your own teams.{" "}
        {data.postseasonScheduled
          ? "Bowl and playoff games are now scheduled and are included."
          : "Conference championship, bowl and playoff games are not projected. They will raise these numbers once they are scheduled in December."}
      </p>
    </>
  );
}

export const css = `
    .weeks{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
    .weeks button{background:transparent;border:1px solid var(--rule);color:var(--muted);
      border-radius:5px;padding:4px 9px;font-family:ui-monospace,Menlo,monospace;font-size:12px;cursor:pointer}
    .weeks button.on{background:var(--amber);border-color:var(--amber);color:var(--ink);font-weight:700}
    .row{cursor:pointer} .row:hover{background:var(--panel)}
    .name{font-family:Georgia,serif;font-size:17px}
    .caret{color:var(--muted);margin-left:6px;display:inline-block;transition:transform .15s}
    .caret.up{transform:rotate(90deg)}
    .ceil{color:var(--teal)}
    .detail td{background:var(--panel);padding:9px 10px}
    .team{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px}
    .team .tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .team .cf{font-size:10px;width:78px;text-align:right;flex-shrink:0}
    .team .wl{width:30px;text-align:right;flex-shrink:0}
    .team .tp{color:var(--amber);font-weight:700;width:22px;text-align:right;flex-shrink:0}
    .note{margin-top:8px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--rule);padding-top:7px}
    .proj{color:var(--muted);white-space:nowrap}
    /* the projected column makes the leaderboard 7 wide, which overruns a
       375px phone at the default padding. th is shared with the All teams
       table, which is why the rule reads wider than the block it is written
       for; that table's own td padding is class-scoped and wins on
       specificity, so only its header follows this. */
    @media (max-width:430px){
      th{padding-left:2px;padding-right:2px;letter-spacing:.06em}
      td{padding-left:2px;padding-right:2px}
      .name{font-size:15px} .pts{font-size:16px}
      td.mono,.proj{font-size:12px}
      .arrow{margin-left:2px}
    }
    .arrow{margin-left:4px;font-size:9px;vertical-align:1px}
    .arrow.up{color:var(--teal)} .arrow.down{color:var(--red)} .arrow.flat{color:var(--muted);opacity:.6}
`;
