/**
 * The race, as arithmetic.
 *
 * The one invariant worth pinning here is that the finer picture never
 * contradicts the coarser one: whatever the per-game path does between two
 * Saturdays, every manager's total at the end of a week is the number the
 * payload states for that week. Everything on the page - the leaderboard, the
 * trophies, the hidden table under the chart - reads that number, and a chart
 * quietly disagreeing with it would be wrong in the way nobody checks.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { VIEWS, axisFor, corners, raceFrames, windowStart } from "../lib/race.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "../fixtures/sample-standings.json"), "utf8"));
const byWeek = golden.byWeek;
const results = golden.results;
const managers = golden.standings.map((r) => r.manager);

test("every week closes on the total the payload states", () => {
  const { frames } = raceFrames(byWeek, results, managers);
  const closes = frames.filter((f) => f.week);
  assert.equal(closes.length, byWeek.length, "one closing frame per scored week");
  closes.forEach((f, i) => {
    const cum = byWeek[i].cumulative;
    for (const [m, v] of Object.entries(cum))
      assert.equal(f.totals[m], v.points, `${m} at the end of ${byWeek[i].label}`);
  });
});

test("a week's games land inside that week's slice, in order", () => {
  const { frames, weeks } = raceFrames(byWeek, results, managers);
  for (const w of weeks) {
    const inside = frames.filter((f) => f.x > w.x0 + 1e-9 && f.x <= w.x1 + 1e-9);
    for (const f of inside) assert.ok(f.x > w.x0 && f.x <= w.x1 + 1e-9);
  }
  const xs = frames.map((f) => f.x);
  for (let i = 1; i < xs.length; i++)
    assert.ok(xs[i] >= xs[i - 1], `frame ${i} goes backwards in time`);
});

test("every week gets the same width, however few games it holds", () => {
  /* The fixture's postseason weeks are short ones. Spacing by game count
     would draw them as slivers, which is the whole reason for the blocking. */
  const { weeks } = raceFrames(byWeek, results, managers);
  const widths = weeks.map((w) => w.x1 - w.x0);
  for (const w of widths) assert.ok(Math.abs(w - widths[0]) < 1e-9, "weeks differ in width");
});

test("nobody moves on a game they lost", () => {
  const { frames } = raceFrames(byWeek, results, managers);
  for (let i = 1; i < frames.length; i++) {
    const moved = Object.keys(frames[i].totals).filter(
      (m) => typeof frames[i].totals[m] === "number" &&
             typeof frames[i - 1].totals[m] === "number" &&
             frames[i].totals[m] < frames[i - 1].totals[m]
    );
    /* A closing frame may snap downward if results and byWeek ever disagree,
       so only the intra-week frames are held to this. */
    if (!frames[i].week)
      assert.deepEqual(moved, [], `a total went down at frame ${i}`);
  }
});

test("the week boundaries stand even with no results at all", () => {
  /* The fallback the chart draws before results.json lands, and if it 404s.
     It has to be the same season, just coarser. */
  const { frames, perGame } = raceFrames(byWeek, [], managers);
  assert.equal(perGame, false);
  const closes = frames.filter((f) => f.week);
  assert.equal(closes.length, byWeek.length);
  closes.forEach((f, i) => {
    for (const [m, v] of Object.entries(byWeek[i].cumulative))
      assert.equal(f.totals[m], v.points, `${m} without results`);
  });
});

test("the week is the authority, not the games", () => {
  /* Hand it a game the weeks do not know about and one that would overshoot.
     The intra-week path may wobble; the boundary may not. */
  const spiked = [...results, { key: "9|99", week: 99, points: 99,
                                winner: { team: "X", manager: managers[0] },
                                loser: { team: "Y", manager: null } }];
  const { frames, weeks } = raceFrames(byWeek, spiked, managers);
  assert.equal(weeks.length, byWeek.length, "a stray week invented a column");
  const last = frames.filter((f) => f.week).at(-1);
  const cum = byWeek.at(-1).cumulative;
  for (const [m, v] of Object.entries(cum)) assert.equal(last.totals[m], v.points);
});

test("a manager the first week never heard of is a gap, not a zero", () => {
  const late = "newcomer";
  const weeks = byWeek.map((w, i) => ({
    ...w,
    cumulative: i === 0 ? w.cumulative : { ...w.cumulative, [late]: { points: 4, wins: 2, losses: 0 } },
  }));
  const { frames } = raceFrames(weeks, results, [...managers, late]);
  assert.equal(frames[0].totals[late], null, "drawn on the start line of a season they missed");
  assert.equal(frames.filter((f) => f.week)[0].totals[late], null, "week 1 invented a zero");
  assert.equal(frames.filter((f) => f.week)[1].totals[late], 4, "never turns up at all");
});

test("the three views agree about who is ahead", () => {
  const { frames } = raceFrames(byWeek, results, managers);
  const totals = frames.at(-1).totals;
  const order = (id) =>
    managers
      .filter((m) => typeof totals[m] === "number")
      .map((m) => [m, VIEWS[id].y(totals, m)])
      /* gap counts downward, so its best is its smallest */
      .sort((a, b) => (id === "gap" ? a[1] - b[1] : b[1] - a[1]))
      .map(([m]) => m);
  assert.deepEqual(order("gap"), order("points"), "gap disagrees with points");
  assert.deepEqual(order("avg"), order("points"), "average disagrees with points");
});

test("the leader is level with themselves and the average sums to nothing", () => {
  const { frames } = raceFrames(byWeek, results, managers);
  const totals = frames.at(-1).totals;
  const named = managers.filter((m) => typeof totals[m] === "number");
  const gaps = named.map((m) => VIEWS.gap.y(totals, m));
  assert.equal(Math.min(...gaps), 0, "nobody is the leader");
  for (const g of gaps) assert.ok(g >= 0, "somebody is ahead of the leader");
  const sum = named.reduce((a, m) => a + VIEWS.avg.y(totals, m), 0);
  assert.ok(Math.abs(sum) < 1e-9, `deviations from the average sum to ${sum}`);
});

test("a window wider than the season is the season", () => {
  /* An index, so it lands on a week rather than between two points. */
  assert.equal(windowStart(1, 4), 0, "week one has no last four");
  assert.equal(windowStart(4, 4), 0, "exactly four weeks is all of them");
  assert.equal(windowStart(8, 4), 4);
  assert.equal(windowStart(16, 4), 12);
  assert.equal(windowStart(16, 0), 0, "no window is the whole season");
});

test("a week's dot stands under its own label", () => {
  /* Both modes, because they do not put the point in the same place: a week
     with games in it closes on its right-hand edge, a week without them is a
     dot in the middle. The label is the middle either way, so the fallback
     used to draw every dot half a week to the right of its own name. */
  const flat = raceFrames(byWeek, [], managers);
  flat.frames.filter((f) => f.week).forEach((f) => {
    assert.equal(f.x, f.week.at, `${f.week.label} sits away from its label`);
  });
  const full = raceFrames(byWeek, results, managers);
  full.frames.filter((f) => f.week).forEach((f) => {
    assert.ok(f.x > f.week.at, `${f.week.label} does not close on its own edge`);
    assert.ok(f.x <= f.week.x1 + 1e-9);
  });
});

test("a cumulative cell the bot wrote wrong draws a dash, not a blank page", () => {
  /* The old chart read this as `?.points ?? null`. Reading it as
     `cum[m].points` throws instead, and there is no error boundary under
     app/ - so a payload one field out would take the whole page down rather
     than leave one cell empty. Every one of these has been written by some
     version of some bot at some point. */
  for (const bad of [null, undefined, 7, "12", {}, { points: null }, { points: "3" }]) {
    const weeks = byWeek.map((w, i) => ({
      ...w,
      cumulative: i === 1 ? { ...w.cumulative, [managers[0]]: bad } : w.cumulative,
    }));
    const { frames } = raceFrames(weeks, results, managers);
    const closes = frames.filter((f) => f.week);
    assert.equal(closes[1].totals[managers[0]], null,
      `${JSON.stringify(bad)} should read as a gap`);
    /* and it must not poison the weeks after it */
    assert.equal(typeof closes[2].totals[managers[0]], "number",
      `${JSON.stringify(bad)} leaked into the next week`);
  }
});

test("a game with a points field off the wire cannot poison a total", () => {
  const junk = [...results, { key: byWeek[0].key, points: "9",
                              winner: { team: "X", manager: managers[0] },
                              loser: { team: "Y", manager: null } }];
  const { frames } = raceFrames(byWeek, junk, managers);
  for (const f of frames)
    for (const v of Object.values(f.totals))
      assert.ok(v === null || Number.isFinite(v), `a total came out as ${v}`);
});

test("a week with no games of its own is a dot in its middle", () => {
  /* `perGame` is true as soon as any one week has games, and a season is
     routinely a mix - the bot writes a week into byWeek before results
     catches up. Those weeks were still being closed on their right-hand edge
     while their label sat in the middle. */
  const onlyFirst = results.filter((g) => g.key === byWeek[0].key);
  const { frames, perGame } = raceFrames(byWeek, onlyFirst, managers);
  assert.equal(perGame, true, "the season should still be drawing game by game");
  const closes = frames.filter((f) => f.week);
  assert.ok(closes[0].x > closes[0].week.at, "a week with games should close on its edge");
  for (const f of closes.slice(1))
    assert.equal(f.x, f.week.at, `${f.week.label} has no games and is off its own label`);
});

test("a week nobody scored in is still a dot in its own middle", () => {
  /* Not the same thing as a week with no rows. Every game in it was won by a
     team nobody drafted - a real Saturday that moves nobody - so the rows are
     there and not one of them draws a frame. Counting rows would put the lone
     dot on the divider with its name half a week away. */
  const blanked = results.map((g) =>
    g.key === byWeek[1].key
      ? { ...g, points: 0, winner: { team: g.winner.team, manager: null } }
      : g
  );
  const { frames } = raceFrames(byWeek, blanked, managers);
  const closes = frames.filter((f) => f.week);
  assert.equal(closes[1].x, closes[1].week.at,
    "a week that scored nothing was closed on its edge anyway");
  assert.ok(closes[0].x > closes[0].week.at, "and a week that did score was not");
});

test("every frame knows which week it is in", () => {
  /* What the window filters on. A frame with the wrong week index is a game
     drawn in the wrong month. */
  const { frames, weeks } = raceFrames(byWeek, results, managers);
  for (const f of frames) {
    const w = weeks[f.wi];
    assert.ok(w, `frame at ${f.x} belongs to no week`);
    assert.ok(f.x >= w.x0 - 1e-9 && f.x <= w.x1 + 1e-9,
      `a frame in ${w.label} is drawn at ${f.x}, outside ${w.x0}..${w.x1}`);
  }
});

test("the axis clamps at zero only where zero is a floor", () => {
  assert.equal(axisFor([3, 10], { floorAtZero: true }).base, 2);
  assert.equal(axisFor([0, 10], { floorAtZero: true }).base, 0, "went below nothing");
  assert.ok(axisFor([-8, 9], { floorAtZero: false }).base < 0, "clamped a view that goes negative");
  /* a league where everybody is level still needs a range to divide by */
  const flat = axisFor([7, 7, 7], { floorAtZero: true });
  assert.ok(flat.top > flat.base, "a level league divides by nothing");
});

test("a flat run keeps its corners and drops the middle", () => {
  const ys = [5, 5, 5, 5, 9, 9];
  assert.deepEqual([...corners(ys)].sort((a, b) => a - b), [0, 3, 4, 5]);
  assert.deepEqual([...corners([1, 2])].sort(), [0, 1], "too short to prune");
  assert.deepEqual([...corners([1, 2, 3])].sort(), [0, 1, 2], "pruned a line that turns everywhere");
  assert.deepEqual([...corners([])], [], "an empty line has no corners");
});

test("the ends of a line are never pruned", () => {
  /* The head of the line is where the driver is drawn and the tail is the
     start of the season. Losing either silently shortens the race. */
  const { frames } = raceFrames(byWeek, results, managers);
  for (const m of managers) {
    const ys = frames.map((f) => f.totals[m]).filter((v) => typeof v === "number");
    if (ys.length < 2) continue;
    const keep = corners(ys);
    assert.ok(keep.has(0), `${m}'s line lost its start`);
    assert.ok(keep.has(ys.length - 1), `${m}'s line lost its end`);
  }
});

test("pruning never changes the shape the line draws", () => {
  /* The whole point: a dropped vertex sat exactly on the segment between its
     neighbours, so reading the kept ones back gives the same value everywhere
     a value was plotted. */
  const { frames } = raceFrames(byWeek, results, managers);
  for (const m of managers) {
    const ys = frames.map((f) => f.totals[m]).filter((v) => typeof v === "number");
    if (ys.length < 2) continue;
    const keep = corners(ys);
    for (let i = 0; i < ys.length; i++) {
      if (keep.has(i)) continue;
      assert.equal(ys[i], ys[i - 1], `${m} lost a turn at ${i}`);
      assert.equal(ys[i], ys[i + 1], `${m} lost a turn at ${i}`);
    }
  }
});
