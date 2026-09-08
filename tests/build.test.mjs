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

import { classify, home, away, isDone } from "../lib/games.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GAMES = join(ROOT, "fixtures/sample-games.json");
const LINES = join(ROOT, "fixtures/sample-lines.json");
const GOLDEN = join(ROOT, "fixtures/sample-standings.json");

const rosters = JSON.parse(readFileSync(join(ROOT, "data/rosters.json"), "utf8"));
const fixtureGames = JSON.parse(readFileSync(GAMES, "utf8"));
const fixtureLines = JSON.parse(readFileSync(LINES, "utf8"));
const ALL_CONFS = [...rosters.conferences.power, ...rosters.conferences.other];

function runBuilder() {
  const out = join(mkdtempSync(join(tmpdir(), "standings-")), "out.json");
  const r = spawnSync(process.execPath,
    [join(ROOT, "scripts/build-standings.mjs"), "--fixture", GAMES, "--out", out],
    { encoding: "utf8" });
  assert.equal(r.status, 0, `builder exited ${r.status}\n${r.stderr}`);
  return JSON.parse(readFileSync(out, "utf8"));
}

const built = runBuilder();

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
  const last = built.byWeek[built.byWeek.length - 1].cumulative;
  for (const row of built.standings) {
    assert.deepEqual(
      last[row.manager],
      { points: row.points, wins: row.wins, losses: row.losses },
      `${row.manager}'s final snapshot`
    );
  }
});

test("byWeek counts every completed rostered game, results only the scored ones", () => {
  const owned = new Set(Object.values(rosters.managers).flat().map((t) => t.cfbd));
  const rostered = fixtureGames.filter((g) => owned.has(home(g)) || owned.has(away(g)));
  const completed = rostered.filter(isDone);
  const unusable = completed.filter((g) => classify(g, Date.now()) === "unusable");

  const counted = built.byWeek.reduce((s, w) => s + w.games, 0);
  assert.equal(counted, completed.length, "byWeek games");
  /* The gap is the whole point of item 1: a tie and a completed game with no
     score are counted as played weeks but produce no result, and today they
     are visible nowhere else. Phase 1 surfaces them as `unscored`. */
  assert.equal(built.results.length, counted - unusable.length, "results length");
  for (const w of built.byWeek) assert.ok(w.scheduled >= w.games, `${w.label} scheduled vs played`);
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
