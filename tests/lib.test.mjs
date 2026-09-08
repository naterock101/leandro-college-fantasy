/**
 * The pure functions, exercised at their boundaries.
 *
 * Everything here is synchronous and allocation-free by design: these are the
 * predicates the builder and the page both hang off, so they are the cheapest
 * place in the repo to catch a disagreement between the two.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  pick, home, away, homePts, awayPts, homeConf, awayConf,
  startDate, seasonType, weekOf, isDone, isPost, sortKey,
  classify, LIVE_WINDOW_MS,
} from "../lib/games.mjs";

import { cap, tally, norm, shortDate, kickoff, shortTime } from "../lib/format.mjs";

/* ------------------------------------------------------------------ */
/* field pickers                                                       */
/* ------------------------------------------------------------------ */

/* The same game twice, once in each convention CFBD has been seen to emit.
   Every picker must read them identically or a v1/v2 switch silently zeroes
   the season. */
const camel = {
  id: 1, completed: true, week: 3, seasonType: "postseason",
  startDate: "2026-12-20T18:00:00.000Z",
  homeTeam: "Marshall", awayTeam: "Ohio",
  homePoints: 31, awayPoints: 24,
  homeConference: "Sun Belt", awayConference: "Mid-American",
};
const snake = {
  id: 1, completed: true, week: 3, season_type: "postseason",
  start_date: "2026-12-20T18:00:00.000Z",
  home_team: "Marshall", away_team: "Ohio",
  home_points: 31, away_points: 24,
  home_conference: "Sun Belt", away_conference: "Mid-American",
};

test("pickers read camelCase and snake_case identically", () => {
  for (const g of [camel, snake]) {
    assert.equal(home(g), "Marshall");
    assert.equal(away(g), "Ohio");
    assert.equal(homePts(g), 31);
    assert.equal(awayPts(g), 24);
    assert.equal(homeConf(g), "Sun Belt");
    assert.equal(awayConf(g), "Mid-American");
    assert.equal(startDate(g), "2026-12-20T18:00:00.000Z");
    assert.equal(seasonType(g), "postseason");
    assert.equal(weekOf(g), 3);
    assert.equal(isDone(g), true);
    assert.equal(isPost(g), true);
  }
});

test("pick returns the first name that is neither undefined nor null", () => {
  assert.equal(pick({ a: null, b: 2 }, "a", "b"), 2);
  assert.equal(pick({ a: undefined, b: 2 }, "a", "b"), 2);
  assert.equal(pick({}, "a", "b"), undefined);
  /* 0 and false are legitimate values, so absence must be tested for
     explicitly rather than by falsiness. Week 0 exists in CFBD. */
  assert.equal(pick({ a: 0 }, "a"), 0);
  assert.equal(pick({ a: false }, "a"), false);
});

test("defaults cover the fields CFBD may omit entirely", () => {
  assert.equal(seasonType({}), "regular");
  assert.equal(weekOf({}), 0);
  assert.equal(isDone({}), false);
  /* completed has been seen as the string "true"; only the boolean counts. */
  assert.equal(isDone({ completed: "true" }), false);
  assert.equal(isPost({}), false);
});

/* ------------------------------------------------------------------ */
/* sort keys                                                           */
/* ------------------------------------------------------------------ */

test("sort keys order the season as it is played", () => {
  const key = (week, type) => sortKey({ week, seasonType: type });
  assert.equal(key(1, "regular"), "0|01");
  assert.equal(key(12, "regular"), "0|12");
  assert.equal(key(1, "postseason"), "1|01");
  /* String comparison is the whole point of the zero pad: without it week 10
     sorts before week 2, and every postseason game must sort after every
     regular one whatever its week number. */
  assert.ok(key(2, "regular") < key(10, "regular"));
  assert.ok(key(15, "regular") < key(1, "postseason"));
});

/* ------------------------------------------------------------------ */
/* classify                                                            */
/* ------------------------------------------------------------------ */

const NOW = Date.parse("2026-09-12T20:00:00.000Z");
const at = (offsetMs, extra = {}) => ({
  completed: false,
  startDate: new Date(NOW - offsetMs).toISOString(),
  ...extra,
});

test("an incomplete game is scheduled until it kicks off", () => {
  assert.equal(classify(at(-60_000), NOW), "scheduled");
  assert.equal(classify(at(-1), NOW), "scheduled");
});

test("kickoff itself is live, matching the page's kickoff <= now", () => {
  assert.equal(classify(at(0), NOW), "live");
});

test("live lasts exactly LIVE_WINDOW_MS and not a millisecond longer", () => {
  assert.equal(classify(at(LIVE_WINDOW_MS - 1), NOW), "live");
  assert.equal(classify(at(LIVE_WINDOW_MS), NOW), "stalled");
  assert.equal(classify(at(LIVE_WINDOW_MS + 1), NOW), "stalled");
});

test("a game abandoned weeks ago is stalled, not perpetually upcoming", () => {
  assert.equal(classify(at(30 * 24 * 60 * 60 * 1000), NOW), "stalled");
});

test("an incomplete game with no usable date is scheduled", () => {
  /* We cannot claim a game kicked off without a kickoff time, and calling it
     stalled would silently drop it from remaining on a feed hiccup. */
  assert.equal(classify({ completed: false }, NOW), "scheduled");
  assert.equal(classify({ completed: false, startDate: "not a date" }, NOW), "scheduled");
});

test("a completed game with two different numeric scores is final", () => {
  assert.equal(classify({ completed: true, homePoints: 31, awayPoints: 24 }, NOW), "final");
  assert.equal(classify({ completed: true, home_points: 0, away_points: 7 }, NOW), "final");
});

test("a completed game the feed never scored is unusable", () => {
  assert.equal(classify({ completed: true }, NOW), "unusable");
  assert.equal(classify({ completed: true, homePoints: 21 }, NOW), "unusable");
  /* Strings score as nothing: "21" > "7" is false in string comparison, so a
     stringly-typed feed would invert the result rather than fail. */
  assert.equal(classify({ completed: true, homePoints: "21", awayPoints: "7" }, NOW), "unusable");
});

test("a tie is unusable, because this league has no half wins", () => {
  assert.equal(classify({ completed: true, homePoints: 21, awayPoints: 21 }, NOW), "unusable");
  assert.equal(classify({ completed: true, homePoints: 0, awayPoints: 0 }, NOW), "unusable");
});

test("completion beats the clock: a final game is never stalled", () => {
  const old = { completed: true, startDate: "2026-01-01T00:00:00.000Z", homePoints: 3, awayPoints: 0 };
  assert.equal(classify(old, NOW), "final");
});

test("LIVE_WINDOW_MS is the five and a half hours the page has always used", () => {
  assert.equal(LIVE_WINDOW_MS, 5.5 * 60 * 60 * 1000);
});

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

test("cap titles a manager name without touching the rest", () => {
  assert.equal(cap("nathan"), "Nathan");
  assert.equal(cap("tconn"), "Tconn");
  assert.equal(cap(""), "");
});

test("tally drops the fraction rather than inventing a denominator", () => {
  assert.equal(tally(8, 9), "8/9");
  assert.equal(tally(8), "8");
  /* A snapshot written before `scheduled` existed has no total. Defaulting it
     to the played count would render a part-played week as finished. */
  assert.equal(tally(8, undefined), "8");
  assert.equal(tally(0, 12), "0/12");
});

test("norm folds the accents and punctuation the search box has to survive", () => {
  assert.equal(norm("San José State"), "san jose state");
  assert.equal(norm("Texas A&M"), "texas a m");
  assert.equal(norm("Hawaiʻi"), "hawai i");
  assert.equal(norm("  Miami (OH)  "), "miami oh");
});

test("date helpers are total over the inputs the payload actually carries", () => {
  /* Locale output is the host's business; what matters is that an absent date
     renders as nothing rather than "Invalid Date". */
  assert.equal(shortDate(undefined), "");
  assert.equal(shortDate(""), "");
  const d = "2026-09-12T20:00:00.000Z";
  assert.ok(shortDate(d).length > 0);
  assert.ok(kickoff(d).length > 0);
  assert.equal(kickoff(d), shortTime(d));
});
