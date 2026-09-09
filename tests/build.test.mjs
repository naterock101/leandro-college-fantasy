/**
 * The builder, end to end, against the committed fixtures.
 *
 * Hermetic on purpose: --fixture reads fixtures/sample-games.json and
 * fixtures/sample-lines.json and nothing else, so this makes no network call,
 * needs no CFBD key, and cannot flake. The script is run as a subprocess
 * rather than imported because it does its work at module top level.
 *
 * Two kinds of assertion live here. The golden file pins the *current* output
 * byte for byte, so any behaviour change has to be looked at. The invariants
 * below hold for any input at all, so they still bite when the golden is
 * deliberately regenerated.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classify, home, away, isDone, sortKey } from "../lib/games.mjs";
import { round1, winProbability } from "../lib/winprob.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GAMES = join(ROOT, "fixtures/sample-games.json");
const LINES = join(ROOT, "fixtures/sample-lines.json");
const GOLDEN = join(ROOT, "fixtures/sample-standings.json");

const rosters = JSON.parse(readFileSync(join(ROOT, "data/rosters.json"), "utf8"));
const fixtureGames = JSON.parse(readFileSync(GAMES, "utf8"));
const fixtureLines = JSON.parse(readFileSync(LINES, "utf8"));
const ALL_CONFS = [...rosters.conferences.power, ...rosters.conferences.other];

const OWNED = new Set(Object.values(rosters.managers).flat().map((t) => t.cfbd));
/* The builder writes a game into results or unscored only when someone drafted
   a side of it, so every count below has to be taken over the same subset. */
const rostered = (games) => games.filter((g) => OWNED.has(home(g)) || OWNED.has(away(g)));

/** @param {string} [now] ISO instant to build against, or the fixture's own pin */
function runBuilder(now) {
  const out = join(mkdtempSync(join(tmpdir(), "standings-")), "out.json");
  /* --union, because everything below asserts about the payload as a whole and
     the split is not what is under test here. The split's own guarantee - that
     the three files it writes recombine into exactly this object - is asserted
     in tests/payload.test.mjs, which is what lets this file go on treating the
     payload as one thing. */
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES, "--out", out, "--union",
      ...(now ? ["--now", now] : [])],
    { encoding: "utf8" });
  assert.equal(r.status, 0, `builder exited ${r.status}\n${r.stderr}`);
  return JSON.parse(readFileSync(out, "utf8"));
}

const built = runBuilder();

/* The instant the builder judged this build against, read back out of its own
   output. Whether a game is live or stalled is a function of the clock, so the
   fixture pins one rather than inheriting the wall clock - otherwise the golden
   file would classify week 3 differently before and after 12 September and
   could not be diffed. Taking it from generatedAt rather than repeating the
   literal is deliberate twice over: nothing here can drift from the builder's
   idea of now, and the fact that the two agree is itself the proof that one
   clock was threaded through rather than Date.now() called in several places. */
const NOW = Date.parse(built.generatedAt);

/* ------------------------------------------------------------------ */
/* hermeticity                                                         */
/* ------------------------------------------------------------------ */

test("a fixture build reads the fixture lines, never the live file", () => {
  /* public/lines.json carries a wall-clock fetchedAt that changes every eight
     hours, so reading it made the golden file undiffable. Naming the fixture's
     own timestamp here is what proves the live file is out of the picture. */
  assert.equal(built.linesFetchedAt, fixtureLines.fetchedAt);
});

test("two builds of the same fixture differ only in generatedAt", () => {
  const again = runBuilder();
  assert.notEqual(again.generatedAt, undefined);
  delete again.generatedAt;
  const first = { ...built };
  delete first.generatedAt;
  assert.deepEqual(again, first);
});

test("a fixture build's clock is pinned, so no state in it can turn overnight", () => {
  assert.ok(Number.isFinite(NOW), `generatedAt ${built.generatedAt} is not an instant`);
  /* The live file wants the wall clock; the fixture wants a fixed one. Two runs
     minutes apart producing the same instant is what says the fixture path took
     the pin. Without it a stalled game would go on being stalled but a
     scheduled one would quietly become live and then stalled as the real date
     passed the fixture's, and the golden would rot on a calendar. */
  assert.equal(runBuilder().generatedAt, built.generatedAt);
});

/* ------------------------------------------------------------------ */
/* golden file                                                         */
/* ------------------------------------------------------------------ */

test("output matches fixtures/sample-standings.json", () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const actual = { ...built };
  /* Excluded by name rather than by a fuzzy diff: a tolerant comparison would
     also swallow the next field that starts drifting. */
  delete golden.generatedAt;
  delete actual.generatedAt;
  assert.deepEqual(actual, golden,
    "output drifted from the golden file. Read the diff, then regenerate with " +
    "npm run fixture:regen only if every change was intended.");
});

/* ------------------------------------------------------------------ */
/* invariants: true for any input, not just this fixture               */
/* ------------------------------------------------------------------ */

test("every manager holds ten teams, one per conference, four of them power", () => {
  assert.equal(built.standings.length, Object.keys(rosters.managers).length);
  for (const row of built.standings) {
    const teams = Object.values(row.teams);
    assert.equal(teams.length, 10, `${row.manager} has ${teams.length} teams`);
    const confs = teams.map((t) => t.conf).sort();
    assert.deepEqual(confs, [...ALL_CONFS].sort(), `${row.manager}'s conferences`);
    assert.equal(teams.filter((t) => t.tier === "p4").length, 4, `${row.manager}'s power count`);
  }
});

test("points are three a power win and two otherwise, with nothing else added", () => {
  for (const row of built.standings) {
    const teams = Object.values(row.teams);
    const expected = teams.reduce((s, t) => s + t.wins * built.scoring[t.tier], 0);
    assert.equal(row.points, expected, `${row.manager}'s points`);
    assert.equal(row.wins, teams.reduce((s, t) => s + t.wins, 0), `${row.manager}'s wins`);
    assert.equal(row.losses, teams.reduce((s, t) => s + t.losses, 0), `${row.manager}'s losses`);
  }
});

test("ceiling is points plus every remaining game, less the own-matchup docking", () => {
  for (const row of built.standings) {
    const teams = Object.values(row.teams);
    const upside = teams.reduce((s, t) => s + t.remaining * built.scoring[t.tier], 0);
    assert.equal(row.ceiling, row.points + upside - row.collisionLoss, `${row.manager}'s ceiling`);
    /* collisionLoss can only ever cancel games already counted in upside, so
       the ceiling can never fall below what is already banked. */
    assert.ok(row.ceiling >= row.points, `${row.manager}'s ceiling is below their points`);
    assert.equal(row.remaining, teams.reduce((s, t) => s + t.remaining, 0), `${row.manager}'s remaining`);
  }
});

test("the last cumulative snapshot in byWeek is the standings table", () => {
  /* The invariant the leaderboard leans on twice over: it sums byWeek to get
     the season's game count, and it reads the *last* week's expectation for
     the live board on the strength of that week being the season to date. The
     expectation itself is not in this comparison because the standings table
     has no counterpart to it - it is checked separately below. */
  const last = built.byWeek[built.byWeek.length - 1].cumulative;
  for (const row of built.standings) {
    const { points, wins, losses } = last[row.manager];
    assert.deepEqual(
      { points, wins, losses },
      { points: row.points, wins: row.wins, losses: row.losses },
      `${row.manager}'s final snapshot`
    );
  }
});

test("byWeek counts every completed rostered game, results only the scored ones", () => {
  const completed = rostered(fixtureGames).filter(isDone);
  const unusable = completed.filter((g) => classify(g, NOW) === "unusable");

  const counted = built.byWeek.reduce((s, w) => s + w.games, 0);
  assert.equal(counted, completed.length, "byWeek games");
  assert.equal(built.results.length, counted - unusable.length, "results length");
  for (const w of built.byWeek) assert.ok(w.scheduled >= w.games, `${w.label} scheduled vs played`);
});

test("a rostered game is in results or unscored exactly when it can no longer be played", () => {
  /* The exact form the phase 0 note left open. `scheduled` and `live` are the
     two states a game can still leave, so they are the two that appear in
     neither array; every other rostered game contributes exactly one entry to
     exactly one of them. The naive sum(byWeek[].games) == results.length is
     false because a completed game with no usable score is counted as played
     and produces no result - that gap is now named rather than tolerated. */
  const settled = rostered(fixtureGames)
    .filter((g) => !["scheduled", "live"].includes(classify(g, NOW)));
  assert.equal(built.results.length + built.unscored.length, settled.length);

  /* And the same identity from byWeek's side: it counts completed games, which
     is results plus the completed half of unscored. A stalled game was never
     completed, so it is in unscored and in no week's total. */
  const counted = built.byWeek.reduce((s, w) => s + w.games, 0);
  const abandoned = built.unscored.filter((u) => u.reason === "no result").length;
  assert.equal(counted, built.results.length + built.unscored.length - abandoned);
});

test("headToHead is drafted on both sides, results on at least one", () => {
  for (const h of built.headToHead) {
    assert.ok(h.winner.manager, `headToHead winner ${h.winner.team} has no manager`);
    assert.ok(h.loser.manager, `headToHead loser ${h.loser.team} has no manager`);
  }
  for (const r of built.results) {
    assert.ok(r.winner.manager || r.loser.manager,
      `results entry ${r.winner.team} v ${r.loser.team} has no manager on either side`);
  }
  /* headToHead is exactly the h2h-flagged subset of the timeline, under a
     second name the page has read since the first deploy. */
  assert.equal(built.headToHead.length, built.results.filter((r) => r.h2h).length);
});

test("a pick-em has no favourite and so can never be an upset", () => {
  for (const h of built.headToHead) {
    if (h.spread && h.spread.favorite === null) assert.equal(h.upset, false, `${h.score} pick-em`);
    if (!h.spread) assert.equal(h.upset, false, `${h.score} was never priced`);
  }
});

test("games of the week all share one week, and the label names it", () => {
  const games = built.gamesOfWeek.games;
  if (!games.length) {
    assert.equal(built.gamesOfWeek.label, null);
    return;
  }
  const keys = new Set(games.map((g) => `${g.seasonType}|${g.week}`));
  assert.equal(keys.size, 1, "games of the week span more than one week");
  const [first] = games;
  assert.equal(built.gamesOfWeek.label,
    first.seasonType === "postseason" ? `Postseason ${first.week}` : `Week ${first.week}`);
});

/* ------------------------------------------------------------------ */
/* the dead-week pin                                                   */
/* ------------------------------------------------------------------ */

test("a game nobody ever scored cannot hold games of the week open", () => {
  /* Game 9 in the fixture kicked off on 5 September and was never completed:
     the duplicate of game 20 that a feed correction left behind. It was the
     lowest sort key among incomplete games, so it pinned games of the week to
     week 1 and would have done so until December. */
  assert.equal(built.gamesOfWeek.label, "Week 3");
  assert.equal(built.gamesOfWeek.games.length, 3);
  assert.equal(built.projection.key, "0|03", "the projection is pinned to the dead week");
  assert.equal(built.projection.games, 3);
});

test("every game of the week is one that can still be played", () => {
  const byKey = new Map(fixtureGames.map((g) => [g.id, g]));
  for (const g of built.gamesOfWeek.games) {
    const state = classify(byKey.get(g.id), NOW);
    assert.ok(state === "scheduled" || state === "live",
      `${g.away.team} at ${g.home.team} is ${state} and should not be listed as upcoming`);
  }
});

test("a game in flight is still a game of the week, and stalls out of it later", () => {
  /* The three week 3 games kick at 16:00, 20:00 and 23:30 UTC on 12 September.
     Halfway through the first one all three are still to be won. */
  const during = runBuilder("2026-09-12T18:00:00.000Z");
  assert.equal(during.gamesOfWeek.games.length, 3);
  assert.deepEqual(during.unscored, built.unscored);

  /* A day later none of them ever reported, which is the shape of the original
     bug taken to its end: nothing left to play, so nothing left to win. */
  const after = runBuilder("2026-09-13T12:00:00.000Z");
  assert.equal(after.gamesOfWeek.games.length, 0);
  assert.equal(after.gamesOfWeek.label, null);
  assert.equal(after.projection, null);
  assert.equal(after.unscored.length, built.unscored.length + 3);
  for (const row of after.standings) {
    assert.equal(row.remaining, 0, `${row.manager} has games left in a season with none`);
    assert.equal(row.ceiling, row.points, `${row.manager}'s ceiling outruns their points`);
  }
});

/* ------------------------------------------------------------------ */
/* remaining and ceiling                                               */
/* ------------------------------------------------------------------ */

test("a stalled game counts toward nobody's remaining, and nobody's ceiling", () => {
  const row = (m) => built.standings.find((r) => r.manager === m);

  /* Nathan's Texas A&M is on both sides of this: the abandoned game 9, and
     game 23 in week 3 which he can still win. Only the second is worth 3. */
  assert.equal(row("nathan").teams["Texas A&M"].remaining, 1);
  assert.equal(row("nathan").remaining, 2);
  assert.equal(row("nathan").ceiling, 10);

  /* New Mexico at Wyoming kicked off on 5 September and never reported, so the
     only game either manager had left is gone and their ceilings are what they
     have already banked. */
  for (const m of ["leandro", "steve"]) {
    assert.equal(row(m).remaining, 0, `${m}'s remaining`);
    assert.equal(row(m).ceiling, row(m).points, `${m}'s ceiling`);
  }

  /* The all-teams table is built from the same walk and must not disagree. */
  const mw = built.byConference["Mountain West"];
  assert.equal(mw.find((t) => t.team === "New Mexico").remaining, 0);
  assert.equal(mw.find((t) => t.team === "Wyoming").remaining, 0);
});

/* ------------------------------------------------------------------ */
/* unscored                                                            */
/* ------------------------------------------------------------------ */

test("unscored holds every rostered game that stalled or came back unusable", () => {
  const expected = rostered(fixtureGames)
    .filter((g) => ["stalled", "unusable"].includes(classify(g, NOW)));
  assert.ok(expected.length, "the fixture no longer holds an unscored game");
  assert.equal(built.unscored.length, expected.length);
  assert.deepEqual(
    built.unscored.map((u) => u.key).sort(),
    expected.map(sortKey).sort()
  );
  /* Same lean pair as results, not the tier-and-draft-name shape the upcoming
     list carries: this is a list of games that did not happen, and a payload
     the bot rewrites every ten minutes pays for every field in it. */
  for (const u of built.unscored) {
    assert.deepEqual(Object.keys(u.away).sort(), ["manager", "team"]);
    assert.deepEqual(Object.keys(u.home).sort(), ["manager", "team"]);
    assert.ok(u.away.manager || u.home.manager, `${u.away.team} at ${u.home.team} has no manager`);
  }
});

test("the three ways a game goes unscored each name themselves", () => {
  const find = (a, h) => built.unscored.find((u) => u.away.team === a && u.home.team === h);
  /* kicked off, never completed */
  assert.equal(find("Missouri State", "Texas A&M").reason, "no result");
  assert.equal(find("New Mexico", "Wyoming").reason, "no result");
  /* completed with the score fields empty */
  assert.equal(find("Buffalo", "Toledo").reason, "no score");
  /* completed level, and this league has no half wins */
  assert.equal(find("Tulane", "Navy").reason, "tied");
});

test("unscored is sorted the way the timeline is, and reaches no other list", () => {
  const order = [...built.unscored].sort((a, b) =>
    a.key.localeCompare(b.key) || String(a.date).localeCompare(String(b.date)));
  assert.deepEqual(built.unscored, order);

  /* Week, kickoff and the pair of schools. No entry carries the game id, and
     the fixture's orphan is a duplicate of a game between the same two teams at
     the same time in a different week, so the week is what tells them apart -
     drop it and the orphan looks like the played game and this test passes for
     the wrong reason. */
  const id = (g, a, b) => `${g.seasonType}|${g.week}|${g.date}|${[a, b].sort().join(" v ")}`;
  const elsewhere = new Map([
    ...built.results.map((r) => [id(r, r.winner.team, r.loser.team), "results"]),
    ...built.headToHead.map((h) => [id(h, h.winner.team, h.loser.team), "headToHead"]),
    ...built.gamesOfWeek.games.map((g) => [id(g, g.away.team, g.home.team), "gamesOfWeek"]),
  ]);
  for (const u of built.unscored) {
    const where = elsewhere.get(id(u, u.away.team, u.home.team));
    assert.equal(where, undefined, `${u.away.team} at ${u.home.team} is also in ${where}`);
  }
});

test("byConference holds every conference and no team from outside one", () => {
  assert.deepEqual(Object.keys(built.byConference).sort(), [...ALL_CONFS].sort());
  const power = new Set(rosters.conferences.power);
  for (const [conf, teams] of Object.entries(built.byConference)) {
    for (const t of teams) {
      assert.equal(t.tier, power.has(conf) ? "p4" : "g5", `${t.team} in ${conf}`);
    }
    /* Sorted on points, then wins, then name: the page renders the array as
       given and does no sorting of its own. */
    const sorted = [...teams].sort(
      (x, y) => y.points - x.points || y.wins - x.wins || x.team.localeCompare(y.team));
    assert.deepEqual(teams, sorted, `${conf} is out of order`);
  }
});

/* ------------------------------------------------------------------ */
/* win probability, expected points and luck                           */
/* ------------------------------------------------------------------ */

/* Who owns what, rebuilt here rather than read off the payload, so the
   assertions below check the builder against the roster file and not against
   its own output. */
const OWNER = new Map(
  Object.entries(rosters.managers).flatMap(([manager, teams]) =>
    teams.map((t) => [t.cfbd, { manager, tier: t.tier }])));
const value = (tier) => rosters.scoring[tier];

/** Every rostered game that produced a result, paired with its stored line. */
const settled = () => rostered(fixtureGames)
  .filter((g) => classify(g, NOW) === "final")
  .map((g) => ({ game: g, line: fixtureLines.games[g.id] ?? null }));

test("luck covers every settled game that was priced, and counts the ones that were not", () => {
  const all = settled();
  const priced = all.filter((s) => s.line);
  assert.ok(priced.length, "the fixture prices no completed game");
  assert.ok(all.length > priced.length,
    "the fixture no longer holds an unpriced completed game, which is the case this exists for");

  assert.equal(built.luck.games, priced.length, "priced games in the luck ledger");
  /* The count that has to survive into the payload. A luck number computed over
     six games of fourteen and presented as a season is worse than no luck
     number at all, so the excluded count travels with it and the caption reads
     it out. */
  assert.equal(built.luck.unpriced, all.length - priced.length, "excluded games");
});

test("a game with no line moves neither side of anybody's luck", () => {
  /* Counted from the roster and the lines file, so this is an independent count
     of how many team-games each manager should have in the ledger. An unpriced
     game contributes nothing to either manager on it - not a coin flip, not a
     zero, nothing - so it must not reach `games` either. */
  const expected = Object.fromEntries(Object.keys(rosters.managers).map((m) => [m, 0]));
  for (const { game, line } of settled()) {
    if (!line) continue;
    for (const team of [home(game), away(game)]) {
      const o = OWNER.get(team);
      if (o) expected[o.manager]++;
    }
  }
  for (const [manager, n] of Object.entries(expected)) {
    assert.equal(built.luck.managers[manager].games, n, `${manager}'s counted games`);
  }

  /* And the concrete case, so a change that quietly starts counting unpriced
     games fails with a name attached. Nathan's Texas A&M beat Missouri State
     45-10 in week 2 and the books never priced it: three points banked that the
     model is not entitled to an opinion about. */
  const unpriced = fixtureGames.find((g) => g.id === 20);
  assert.equal(fixtureLines.games[unpriced.id], undefined, "game 20 acquired a line");
  assert.equal(built.luck.managers.nathan.games, 2);
  assert.equal(built.luck.managers.nathan.actual, 2,
    "an unpriced win was counted into actual points");
});

test("every manager's luck is their banked points less their expected ones", () => {
  for (const [manager, l] of Object.entries(built.luck.managers)) {
    assert.equal(l.delta, round1(l.actual - l.expected), `${manager}'s luck`);
    assert.ok(l.expected >= 0, `${manager}'s expected points are negative`);

    /* Expected can never exceed what was on offer: it is a sum of p*value with
       every p at most 1. Recomputed from the roster rather than trusted. */
    let available = 0;
    for (const { game, line } of settled()) {
      if (!line) continue;
      for (const team of [home(game), away(game)]) {
        const o = OWNER.get(team);
        if (o && o.manager === manager) available += value(o.tier);
      }
    }
    assert.ok(l.expected <= available,
      `${manager} expected ${l.expected} of a possible ${available}`);
    assert.ok(l.actual <= available, `${manager} banked more than was on offer`);
  }
});

test("every week's expected record adds back to its own denominator", () => {
  /* The pair is published side by side with the count of games behind it and a
     reader subtracts them, so the one thing that must not drift is that
     denominator. Rounding a running total is exactly how a twelve-week column
     comes to claim 1.5-1.6 of three games, which is why the losses are derived
     from the published wins rather than accumulated in parallel. */
  for (const w of built.byWeek) {
    for (const [manager, c] of Object.entries(w.cumulative)) {
      assert.equal(round1(c.expectedWins + c.expectedLosses), c.priced,
        `${manager}'s expected record at ${w.label}`);
      /* Nobody is expected to win a game they were not in. */
      assert.ok(c.expectedWins >= 0 && c.expectedWins <= c.priced,
        `${manager} expected ${c.expectedWins} wins from ${c.priced} games`);
      /* And it can only ever cover games that were actually played. */
      assert.ok(c.priced <= c.wins + c.losses,
        `${manager} priced ${c.priced} of ${c.wins + c.losses} played`);
    }
  }
});

test("the expected record accumulates rather than restarting each week", () => {
  /* The whole shape of the column: week 2 is week 1 plus week 2. A version
     that showed one week's expectation against a cumulative record would look
     entirely plausible and be nonsense. */
  let grew = false;
  for (let i = 1; i < built.byWeek.length; i++) {
    for (const [manager, c] of Object.entries(built.byWeek[i].cumulative)) {
      const prev = built.byWeek[i - 1].cumulative[manager];
      assert.ok(c.expectedWins >= prev.expectedWins,
        `${manager} lost expected wins at ${built.byWeek[i].label}`);
      assert.ok(c.priced >= prev.priced,
        `${manager}'s denominator shrank at ${built.byWeek[i].label}`);
      if (c.priced > prev.priced) grew = true;
    }
  }
  assert.ok(grew, "no manager's expectation grew, so this test measured nothing");
});

test("the expected record is the sum of the win probabilities, not the points", () => {
  /* Recomputed from the roster and the lines file rather than from the
     payload, so this checks the builder against its inputs. The tier value is
     deliberately absent: a win is a win here, which is the whole difference
     between this column and the points beside it. */
  const expected = Object.fromEntries(Object.keys(rosters.managers).map((m) => [m, 0]));
  const priced = Object.fromEntries(Object.keys(rosters.managers).map((m) => [m, 0]));
  for (const { game, line } of settled()) {
    if (!line) continue;
    for (const team of [home(game), away(game)]) {
      const o = OWNER.get(team);
      if (!o) continue;
      expected[o.manager] += winProbability(line, team);
      priced[o.manager] += 1;
    }
  }
  const last = built.byWeek[built.byWeek.length - 1].cumulative;
  for (const [manager, wins] of Object.entries(expected)) {
    assert.equal(last[manager].expectedWins, round1(wins), `${manager}'s expected wins`);
    assert.equal(last[manager].priced, priced[manager], `${manager}'s priced games`);
  }
});

test("a game with no line moves neither half of the expected record", () => {
  /* The same rule luck follows, enforced where the column actually reads from.
     Nathan's Texas A&M beat Missouri State 45-10 in week 2 and the books never
     priced it: a win in Act W-L that Exp W-L is not entitled to an opinion
     about. */
  const unpriced = fixtureGames.find((g) => g.id === 20);
  assert.equal(fixtureLines.games[unpriced.id], undefined, "game 20 acquired a line");
  const last = built.byWeek[built.byWeek.length - 1].cumulative.nathan;
  assert.equal(last.wins + last.losses, 5, "nathan's settled games");
  assert.equal(last.priced, 2, "an unpriced game reached the expected record");
});

test("a manager whose only games went unpriced has no luck either way", () => {
  /* Leandro's New Mexico and Steve's Wyoming were in one game between them and
     it never reported, so neither has a settled game at all. Zero here means
     "nothing to say", which is why the count of excluded games has to be on
     screen next to it. */
  for (const m of ["leandro", "steve"]) {
    assert.deepEqual(built.luck.managers[m], { games: 0, actual: 0, expected: 0, delta: 0 });
  }
});

test("the projection gains expected points without losing its old shape", () => {
  const p = built.projection;
  /* The naive projection is still there, field for field. A browser holding
     cached JS reads these and must not meet a reshaped object. */
  for (const key of ["key", "label", "games", "projected", "unprojected", "managers"]) {
    assert.ok(key in p, `projection lost ${key}`);
  }
  for (const [manager, m] of Object.entries(p.managers)) {
    for (const key of ["wins", "losses", "points", "gained", "rankDelta"]) {
      assert.ok(key in m, `${manager} lost projection.${key}`);
    }
    assert.equal(typeof m.expectedGained, "number", `${manager}'s expected gain`);
    assert.equal(typeof m.expectedPoints, "number", `${manager}'s expected total`);

    const now = built.standings.find((r) => r.manager === manager).points;
    assert.equal(m.expectedPoints, round1(now + m.expectedGained),
      `${manager}'s expected total is not their points plus their expected gain`);
  }
});

test("expected points never exceed the points actually available that week", () => {
  const p = built.projection;
  /* The most a manager can take out of the week, counting each side of a game
     between two of their own teams once - the same games the projection walks.
     Every probability is at most 1, so the expectation is at most this, and a
     model that beat it would be one that had stopped being a probability. */
  const available = {};
  for (const g of built.gamesOfWeek.games) {
    for (const sd of [g.home, g.away]) {
      if (!sd.manager) continue;
      available[sd.manager] = (available[sd.manager] ?? 0) + built.scoring[sd.tier];
    }
  }
  for (const [manager, m] of Object.entries(p.managers)) {
    const cap = available[manager] ?? 0;
    assert.ok(m.expectedGained >= 0, `${manager} expects to lose points by playing`);
    assert.ok(m.expectedGained <= cap,
      `${manager} expects ${m.expectedGained} from a week worth ${cap}`);
    /* Deliberately not asserted: that the honest expectation is under the naive
       "every favourite wins" projection. It is per *game* - a favourite is
       handed its whole value there and keeps back the upset share here - and it
       is not per manager, because a manager who owns only underdogs is given
       nothing by the naive projection and a real share of a real chance by this
       one. An ordering between the two columns would be a nice sentence and a
       false test. */
  }
});

test("the projection ignores unpriced games on both counts", () => {
  const week = built.gamesOfWeek.games;
  assert.equal(built.projection.games, week.length);
  assert.equal(built.projection.projected + built.projection.unprojected, week.length);
  /* A week nobody priced expects nothing, rather than expecting half of it. */
  if (week.length && week.every((g) => !g.spread)) {
    for (const m of Object.values(built.projection.managers)) {
      assert.equal(m.expectedGained, 0);
    }
  }
});
