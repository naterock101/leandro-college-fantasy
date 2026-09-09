import { useMemo } from "react";

import { SIGMA } from "../../lib/winprob.mjs";

import { cap, tally } from "../../lib/format.mjs";
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
/**
 * How far above or below expectation earns how much colour.
 *
 * A flat teal-or-red said "ahead" and "behind" and nothing else, so a manager
 * a tenth of a win off the line was painted exactly as loudly as one two wins
 * clear of it - and in a league where most rows sit near expectation most of
 * the time, that is a column of shouting. The steps run from the colour of an
 * ordinary unshaded cell out to the full token, so a row near the line barely
 * separates from the ones either side of it and only a real gap is loud.
 *
 * Three steps rather than a continuous ramp, and hex rather than a computed
 * blend, because these are text colours and text colours on this page get
 * audited: tests/contrast.test.tsx imports this table and checks every shade
 * against both grounds. A colour interpolated at render time would be
 * invisible to that, which is the same reason nothing here uses opacity.
 *
 * The values are --chalk mixed 40%, 70% and 100% of the way to --teal and
 * --red. Lowest is 4.96:1 on --panel, so every step clears AA.
 */
export const EXP_STEPS = {
  /* the gap in wins at which each step starts */
  at: [0.25, 0.75, 1.5],
  hot: ["#A9D7D2", "#79C5B8", "#49B49E"],
  cold: ["#E3B9C5", "#DE91A2", "#D9697F"],
} as const;

/** Which step a gap of `over` wins lands in: 0 is level, 3 is the full token. */
export const expStep = (over: number) =>
  EXP_STEPS.at.reduce((n, at) => (Math.abs(over) >= at ? n + 1 : n), 0);

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

  /* The expected record accumulates exactly the way the real one does: what the
     lines expected of week 1 on week 1, plus what they expected of week 2 on
     week 2, and so on. So it is read out of the same week the rest of the row
     is - the selected week's snapshot, or the last one there is for the live
     board, which by construction is the season to date - rather than from a
     single season-level figure that could only ever be right in one view. */
  const expIdx = live ? data.byWeek.length - 1 : weekIdx;
  const expWeek = data.byWeek[expIdx];
  const expected = expWeek?.cumulative ?? {};
  /* `expectedWins` is checked rather than assumed: it postdates the rest of
     byWeek, so a cached page can meet a week that has cumulative totals and
     none of the expectation, and one manager's undefined would print
     "undefined-undefined" down the column. Hidden outright when nothing in view
     was priced, because a column of 0-0 reads as eight managers who have not
     played rather than as a column with nothing to say. */
  const showExp = Object.values(expected).some(
    (c) => typeof c.expectedWins === "number" && (c.priced ?? 0) > 0
  );
  /* Whether the two records are over the same games, which decides what the
     footnote is allowed to claim. Derived from the rows on screen rather than
     from a season-level count, so it stays true in a week view. */
  const someUnpriced = Object.values(expected).some(
    (c) => c.wins + c.losses > (c.priced ?? 0)
  );
  const showProj = live && Boolean(data.projection);
  /* One count, so the header row and every detail row cannot disagree about
     how wide the table is. Two optional columns is where that starts going
     wrong quietly, with a detail cell one short and the layout only slightly
     off. */
  const cols = 6 + (showProj ? 1 : 0) + (showExp ? 1 : 0);

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
            <th className="r">Pts</th>
            {/* "Act" and "Exp" rather than one bare "W-L" and one qualified
                one: the pair is only readable if both halves are labelled, and
                a reader who sees only "W-L" next to "Exp W-L" will take the
                first for the season and the second for the same games, which
                is the one thing about this pair that is not true. */}
            <th className="r">Act <span className="nb">W-L</span></th>
            {showExp && <th className="r">Exp <span className="nb">W-L*</span></th>}
            {showProj && <th className="r">EoW Proj</th>}
            <th className="r">{live ? "Games left" : "+/-"}</th><th className="r">Ceil</th>
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
                <td className="r pts">{r.points}</td>
                <td className="r mono">{r.wins}-{r.losses}</td>
                {showExp && (() => {
                  const c = expected[r.manager];
                  /* Both halves together, not just the one that gets printed:
                     they ship as a set, so a week carrying one and not the
                     other is a bug rather than a version, and the dash is the
                     right answer to both. It is also what narrows the optional
                     fields for the rest of this cell. */
                  const rec = c && (c.priced ?? 0) > 0 &&
                    typeof c.expectedWins === "number" && typeof c.expectedLosses === "number"
                    ? { wins: c.expectedWins, losses: c.expectedLosses, priced: c.priced ?? 0 }
                    : null;
                  /* Nothing settled and priced for this manager is a dash, not
                     a 0-0: "we cannot say" and "expected to have played
                     nothing" are different sentences and must not print the
                     same. A manager who is not in this week's snapshot at all
                     lands here too. */
                  if (!rec) {
                    return (
                      <td className="r mono dim" title="No settled game of theirs carried a line">-</td>
                    );
                  }
                  /* Above or below the expectation gets a colour, and the
                     colour is never the only carrier - the two records are
                     side by side and a reader can subtract them.

                     Compared against the wins over the *priced* games, which is
                     the only honest comparison and is why the builder publishes
                     that count. It cannot be worked out here: subtracting the
                     unpriced games from Act W-L assumes every one of them was a
                     win, which for a manager on 0-3 with one priced game gives
                     minus two, and paints them the wrong colour by a mile. When
                     a payload predates the count, the comparison is only made
                     where the two records cover the same games - and otherwise
                     left uncoloured rather than guessed. */
                  const played = r.wins + r.losses;
                  const missing = played - rec.priced;
                  const won = typeof c.pricedWins === "number"
                    ? c.pricedWins
                    : missing === 0 ? r.wins : null;
                  const over = won === null ? 0 : won - rec.wins;
                  /* No colour at all when the comparison could not be made,
                     rather than the colour of "dead level" - the cell would be
                     claiming a result it has not got. */
                  const step = won === null ? 0 : expStep(over);
                  const shade = step === 0 ? "" : `${over > 0 ? "hot" : "cold"}${step}`;
                  return (
                    <td
                      className={`r mono exp ${shade}`}
                      title={
                        `The closing lines expected ${rec.wins}-${rec.losses} from the ` +
                        `${rec.priced} settled ${rec.priced === 1 ? "game" : "games"} of theirs that carried one` +
                        (won === null
                          ? ""
                          : `, and they went ${won}-${rec.priced - won} in those`) +
                        (missing > 0
                          ? `. ${missing} more ${missing === 1 ? "was" : "were"} never priced and are in neither column.`
                          : `, which is every game behind their ${r.wins}-${r.losses}.`)
                      }
                    >
                      {rec.wins}-{rec.losses}
                    </td>
                  );
                })()}
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
            EoW Proj is W-L at the end of {data.projection!.label.toLowerCase()} if
            every betting favourite wins, and the arrow is where that would move
            you in the table.
            {data.projection!.unprojected > 0 &&
              ` ${data.projection!.unprojected} of ${data.projection!.games} games have no line and are left out.`}{" "}
          </>
        )}
        {/* Deliberately not a sentence about Act W-L. Both records are now read
            out of the same week, so "Act W-L is every settled game" would be
            true only on the live board and flatly wrong under a week snapshot,
            where it is that week's cumulative record. What the two columns do
            and do not share is the footnote's job, and it says it per view. */}
        Ceiling is current points plus every remaining scheduled game, less any
        games between two of your own teams.{" "}
        {data.postseasonScheduled
          ? "Bowl and playoff games are now scheduled and are included."
          : "Conference championship, bowl and playoff games are not projected. They will raise these numbers once they are scheduled in December."}
      </p>

      {/* A disclosure rather than more paragraph. The line everyone reads stays
          one line; the arithmetic is one click away for whoever wants to argue
          with it, which for a league tiebreaker is eventually someone.
          <details> rather than a hand-rolled toggle: it is keyboard operable,
          it opens on find-in-page, and it costs no state. It sits outside the
          caption because <details> is flow content and a <p> may hold only
          phrasing - nested, the browser silently closes the paragraph first. */}
      {showExp && (
        <details className="howexp">
          <summary>
            {/* The clause that may not go behind the disclosure - and it has to
                be the true one. A column headed "expected" that quietly left
                games out would be the most confident wrong thing on the page;
                a column that announced it had left games out when it had not
                would be the second, and it is the one that is live today,
                because every settled game this season carried a line. So the
                sentence follows `unpriced` rather than asserting the awkward
                case unconditionally. */}
            {/* The chain only reads as a chain when there is more than one
                link in it. "What they expected of week 1, plus week 2, and so
                on to week 1" is what the general sentence says on the first
                week, which is the week this column is most likely to be read
                on for the first time. */}
            *Exp W-L is the record the closing lines expected
            {expIdx === 0
              ? ` of ${expWeek!.label.toLowerCase()}.`
              : `, accumulated: what they expected of ${data.byWeek[0].label.toLowerCase()}, plus every week since, up to ${expWeek!.label.toLowerCase()}.`}{" "}
            {someUnpriced
              ? "A settled game the books never priced is in neither column, so the two do not always count the same games - hover a row for its own denominators."
              : "Every settled game so far carried a line, so it is over exactly the games Act W-L is."}
          </summary>
          <p>
            Every closing line becomes a win probability - roughly, how often a
            team favoured by that much wins. Add those up over a manager&rsquo;s
            settled games and you get the wins the market expected them to have
            by now; the rest of the games are the expected losses. A team
            favoured by 7 is worth about 0.67 of a win, which is why the numbers
            come out in tenths and why nobody is ever expected to be 3-0.
          </p>
          <p>
            The comparison is not a measure of how good your teams are: a
            manager who drafted five heavy favourites is expected to win a lot,
            and winning exactly that many puts them dead level. Running above
            the line means the results have gone your way beyond what was
            priced in. It weighs every game the same, which is what makes it a
            different sentence from the points beside it - a manager can be
            ahead of the market on the record and behind it on the board, by
            winning the cheap games and losing the dear one.
          </p>
          <p>
            The model assumes results scatter about {SIGMA} points either side
            of the spread. That figure is fitted to some 9,600 games rather than
            guessed at, but it is still a model: it says what a favourite laying
            that price does on average, never what yours will do. Each week is
            priced off the lines as they closed, so this is what was expected of
            that week at the time and not a number rewritten with hindsight.
          </p>
        </details>
      )}
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
    /* the projected and expected columns make the leaderboard 8 wide, which
       overruns a 375px phone at the default padding. th is shared with the All teams
       table, which is why the rule reads wider than the block it is written
       for; that table's own td padding is class-scoped and wins on
       specificity, so only its header follows this. */
    @media (max-width:430px){
      th{padding-left:2px;padding-right:2px;letter-spacing:.06em}
      td{padding-left:2px;padding-right:2px}
      .name{font-size:15px} .pts{font-size:16px}
      td.mono,.proj{font-size:12px}
      /* Exp W-L is the widest cell in the table - "9.8-4.2" is seven
         characters where every other numeric column is at most four - and it
         is the one a phone can most afford to shrink, because it is read
         against the column beside it rather than on its own. */
      td.exp{font-size:11px}
      .arrow{margin-left:2px}
    }
    /* Teal for hot and red for cold is the same pairing the spreads use for
       favourite and underdog, and colour is never the only carrier: the sign
       is on the number. */
    /* --dim, not an opacity: tests/contrast.test.tsx fails on any new text
       opacity, because an opacity stacked on a token is invisible to a palette
       audit and that is exactly how these captions came to sit at 2.53:1. */
    .howexp{font-size:11px;line-height:1.5;color:var(--dim);margin:9px 0 0}
    .howexp summary{cursor:pointer;list-style:none}
    /* The marker is replaced rather than hidden: a disclosure with no
       affordance is a paragraph nobody knows to click. */
    .howexp summary::-webkit-details-marker{display:none}
    .howexp summary::after{content:" — how it works";color:var(--muted)}
    .howexp[open] summary::after{content:" — hide"}
    .howexp summary:hover::after{text-decoration:underline}
    .howexp summary:focus-visible{outline:2px solid var(--amber);outline-offset:2px;border-radius:3px}
    .howexp p{margin:8px 0 0;max-width:62ch}
    /* A phone has room for these headers only across two lines, and the line
       they are allowed to break on is the space - "ACT W-" above an orphaned
       "L" is what a hyphen invites and is worse than either label. */
    th .nb{white-space:nowrap}
    .exp{white-space:nowrap}
    /* Generated from EXP_STEPS so the sheet and the class the cell picks
       cannot drift apart, and so the audit has one table to read. An unshaded
       cell keeps the body colour, which is the point: level with expectation
       should look like every other number in the row. */
${EXP_STEPS.hot.map((c, i) => `    .exp.hot${i + 1}{color:${c}}`).join("\n")}
${EXP_STEPS.cold.map((c, i) => `    .exp.cold${i + 1}{color:${c}}`).join("\n")}
    .dim{color:var(--dim)}
    .arrow{margin-left:4px;font-size:9px;vertical-align:1px}
    .arrow.up{color:var(--teal)} .arrow.down{color:var(--red)} .arrow.flat{color:var(--dim)}
    /* The manager cell is a real button now, so it has to be talked back out
       of looking like one. The row stays clickable for a pointer; this is the
       thing a keyboard can reach. */
    .rowtoggle{display:flex;align-items:center;width:100%;background:transparent;border:0;
      padding:0;margin:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
`;
