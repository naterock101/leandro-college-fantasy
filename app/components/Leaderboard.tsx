import { useMemo } from "react";

import { cap, tally } from "../../lib/format.mjs";
import { SIGMA } from "../../lib/winprob.mjs";
import { useViewState } from "../hooks/useViewState";
import type { Data } from "../types";
import { TeamName } from "./TeamName";

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

  /* Luck is a season-to-date number over settled games, so it belongs to the
     live board and to no single week's snapshot. It is also hidden outright
     when the books priced nothing we have settled, because a column of zeroes
     reads as eight managers running exactly to expectation rather than as a
     column with nothing to say. */
  const luck = data.luck && data.luck.games > 0 ? data.luck : null;
  const showLuck = live && luck !== null;
  const showProj = live && Boolean(data.projection);
  /* One count, so the header row and every detail row cannot disagree about
     how wide the table is. Two optional columns is where that starts going
     wrong quietly, with a detail cell one short and the layout only slightly
     off. */
  const cols = 6 + (showProj ? 1 : 0) + (showLuck ? 1 : 0);

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
            {showProj && <th className="r">Proj</th>}
            <th className="r">Pts</th>
            {showLuck && <th className="r">Luck</th>}
            <th className="r">{live ? "Left" : "+/-"}</th><th className="r">Ceil</th>
          </tr>
        </thead>
        <tbody>
          {board.map((r, i) => {
            const isOpen = open === r.manager;
            const detail = `squad-${r.manager}`;
            const toggle = () => setOpen(isOpen ? null : r.manager);
            const teams = Object.values(r.teams).sort((a, b) => b.points - a.points || a.draft.localeCompare(b.draft));
            return [
              /* The row stays clickable, because on a phone the row is the
                 target anyone actually hits. The button inside it is what a
                 keyboard can reach and what says, out loud, that there is
                 something here to open - and the guard is so that pressing it
                 does not also trip the row and toggle twice. */
              <tr key={r.manager} className="row" onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                toggle();
              }}>
                <td className="r rank">{i + 1}</td>
                <td className="name">
                  <button
                    type="button"
                    className="rowtoggle"
                    onClick={toggle}
                    aria-expanded={isOpen}
                    aria-controls={detail}
                  >
                    {cap(r.manager)}
                    <span className={`caret ${isOpen ? "up" : ""}`} aria-hidden="true">›</span>
                  </button>
                </td>
                <td className="r mono">{r.wins}-{r.losses}</td>
                {showProj && (() => {
                  const pr = data.projection!.managers[r.manager];
                  if (!pr) return <td className="r mono muted">-</td>;
                  const dir = pr.rankDelta > 0 ? "up" : pr.rankDelta < 0 ? "down" : "flat";
                  const move = dir === "flat"
                    ? "Projected to hold this position"
                    : `Projected to move ${Math.abs(pr.rankDelta)} ${dir}`;
                  return (
                    <td
                      className="r mono proj"
                      /* The expectation rides in the tooltip rather than taking
                         a column of its own. It is the same week the Proj
                         column is about, so it belongs on that cell, and the
                         table is already as wide as a phone will take. */
                      title={typeof pr.expectedGained === "number"
                        ? `${move}. Weighted by the lines rather than handing every game to the favourite: ${pr.expectedGained} points, for ${pr.expectedPoints} in all.`
                        : move}
                    >
                      {pr.wins}-{pr.losses}
                      <span className={`arrow ${dir}`} title={move}>
                        {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}
                      </span>
                    </td>
                  );
                })()}
                <td className="r pts">{r.points}</td>
                {showLuck && (() => {
                  const lk = luck!.managers[r.manager];
                  /* Nothing settled and priced for this manager is a dash, not
                     a nought: "we cannot say" and "dead on expectation" are
                     different sentences and must not print the same. */
                  if (!lk || !lk.games) {
                    return <td className="r mono dim" title="No settled game of theirs was priced">-</td>;
                  }
                  return (
                    <td
                      className={`r mono luck ${lk.delta > 0 ? "hot" : lk.delta < 0 ? "cold" : ""}`}
                      title={`${lk.actual} points banked from ${lk.games} priced games, against ${lk.expected} expected`}
                    >
                      {lk.delta > 0 ? `+${lk.delta}` : lk.delta}
                    </td>
                  );
                })()}
                <td className="r mono muted">{live ? r.remaining : r.delta > 0 ? `+${r.delta}` : "0"}</td>
                <td className="r mono ceil">{r.ceiling}</td>
              </tr>,
              isOpen && (
                <tr key={r.manager + "-d"} className="detail">
                  <td colSpan={cols} id={detail}>
                    {teams.map((t) => (
                      <div className="team" key={t.team}>
                        <span className={`tier ${t.tier}`}>{t.tier === "p4" ? 3 : 2}</span>
                        <TeamName team={t.team} label={t.draft} className="tn" />
                        <span className="mono muted cf">{t.conf}</span>
                        <span className="mono wl">{t.wins}-{t.losses}</span>
                        <span className="mono tp">{t.points}</span>
                      </div>
                    ))}
                    {/* Zero is not "expected nothing", it is "has no priced game
                        this week", and a line reading "+0 points, for 10 in all"
                        says the second thing in the words of the first. */}
                    {showProj && (data.projection!.managers[r.manager]?.expectedGained ?? 0) > 0 && (
                      /* Expected points, spelled out where there is room for a
                         sentence. The naive projection above hands every game
                         to the favourite; this weights each by the chance the
                         line gives it, which is most of what the line actually
                         says. */
                      <div className="note">
                        {data.projection!.label} expectation:{" "}
                        <b>+{data.projection!.managers[r.manager].expectedGained}</b>{" "}
                        points from the current lines, for{" "}
                        {data.projection!.managers[r.manager].expectedPoints} in all.
                      </div>
                    )}
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
        {showProj && (
          <>
            Proj is W-L after {data.projection!.label.toLowerCase()} if every betting
            favourite wins, and the arrow is where that would move you in the table.
            {data.projection!.unprojected > 0 &&
              ` ${data.projection!.unprojected} of ${data.projection!.games} games have no line and are left out.`}{" "}
          </>
        )}
        {showLuck && (
          <>
            Luck is points banked less points the closing lines expected, over the{" "}
            {luck!.games} settled {luck!.games === 1 ? "game" : "games"} that had one;
            positive means running hot.
            {/* Not a footnote. A luck number that quietly left out half the
                season would be the most confident wrong figure on the page,
                so the denominator is in the same sentence as the number. */}
            {luck!.unpriced > 0 &&
              ` ${luck!.unpriced} settled ${luck!.unpriced === 1 ? "game" : "games"} were never priced and count toward neither side of it.`}{" "}
            It assumes results land about {SIGMA} points either side of the
            spread, which is an assumption and not a measurement.{" "}
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
    /* the projected and luck columns make the leaderboard 8 wide, which
       overruns a 375px phone at the default padding. th is shared with the All teams
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
    /* Teal for hot and red for cold is the same pairing the spreads use for
       favourite and underdog, and colour is never the only carrier: the sign
       is on the number. */
    .luck{white-space:nowrap}
    .luck.hot{color:var(--teal)} .luck.cold{color:var(--red)}
    .dim{color:var(--dim)}
    .arrow{margin-left:4px;font-size:9px;vertical-align:1px}
    .arrow.up{color:var(--teal)} .arrow.down{color:var(--red)} .arrow.flat{color:var(--dim)}
    /* The manager cell is a real button now, so it has to be talked back out
       of looking like one. The row stays clickable for a pointer; this is the
       thing a keyboard can reach. */
    .rowtoggle{display:flex;align-items:center;width:100%;background:transparent;border:0;
      padding:0;margin:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
`;
