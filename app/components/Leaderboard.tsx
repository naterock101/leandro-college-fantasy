import { useMemo } from "react";

import { favouriteProbability, SIGMA } from "../../lib/winprob.mjs";

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

/**
 * Which step a gap of `over` lands in: 0 is level, 3 is the full token.
 *
 * `per` is what one win is worth in the unit being compared, so the same three
 * judgements about how big a gap has to be before it is worth shouting about
 * serve both expectations. In wins it is 1 and the thresholds are the ones
 * above; in points it is `PER_WIN`.
 */
export const expStep = (over: number, per = 1) =>
  EXP_STEPS.at.reduce((n, at) => (Math.abs(over) >= at * per ? n + 1 : n), 0);

/**
 * What a win is worth on average, for scaling the steps into points.
 *
 * A win pays 3 for a power-conference team and 2 otherwise, and every roster
 * is four of the first and six of the second - so a win averages 2.4 points,
 * exactly, for every manager in the league. Scaling by it rather than picking
 * three new numbers keeps one judgement in one place: a gap that is a shade
 * off the line in wins is a shade off the line in points too.
 */
export const PER_WIN = 2.4;

/** The class for a gap of `over`, in a unit where a win is worth `per`. */
const shadeOf = (over: number | null, per = 1) => {
  /* No colour at all when the comparison could not be made, rather than the
     colour of "dead level" - the cell would be claiming a result it has not
     got. */
  const step = over === null ? 0 : expStep(over, per);
  return step === 0 ? "" : `${(over as number) > 0 ? "hot" : "cold"}${step}`;
};

/** One manager's running totals at the end of the week on screen. */
type Cume = Data["byWeek"][number]["cumulative"][string];

/** The same, plus the whole-week figures a week entry also carries. */
type Exp = Cume & Partial<NonNullable<Data["byWeek"][number]["weekly"]>[string]>;

/**
 * The expectation this view is showing, in one shape.
 *
 * Two of them exist and the difference is which games they cover. The settled
 * one covers the games that have been played, which is what the points beside
 * it can honestly be set against - that is the comparison the colour is about.
 * The slate one covers every game of theirs in the week, played or not, which
 * is the only one that can answer what a week in flight is worth: week 2 with
 * one game scored had a 3 in this column for the manager who played it and a
 * dash for the other seven, beside ceilings of 24.
 *
 * A finished week and the live board read the settled one, because there every
 * game the expectation covers has been played and the two are the same number
 * anyway. A week still being played reads the slate, and `compare` is false
 * there: setting 0 points banked against 17.9 expected of a week that has not
 * happened would paint every row in the league deep red.
 */
const shownExp = (c: Exp, slate: boolean) =>
  slate
    ? { points: c.slateExpectedPoints, wins: c.slateExpectedWins,
        losses: c.slateExpectedLosses, priced: c.slatePriced ?? 0,
        games: c.slateGames ?? 0, compare: false }
    : { points: c.expectedPoints, wins: c.expectedWins, losses: c.expectedLosses,
        priced: c.priced ?? 0, games: c.wins + c.losses, compare: true };

/**
 * What a manager actually took from the games their expectation covers.
 *
 * The comparison has to be like for like, which is why the builder publishes
 * these two counts: an expectation over the priced games can only be set
 * against the wins and the points from *those* games. Neither can be worked
 * out here - taking the unpriced games off the season record assumes every one
 * of them was a win, which for a manager on 0-3 with one priced game gives
 * minus two and paints them the wrong colour by a mile.
 *
 * A payload written before either count existed is still compared where
 * nothing was left out, and otherwise left uncompared rather than guessed at.
 */
const settled = (c: Cume, r: { wins: number; losses: number; points: number }) => {
  const missing = r.wins + r.losses - (c.priced ?? 0);
  return {
    missing,
    wins: typeof c.pricedWins === "number" ? c.pricedWins : missing === 0 ? r.wins : null,
    points: typeof c.pricedPoints === "number" ? c.pricedPoints
      : missing === 0 ? r.points : null,
  };
};

/**
 * The games the projection could not reach, and how many there are.
 *
 * Only one kind of game is missing from a weighted projection: one nothing
 * would price. A pick-em is not - the books priced it and called it even, and
 * a game worth half its points to each side is a game in the total. That was
 * not true of the naive projection, which skipped a pick-em for having no
 * favourite to hand, and the sentence here used to have to say which of the
 * two had happened.
 *
 * `unpriced` is optional. A payload without it has only `unprojected`, which
 * counts by the naive rule and so may include pick-ems this projection did
 * use; that payload gets the vaguer sentence rather than a precise wrong one.
 */
/**
 * How many games the projection *on screen* could not reach.
 *
 * Which count that is depends on which projection is being shown, and the two
 * differ by the pick-ems: the weighted one uses them at half a win a side and
 * so is only ever missing a game nothing would price, while the naive one
 * skips them for having no favourite to hand. Reading `unpriced` under a naive
 * fallback would under-report by exactly the pick-ems that fallback dropped.
 */
const left = (p: Data["projection"] & object, weighted: boolean) =>
  weighted && typeof p.unpriced === "number" ? p.unpriced : p.unprojected;

const leftOut = (p: Data["projection"] & object, weighted: boolean) => {
  /* One game left out is a real week - it is the commonest case there is - so
     the verbs agree with the count rather than being written for the plural
     and left to read as broken English the first time it is 1. */
  const n = (count: number) => ({
    of: `${count} of ${p.games} games`,
    is: count === 1 ? "is" : "are",
    has: count === 1 ? "has" : "have",
  });

  if (!weighted || typeof p.unpriced !== "number") {
    const w = n(p.unprojected);
    return `${w.of} could not be projected and ${w.is} left out.`;
  }
  const w = n(p.unpriced);
  return `${w.of} ${w.has} no line at all and ${w.is} left out.`;
};

/**
 * The projection the page shows, and the rank that belongs to it.
 *
 * The weighted one - every game worth the chance its line gives it - because
 * it is the better answer and because showing both invited the obvious
 * question: a manager favoured in nine games of ten saw 33 in the column and
 * 29.7 in his own dropdown, with nothing on the page linking them. The naive
 * projection stays in the payload for a browser holding cached JS and is read
 * here only when the weighted one is missing, which is a snapshot written
 * before it shipped.
 *
 * Every figure comes from the same projection or none of them does. They were
 * five separate checks for a while - the column, its arrow, its tooltip, the
 * record in the dropdown and the note under it each deciding for themselves -
 * and five checks over one payload is five chances to show half of each: a
 * weighted record under a naive column is the exact split this replaced.
 */
const proj = (pr: NonNullable<Data["projection"]>["managers"][string]) =>
  typeof pr.expectedPoints === "number" && typeof pr.expectedRankDelta === "number"
    && typeof pr.expectedGained === "number" && typeof pr.expectedWins === "number"
    && typeof pr.expectedLosses === "number"
    ? { points: pr.expectedPoints, rankDelta: pr.expectedRankDelta,
        gained: pr.expectedGained, wins: pr.expectedWins, losses: pr.expectedLosses,
        weighted: true }
    : { points: pr.points, rankDelta: pr.rankDelta, gained: pr.gained,
        wins: pr.wins, losses: pr.losses, weighted: false };

/** The tail of an expectation tooltip: what else, if anything, it left out. */
const denominator = (missing: number, whole: string) =>
  missing > 0
    ? `. ${missing} more ${missing === 1 ? "was never priced and is" : "were never priced and are"} in neither column.`
    : `, which is every game behind their ${whole}.`;

/**
 * A two-word column heading, stacked - the qualifier over the unit.
 *
 * Left to wrap on its own, whether a heading took one line or two depended on
 * how much room the table happened to have, so at some widths "ACT" sat above
 * "W-L" while "EXP W-L*" beside it stayed on one line, and the row read as a
 * mistake. Stacking them all makes the header row the same shape everywhere,
 * and buys the manager column the width the numeric ones give up.
 *
 * A block span rather than a `<br>`, and a real space between the two, so the
 * heading is still one accessible name - "Act W-L", not "ActW-L" and not two
 * headings.
 */
const Stack = ({ over, under }: { over: string; under: string }) => (
  <>
    <span className="hl">{over}</span>{" "}{under}
  </>
);

export function Leaderboard({ data }: { data: Data }) {
  const [week, setWeek] = useViewState("leaderboard.week", -1);
  const [open, setOpen] = useViewState<string | null>("leaderboard.open", null);

  /* A poll that falls back to the bundled copy can return fewer weeks than the
     one this index was picked against, so never trust it to still be in range. */
  const weekIdx = week >= 0 && week < data.byWeek.length ? week : -1;
  const live = weekIdx < 0;

  /* The selected week's own figures, when the payload carries them. A week
     view used to be the season cut short at that week - running totals down
     every column and a season ceiling beside them - so week 2 of a manager
     with one game played read 24 points and a ceiling of 282, neither of
     which is anything about week 2. Every column in this view is now the week
     and nothing else.

     A payload written before `weekly` shipped has none, and the view falls
     back to the running totals it has always shown rather than to blanks.

     All of it or none of it, and the board below reads this rather than the
     raw field. A block covering some managers and not others would sort a
     week's points against a season's in one table, with a season ceiling in
     half the rows and a week's in the other half - which is the mixed row
     this change exists to remove, put back one payload deeper. */
  const weekly = useMemo(() => {
    if (weekIdx < 0) return undefined;
    const w = data.byWeek[weekIdx];
    const k = w?.weekly;
    if (!k) return undefined;
    const names = Object.keys(w.cumulative);
    return names.length > 0 && names.every((m) => k[m]) ? k : undefined;
  }, [data, weekIdx]);

  const board = useMemo(() => {
    if (weekIdx < 0) return data.standings.map((r) => ({ ...r, delta: 0, live: true }));
    const w = data.byWeek[weekIdx];
    return Object.entries(w.cumulative)
      .map(([manager, c]) => {
        const base = data.standings.find((s) => s.manager === manager)!;
        const k = weekly?.[manager];
        /* Taken as a set or not at all. A week's points under a season
           ceiling is the mixed row this replaced, one column deeper. */
        return k
          ? { ...base, points: k.points, wins: k.wins, losses: k.losses,
              remaining: k.remaining, ceiling: k.ceiling,
              collisionLoss: k.collisionLoss, delta: k.points, live: false }
          : { ...base, points: c.points, wins: c.wins, losses: c.losses,
              delta: w.delta[manager] ?? 0, live: false };
      })
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.manager.localeCompare(b.manager));
  }, [data, weekIdx, weekly]);

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
  /* The live board accumulates, so it reads the running expectation out of
     the last week there is. A week view reads that week's own, so the
     expectation covers exactly the games the points beside it do. */
  const expected: Record<string, Exp> =
    (live ? expWeek?.cumulative : weekly ?? expWeek?.cumulative) ?? {};

  /* A week with nothing left to play has no headroom to report: every ceiling
     in it is the points beside it and every "games left" is 0, which is two
     columns saying nothing in the words of something. They go, the same way
     the expectation goes when no game in view was priced. The live board and
     the fallback week view keep theirs - neither is ever finished. */
  const weekOver = Boolean(weekly) && Object.values(weekly!).every((k) => k.remaining === 0);
  /* Whether this view shows the whole week's expectation rather than the part
     of it that has been played. Only a week still being played does, and only
     when the payload carries the figures for every manager in it - the same
     all-or-nothing rule `weekly` itself follows, and for the same reason: half
     a column on one definition and half on another is a column nobody can
     read. A finished week does not need them; there the two are one number. */
  const slate = Boolean(weekly) && !weekOver &&
    Object.values(weekly!).every((k) => typeof k.slateExpectedPoints === "number");
  /** The expectation on screen for one manager: settled, or the whole week. */
  const expOf = (c: Exp) => shownExp(c, slate);

  /* `expectedWins` is checked rather than assumed: it postdates the rest of
     byWeek, so a cached page can meet a week that has cumulative totals and
     none of the expectation, and one manager's undefined would print
     "undefined-undefined" down the column. Hidden outright when nothing in view
     was priced, because a column of 0-0 reads as eight managers who have not
     played rather than as a column with nothing to say. */
  const showExp = Object.values(expected).some(
    (c) => typeof expOf(c).wins === "number" && expOf(c).priced > 0
  );
  /* Checked separately from the record, and against its own field, because the
     two pairs shipped one after the other: a cached page can meet a week that
     carries the expected record and none of the expected points. */
  const showExpPts = Object.values(expected).some(
    (c) => typeof expOf(c).points === "number" && expOf(c).priced > 0
  );
  /* Whether the expectation covers every game it could have, which decides
     what the footnote is allowed to claim. Derived from the rows on screen
     rather than from a season-level count so it stays true in a week view, and
     against the slate's own denominator when the slate is what is drawn. */
  const someUnpriced = Object.values(expected).some((c) => {
    const e = expOf(c);
    return e.games > e.priced;
  });
  const showProj = live && Boolean(data.projection);
  /* Whether every row on screen is showing the weighted projection, which is
     what the caption is describing. `every` rather than `some`: a payload that
     somehow carried the weighted fields for only some managers would have rows
     falling back individually, and the caption would then be right about some
     of them. The conservative sentence is right about all of them. */
  const weighted = showProj &&
    Object.values(data.projection!.managers).every((p) => proj(p).weighted);
  /* One count, so the header row and every detail row cannot disagree about
     how wide the table is. Two optional columns is where that starts going
     wrong quietly, with a detail cell one short and the layout only slightly
     off. */
  const cols = 3 + (showProj ? 1 : 0) + (showExpPts ? 1 : 0) + (weekOver ? 0 : 2);

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
            /* "As of week 2" was the running-total sentence and stops being
               true the moment the columns under it are the week's own. */
            : `${weekly ? `${data.byWeek[weekIdx].label} only` : `As of ${data.byWeek[weekIdx].label.toLowerCase()}`} · ${tally(data.byWeek[weekIdx].games, data.byWeek[weekIdx].scheduled)} games scored`}
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th className="num">#</th><th>Manager</th>
            {/* Points, then what was expected of them and what they project
                to - and the three records those belong to are one tap away in
                the manager's own row.

                The board is a points league, and it was showing one column of
                points and three of W-L - so the two numbers a reader most
                wants to set against each other, what a manager has scored and
                what the market said they would have scored by now, were the
                two that were never side by side. The records are not gone;
                they are together in the dropdown, where the phone this is read
                on has a whole line to give them rather than four characters. */}
            <th className="num">Pts</th>
            {showExpPts && <th className="num"><Stack over="Exp" under="Pts*" /></th>}
            {showProj && <th className="num"><Stack over="EoW" under="Proj" /></th>}
            {!weekOver && (
              <th className="num">
                {/* +/- was the week's points, which is what Pts is in this view
                    now - a column repeating the one three cells to its left.
                    What it has to say instead is the same thing the live board
                    says here: how much of the week is still to be played, which
                    is what the ceiling beside it is built out of. */}
                {live || weekly ? <Stack over="Games" under="left" /> : "+/-"}
              </th>
            )}
            {!weekOver && <th className="num">Ceil</th>}
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
                <td className="num rank">{i + 1}</td>
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
                <td className="num pts">{r.points}</td>
                {showExpPts && (() => {
                  const c = expected[r.manager];
                  const e = c && expOf(c);
                  /* Nothing priced for this manager is a dash, not a 0: "we
                     cannot say" and "expected to score nothing" are different
                     sentences and must not print the same. A manager who is
                     not in this week's snapshot at all lands here too, as does
                     a week that carries the expected record and not yet the
                     expected points. */
                  if (!e || e.priced === 0 || typeof e.points !== "number") {
                    return (
                      <td className="num mono dim" title={slate
                        ? "No game of theirs this week carries a line"
                        : "No settled game of theirs carried a line"}>-</td>
                    );
                  }
                  const exp = e.points;
                  /* Set against the points banked over the *priced* games,
                     never against the season total: the two would be a
                     comparison of different slates, and the manager whose
                     unpriced game was a win would be flattered by exactly what
                     the model never saw.

                     And not set against anything at all while the week is
                     still being played - `compare` is false there. Most of
                     what that expectation covers has not happened, so the gap
                     is not luck, it is the calendar, and colouring it would
                     paint the whole league red every Thursday. */
                  const { missing, points } = settled(c, r);
                  const over = !e.compare || points === null ? null : points - exp;
                  return (
                    <td
                      className={`num mono exp ${shadeOf(over, PER_WIN)}`}
                      title={e.compare
                        ? `The closing lines expected ${exp} points from the ` +
                          `${e.priced} settled ${e.priced === 1 ? "game" : "games"} of theirs that carried one` +
                          (points === null ? "" : `, and they banked ${points}`) +
                          denominator(missing, `${r.points} points`)
                        : `The lines expect ${exp} points from ${e.priced === e.games ? "all " : ""}${e.priced} of their ${e.games} games this week` +
                          (e.priced === e.games ? "" : ` - the rest carry no line and are left out`) +
                          `. ${r.points} of it ${r.points === 1 ? "is" : "are"} already banked.`}
                    >
                      {exp}
                    </td>
                  );
                })()}
                {showProj && (() => {
                  const pr = data.projection!.managers[r.manager];
                  if (!pr) return <td className="num mono muted">-</td>;
                  /* The weighted projection, and the rank that goes with it.
                     They are read as a pair or not at all: an arrow taken from
                     one projection under a number taken from the other is two
                     answers to one question, usually agreeing and never
                     explicably. A payload predating either falls back to the
                     naive pair, which is what it has. */
                  const p = proj(pr);
                  const dir = p.rankDelta > 0 ? "up" : p.rankDelta < 0 ? "down" : "flat";
                  const move = dir === "flat"
                    ? "Projected to hold this position"
                    : `Projected to move ${Math.abs(p.rankDelta)} ${dir}`;
                  return (
                    <td
                      className="num mono proj"
                      /* `gained` comes out of the same branch the points do,
                         so the tooltip cannot describe one projection while
                         the cell shows the other - and cannot print
                         "undefined points" off a payload carrying some of the
                         weighted fields and not others. */
                      title={p.weighted
                        ? `${move}. Every game in the week is worth the chance its line gives it, rather than handed whole to the favourite: ${p.gained} points on top of the ${r.points} banked.`
                        : `${move}. Every betting favourite winning puts ${p.gained} points on top of the ${r.points} banked.`}
                    >
                      {p.points}
                      <span className={`arrow ${dir}`} title={move}>
                        {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}
                      </span>
                    </td>
                  );
                })()}
                {!weekOver && (
                  <td className="num mono muted">
                    {live || weekly ? r.remaining : r.delta > 0 ? `+${r.delta}` : "0"}
                  </td>
                )}
                {!weekOver && <td className="num mono ceil">{r.ceiling}</td>}
              </tr>,
              isOpen && (
                <tr key={r.manager + "-d"} className="detail">
                  <td colSpan={cols} id={detail}>
                    {/* The three records, on the line the phone can spare for
                        them. Squeezed into the table each one had four
                        characters and a two-line heading; here each has a word
                        saying what it is, and the pair that used to be read by
                        subtracting one column from the next sits next to what
                        it is a record of. */}
                    <div className="recs">
                      <span className="rec">
                        <span className="rl">Record</span>
                        <span className="mono rv">{r.wins}-{r.losses}</span>
                      </span>
                      {showExp && (() => {
                        const c = expected[r.manager];
                        const e = c && expOf(c);
                        /* Both halves together, not just the one that gets
                           printed: they ship as a set, so a week carrying one
                           and not the other is a bug rather than a version,
                           and the dash is the right answer to both. */
                        if (!e || e.priced === 0 ||
                            typeof e.wins !== "number" ||
                            typeof e.losses !== "number") {
                          return (
                            <span className="rec" title={slate
                              ? "No game of theirs this week carries a line"
                              : "No settled game of theirs carried a line"}>
                              <span className="rl">Expected</span>
                              <span className="mono rv dim">-</span>
                            </span>
                          );
                        }
                        const { missing, wins } = settled(c, r);
                        /* Uncoloured while the week is still being played, for
                           the reason the points column is: a record over games
                           that have not happened has nothing to be above or
                           below yet. */
                        const over = !e.compare || wins === null ? null : wins - e.wins;
                        return (
                          <span
                            className="rec"
                            title={e.compare
                              ? `The closing lines expected ${e.wins}-${e.losses} from the ` +
                                `${e.priced} settled ${e.priced === 1 ? "game" : "games"} of theirs that carried one` +
                                (wins === null ? "" : `, and they went ${wins}-${e.priced - wins} in those`) +
                                denominator(missing, `${r.wins}-${r.losses}`)
                              : `The lines expect ${e.wins}-${e.losses} from ${e.priced === e.games ? "all " : ""}${e.priced} of their ${e.games} games this week.`}
                          >
                            <span className="rl">Expected</span>
                            <span className={`mono rv exp ${shadeOf(over)}`}>
                              {e.wins}-{e.losses}
                            </span>
                          </span>
                        );
                      })()}
                      {showProj && (() => {
                        const pr = data.projection!.managers[r.manager];
                        if (!pr) return null;
                        /* The same projection the column shows, in the same
                           unit the two records beside it are in. It comes out
                           in tenths for the reason Expected does: a game is
                           worth the chance it is won, and nobody is ever
                           expected to be exactly 13-8. */
                        const p = proj(pr);
                        return (
                          <span
                            className="rec"
                            title={p.weighted
                              ? `Their record at the end of ${data.projection!.label.toLowerCase()}, every game weighted by the chance its line gives it`
                              : `Their record at the end of ${data.projection!.label.toLowerCase()} if every betting favourite wins`}
                          >
                            <span className="rl">{data.projection!.label} proj</span>
                            <span className="mono rv">{p.wins}-{p.losses}</span>
                          </span>
                        );
                      })()}
                    </div>
                    {/* The one thing in this view that is still a season
                        figure, said out loud rather than left to look like
                        the week. Per-team weekly records are not in the
                        payload and would not be worth what they cost: byWeek
                        is refetched by every open tab every two minutes, and
                        ten teams a manager a week is the sort of growth term
                        the lazy split exists to keep off that path. */}
                    {weekly && (
                      <div className="note pre">
                        Squad records below are the season&rsquo;s, not this week&rsquo;s.
                      </div>
                    )}
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
                        this week", and a line reading "+0 points" says the
                        second thing in the words of the first. */}
                    {showProj && (() => {
                      const pr = data.projection!.managers[r.manager];
                      /* Read through the same decision as everything else, so
                         a payload that fell back to the naive projection above
                         cannot be explained here by a weighted sum. */
                      const p = pr ? proj(pr) : null;
                      if (!p || !p.weighted || p.gained <= 0) return null;
                      return (
                        /* What the column beside their name is made of, rather
                           than a second number to set against it. It used to
                           end "for 29.7 in all" under a column reading 33, and
                           the two were the naive projection and this one with
                           nothing on the page connecting them. The total is
                           the column now, so this says where it came from. */
                        <div className="note">
                          {data.projection!.label} projection:{" "}
                          <b>+{p.gained}</b> points on top of the{" "}
                          {r.points} banked, every game worth the chance{" "}
                          {/* Per manager, not per league. This sum only ever
                              contains what is on their own slate, and shown to
                              a manager whose ten games all carry lines it named
                              a source that contributed nothing to their
                              figure. */}
                          {(pr.modelled ?? 0) > 0
                            ? `its line gives it - and for ${pr.modelled === 1 ? "one game" : `${pr.modelled} games`} no book would price, the chance ESPN's model gives it.`
                            : "its line gives it."}
                        </div>
                      );
                    })()}
                    {r.collisionLoss > 0 && (
                      <div className="note">
                        Ceiling docked {r.collisionLoss} for {weekly ? "games this week" : "upcoming games"} between two of your own teams.
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
            EoW Proj is your points at the end of{" "}
            {data.projection!.label.toLowerCase()}, with every game worth the
            chance its line gives it rather than handed whole to the favourite
            - so a coin-flip is worth half its points and an underdog is worth
            something. The arrow is where that would move you in the table, and
            the record behind it is in your own row.
            {left(data.projection!, weighted) > 0 &&
              ` ${leftOut(data.projection!, weighted)}`}
            {(data.projection!.modelled ?? 0) > 0 &&
              /* Said whenever it happens, unlike the games that were left out
                 - this is a number in the column rather than one missing from
                 it, and a reader comparing two managers is entitled to know
                 that one of them is being carried by a forecast. */
              ` ${data.projection!.modelled} ${data.projection!.modelled === 1
                ? "game had no line at all and is projected from"
                : "games had no line at all and are projected from"} ESPN's model instead.`}{" "}
          </>
        )}
        {/* Deliberately not a sentence about Pts. Both columns are read out of
            the same week, so "Pts is every settled game" would be true only on
            the live board and flatly wrong under a week snapshot, where it is
            that week's cumulative total. What the two columns do and do not
            share is the footnote's job, and it says it per view. */}
        {weekly ? (
          <>
            Every column is {expWeek!.label.toLowerCase()} alone, not the season
            to date.{" "}
            {weekOver
              ? "The week is played out, so there is no ceiling left to quote."
              : "Ceiling is the points banked in the week plus every game of yours still to be played in it, less any games between two of your own teams - so a bye week tops out at what is already on the board."}
          </>
        ) : (
          <>
            Ceiling is current points plus every remaining scheduled game, less
            any games between two of your own teams.{" "}
            {data.postseasonScheduled
              ? "Bowl and playoff games are now scheduled and are included."
              : "Conference championship, bowl and playoff games are not projected. They will raise these numbers once they are scheduled in December."}
          </>
        )}
      </p>

      {/* A disclosure rather than more paragraph. The line everyone reads stays
          one line; the arithmetic is one click away for whoever wants to argue
          with it, which for a league tiebreaker is eventually someone.
          <details> rather than a hand-rolled toggle: it is keyboard operable,
          it opens on find-in-page, and it costs no state. It sits outside the
          caption because <details> is flow content and a <p> may hold only
          phrasing - nested, the browser silently closes the paragraph first. */}
      {showExpPts && (
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
            {/* Three sentences, one per thing this column can be. A week
                still being played is the one that is not a comparison: it is
                a forecast of the whole week, most of which has not happened,
                and it says so rather than being set beside Pts as though the
                two counted the same games. */}
            {slate ? (
              <>
                *Exp Pts is the points the closing lines expect of{" "}
                {expWeek!.label.toLowerCase()} - every game of yours in it,
                played or not, so it is what the week is worth rather than what
                is banked so far. Pts is the part of it already won, which is
                why the two are not coloured against each other until the week
                is done.{" "}
                {someUnpriced
                  ? "Some games of the week carry no line at all and are left out - hover a row for its own denominator."
                  : "Every game of the week carries a line, so none of it is left out."}
              </>
            ) : (
              <>
                *Exp Pts is the points the closing lines expected
                {weekly || expIdx === 0
                  ? ` of ${expWeek!.label.toLowerCase()}${weekly && expIdx > 0 ? " alone" : ""}.`
                  : `, accumulated: what they expected of ${data.byWeek[0].label.toLowerCase()}, plus every week since, up to ${expWeek!.label.toLowerCase()}.`}{" "}
                {someUnpriced
                  ? "A settled game the books never priced is in neither column, so the two do not always count the same games - hover a row for its own denominators."
                  : `Every settled game ${weekly ? "in the week" : "so far"} carried a line, so it is over exactly the games Pts is.`}
              </>
            )}
          </summary>
          <p>
            Every closing line becomes a win probability - roughly, how often a
            team favoured by that much wins - and each one is then worth what
            the win itself would have paid, 3 points for a power-conference team
            and 2 for the rest. Add those up over a manager&rsquo;s settled
            games and you get the points the market expected them to have banked
            by now. A team favoured by 7 wins about{" "}
            {/* Derived, not restated. This read "about 0.67 of a win" until
                sigma was refitted from 16 to 14.4 and quietly made it wrong by
                two points, while Games of the week went on printing 69% for
                the same line. A worked example of the model has to come out of
                the model. */}
            {favouriteProbability(7).toFixed(2)} of the time, so a
            power-conference team laying that price is worth about{" "}
            {(favouriteProbability(7) * 3).toFixed(2)} of its 3 points - which
            is why the numbers come out in tenths and why nobody is ever
            expected to be on a round number.
          </p>
          <p>
            The comparison is not a measure of how good your teams are: a
            manager who drafted five heavy favourites is expected to score a
            lot, and scoring exactly that much puts them dead level. Running
            above the line means the results have gone your way beyond what was
            priced in. The expected record in each manager&rsquo;s row is the
            same sum without the weighting - there a win is a win - which is
            what lets the two disagree: a manager can be ahead of the market on
            the record and behind it on the board, by winning the cheap games
            and losing the dear one.
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
    /* The three records, on their own line above the squad, where each gets a
       word saying what it is instead of a two-line abbreviation.
       Wrapping rather than three fixed columns: "Week 2 proj 15-7" is half
       again the width of the other two, and a phone that cannot fit all three
       should drop one to the next line rather than push anything off the right
       edge - which is the failure that moved them out of the table. */
    .recs{display:flex;flex-wrap:wrap;gap:5px 16px;padding-bottom:8px;margin-bottom:5px;
      border-bottom:1px solid var(--rule)}
    .rec{display:flex;align-items:baseline;gap:6px}
    /* the same treatment the column headings get, because it is the same job */
    .rl{font-family:ui-monospace,Menlo,monospace;font-size:9px;letter-spacing:.12em;
      text-transform:uppercase;color:var(--muted)}
    .rv{font-size:13px}
    .team{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px}
    .team .tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .team .cf{font-size:10px;width:78px;text-align:right;flex-shrink:0}
    .team .wl{width:30px;text-align:right;flex-shrink:0}
    .team .tp{color:var(--amber);font-weight:700;width:22px;text-align:right;flex-shrink:0}
    .note{margin-top:8px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--rule);padding-top:7px}
    /* The same small print, above what it is about rather than below it: the
       rule belongs under the sentence here, not over it. */
    .note.pre{margin-top:0;padding-top:0;border-top:0;padding-bottom:7px;
      border-bottom:1px solid var(--rule);margin-bottom:5px}
    .proj{color:var(--muted);white-space:nowrap}
    /* the projected and expected columns make the leaderboard 7 wide, which
       overruns a 375px phone at the default padding. th is shared with the All teams
       table, which is why the rule reads wider than the block it is written
       for; that table's own td padding is class-scoped and wins on
       specificity, so only its header follows this. */
    @media (max-width:430px){
      th{padding-left:2px;padding-right:2px;letter-spacing:.06em}
      td{padding-left:2px;padding-right:2px}
      .name{font-size:15px} .pts{font-size:16px}
      td.mono,.proj{font-size:12px}
      /* The rule above cannot reach these: .detail td sets its own padding and
         is one class more specific, which is the same miss that had the All
         teams table 27px over a phone - and here it was pushing a squad's
         points off the right-hand edge. */
      .detail td{padding-left:4px;padding-right:4px}
      /* The conference is the one part of a squad row that can give ground:
         it is a label rather than a number, and it does not have to line up
         with anything. */
      .team .cf{width:60px}
      /* And the school lets go of its single line here, which is the rule the
         whole dropdown was hanging off. A cell may not be narrower than its
         contents can go, and a nowrap name says "Northern Illinois Huskies"
         cannot go below its full width - so the detail row, which
         spans every column, was setting a floor under the *table* 27px wider
         than the phone it was on, and the points at the end of each squad row
         sat off the right-hand edge. The ellipsis is kept where there is room
         for one line; at this width the name wraps instead. */
      .team .tn{white-space:normal}
      .recs{gap:4px 12px}
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
    /* The upper half of a stacked heading. Block so the break is decided here
       rather than by whatever width the column ends up with, and the lower
       half keeps the cell's own alignment. */
    th .hl{display:block}
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
