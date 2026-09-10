/**
 * The trophy case, as a pure function.
 *
 * Hand-built inputs rather than the golden fixture, and no builder subprocess.
 * Every assertion below is about one rule - who is a candidate, how a tie is
 * held, what a runner-up is for - and a fixture with two managers and fourteen
 * games can only ever exercise the rules it happens to contain. The builder's
 * own test file pins what the real season produces.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildAwards, markChanges } from "../lib/awards.mjs";

/* ------------------------------------------------------------------ */
/* input builders                                                      */
/* ------------------------------------------------------------------ */

let seq = 0;
/** A results row, with only the fields the awards read spelled out. */
const game = ({ w = "0|01", win, lose, score = "20-17", pts = 3,
                chance = 0.6, same = false }) => ({
  key: w, week: Number(w.slice(2)), seasonType: w[0] === "1" ? "postseason" : "regular",
  date: `2026-09-0${(seq++ % 9) + 1}T16:00:00.000Z`,
  winner: { team: `${win ?? "Nobody"}-W`, manager: win ?? null },
  loser: { team: `${lose ?? "Nobody"}-L`, manager: lose ?? null },
  score, points: pts, h2h: Boolean(win && lose), sameManager: same,
  upset: chance !== null && chance < 0.5, line: chance === null ? null : "X -3.5",
  chance,
});

/** A byWeek entry carrying only the two blocks the awards read. */
const week = (key, label, delta, cumulative = {}) => ({
  key, label, seasonType: key[0] === "1" ? "postseason" : "regular",
  week: Number(key.slice(2)), games: 1, delta, cumulative,
});

const luckWeek = (key, label, perManager) =>
  week(key, label, {}, Object.fromEntries(Object.entries(perManager).map(
    ([m, [pricedPoints, expectedPoints]]) => [m, { points: 0, wins: 0, losses: 0,
                                                   pricedPoints, expectedPoints }])));

const byId = (awards) => Object.fromEntries(awards.map((a) => [a.id, a]));
const names = (award) => award.holders.map((h) => h.manager);

/* ------------------------------------------------------------------ */
/* the six                                                             */
/* ------------------------------------------------------------------ */

test("each award picks the holder its own rule names", () => {
  const results = [
    game({ win: "ann", lose: "bob", chance: 0.20, score: "21-20", pts: 3 }),
    game({ win: "bob", lose: "ann", chance: 0.90, score: "45-3", pts: 2 }),
    game({ win: "cat", lose: "cat", chance: 0.55, score: "10-7", pts: 3, same: true }),
  ];
  const byWeek = [luckWeek("0|01", "Week 1", { ann: [3, 1.5], bob: [2, 4], cat: [3, 2.9] })];
  byWeek[0].delta = { ann: 3, bob: 2, cat: 3 };
  const a = byId(buildAwards({ results, byWeek }));

  /* ann won a game the market gave her 20%; nobody won a longer one. */
  assert.deepEqual(names(a.upset), ["ann"]);
  /* the same game from the other side: bob's team was a 80% favourite and lost,
     which is the largest chance any losing rostered team was given. */
  assert.deepEqual(names(a.heartbreaker), ["bob"]);
  assert.equal(a.heartbreaker.holders[0].value, 0.8);
  /* 45-3 is 42, and the only other margins are 1 and 3. */
  assert.deepEqual(names(a.blowout), ["bob"]);
  assert.equal(a.blowout.holders[0].value, 42);
  /* ann and cat both banked 3 in week 1, so both hold it. */
  assert.deepEqual(names(a.bestWeek), ["ann", "cat"]);
  /* ann banked 3 where the lines expected 1.5; bob is 2 points under his. */
  assert.deepEqual(names(a.luckiest), ["ann"]);
  assert.equal(a.luckiest.holders[0].value, 1.5);
  /* cat is the only manager who owned both sides of a game. */
  assert.deepEqual(names(a.civilWar), ["cat"]);
  assert.equal(a.civilWar.holders[0].value, 1);
});

test("an empty season awards six trophies to nobody", () => {
  const awards = buildAwards({ results: [], byWeek: [] });
  assert.equal(awards.length, 6);
  for (const a of awards) {
    assert.deepEqual(a.holders, [], `${a.id} found a holder in an empty season`);
    assert.equal(a.runnerUp, null, `${a.id} found a runner-up in an empty season`);
    /* The label and the blurb are what the card renders while it waits, so
       they have to be there before anyone has won anything. */
    assert.ok(a.label && a.blurb && a.unit, `${a.id} is missing its copy`);
  }
});

/* ------------------------------------------------------------------ */
/* who is a candidate                                                  */
/* ------------------------------------------------------------------ */

test("a game the books never priced wins no trophy that is about a price", () => {
  /* An unpriced game carries chance null - not a half - so it has nothing to
     say about what the market expected. It is still a game somebody won by
     five touchdowns, and the blowout does not consult a line. */
  const results = [
    game({ win: "ann", lose: "bob", chance: null, score: "56-0", pts: 3 }),
    game({ win: "bob", lose: "ann", chance: 0.30, score: "20-17", pts: 3 }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(names(a.blowout), ["ann"]);
  assert.deepEqual(names(a.upset), ["bob"], "an unpriced game reached the upset");
  assert.deepEqual(names(a.heartbreaker), ["ann"], "an unpriced game reached the heartbreaker");
});

test("nobody's trophy is won by a team nobody drafted", () => {
  /* results carries every game a rostered team played, including the ones it
     lost to a school nobody took. Those rows have no manager on the winning
     side, and an award is a thing a manager holds. */
  const results = [
    game({ win: null, lose: "ann", chance: 0.10, score: "60-0", pts: 0 }),
    game({ win: "bob", lose: null, chance: 0.80, score: "24-21", pts: 3 }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  /* The 10% winner is undrafted, so the biggest upset is bob's 80% win - not
     an upset at all, but the longest-odds win anyone actually owns. */
  assert.deepEqual(names(a.upset), ["bob"]);
  assert.deepEqual(names(a.blowout), ["bob"]);
  /* The heartbreaker looks at losers, so it sees ann and not the undrafted one. */
  assert.deepEqual(names(a.heartbreaker), ["ann"]);
});

/* ------------------------------------------------------------------ */
/* holders, ties and the runner-up                                     */
/* ------------------------------------------------------------------ */

test("a tie is held jointly, in an order that does not move", () => {
  const results = [
    game({ win: "zoe", lose: "ann", chance: 0.25, score: "20-17" }),
    game({ win: "ann", lose: "zoe", chance: 0.25, score: "20-17" }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(names(a.upset), ["ann", "zoe"],
    "joint holders are not in a stable order");
});

test("the runner-up is the best manager who is not holding it", () => {
  /* The holder alone says who is winning. The runner-up says how safe they
     are, and it is only that if it belongs to somebody else - a holder's own
     second-best game answers a question nobody asked. */
  const results = [
    game({ win: "ann", lose: "bob", chance: 0.10, score: "20-17" }),
    game({ win: "ann", lose: "bob", chance: 0.15, score: "20-17" }),
    game({ win: "cat", lose: "bob", chance: 0.40, score: "20-17" }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(names(a.upset), ["ann"]);
  assert.equal(a.upset.runnerUp.manager, "cat", "ann's own second-best was shown");
  assert.equal(a.upset.runnerUp.value, 0.4);
});

test("one candidate has no runner-up, and none is invented", () => {
  const results = [game({ win: "ann", lose: null, chance: 0.10, score: "20-17" })];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(names(a.upset), ["ann"]);
  assert.equal(a.upset.runnerUp, null);
});

test("a trophy nobody is above the line for is held by nobody", () => {
  /* Every manager under their expectation means the luckiest is the least
     unlucky, which is not a thing to give somebody a trophy for. */
  const byWeek = [luckWeek("0|01", "Week 1", { ann: [1, 3], bob: [2, 5] })];
  const a = byId(buildAwards({ results: [], byWeek }));
  assert.deepEqual(a.luckiest.holders, []);
  assert.equal(a.luckiest.runnerUp, null);
});

/* ------------------------------------------------------------------ */
/* truncation, which is how the badge is computed                      */
/* ------------------------------------------------------------------ */

test("through truncates the season, and the answer moves with it", () => {
  const results = [
    game({ w: "0|01", win: "ann", lose: "bob", chance: 0.40, score: "20-17" }),
    game({ w: "0|02", win: "bob", lose: "ann", chance: 0.10, score: "45-3" }),
  ];
  const byWeek = [
    week("0|01", "Week 1", { ann: 3, bob: 0 }),
    week("0|02", "Week 2", { ann: 0, bob: 9 }),
  ];
  const now = byId(buildAwards({ results, byWeek }));
  const before = byId(buildAwards({ results, byWeek, through: 1 }));

  assert.deepEqual(names(now.upset), ["bob"]);
  assert.deepEqual(names(before.upset), ["ann"], "week 2 leaked into a week 1 view");
  assert.deepEqual(names(now.bestWeek), ["bob"]);
  assert.deepEqual(names(before.bestWeek), ["ann"]);
});

test("markChanges flags exactly the trophies that moved", () => {
  const results = [
    game({ w: "0|01", win: "ann", lose: "bob", chance: 0.40, score: "20-17" }),
    game({ w: "0|02", win: "bob", lose: "ann", chance: 0.10, score: "45-3" }),
  ];
  const byWeek = [
    week("0|01", "Week 1", { ann: 3, bob: 0 }),
    week("0|02", "Week 2", { ann: 0, bob: 9 }),
  ];
  const a = byId(markChanges(buildAwards({ results, byWeek }),
                             buildAwards({ results, byWeek, through: 1 })));
  assert.equal(a.upset.changed, true, "the upset changed hands and did not say so");
  assert.equal(a.bestWeek.changed, true);
  /* Nobody has held the civil war at any point, and a trophy going from
     nobody to nobody has not changed hands. */
  assert.equal(a.civilWar.changed, false);
});

test("a trophy won for the first time has changed hands", () => {
  /* Going from nobody to somebody is the flip most worth a badge, and an
     equality check that treats both as "no holder" would miss it. */
  const results = [game({ w: "0|02", win: "ann", lose: "bob", chance: 0.10 })];
  const byWeek = [week("0|01", "Week 1", {}), week("0|02", "Week 2", {})];
  const a = byId(markChanges(buildAwards({ results, byWeek }),
                             buildAwards({ results, byWeek, through: 1 })));
  assert.equal(a.upset.changed, true);
});

test("a trophy that stayed put says so", () => {
  const results = [game({ w: "0|01", win: "ann", lose: "bob", chance: 0.10 })];
  const byWeek = [week("0|01", "Week 1", { ann: 3 }), week("0|02", "Week 2", { ann: 0 })];
  const a = byId(markChanges(buildAwards({ results, byWeek }),
                             buildAwards({ results, byWeek, through: 1 })));
  assert.equal(a.upset.changed, false);
  assert.equal(a.bestWeek.changed, false);
});

/* ------------------------------------------------------------------ */
/* what a card renders                                                 */
/* ------------------------------------------------------------------ */

test("every holder carries a line of prose naming the game it was won on", () => {
  /* The card shows a name and a number, and a number with no game behind it is
     a claim nobody can check against a box score. */
  const results = [game({ w: "0|02", win: "ann", lose: "bob", chance: 0.10, score: "21-20" })];
  const byWeek = [week("0|01", "Week 1", { ann: 0 }), week("0|02", "Week 2", { ann: 3 })];
  const a = byId(buildAwards({ results, byWeek }));
  const d = a.upset.holders[0].detail;
  assert.match(d, /ann-W/, "the detail does not name the team");
  assert.match(d, /21-20/, "the detail does not carry the score");
  assert.match(d, /Week 2/, "the detail does not say when");
  /* A per-manager award has no single game, so its detail names the week it
     was set in rather than inventing a fixture. */
  assert.match(a.bestWeek.holders[0].detail, /Week 2/);
});

test("a chance is published at a precision the model has, and ties are not invented", () => {
  /* Two games a ten-thousandth apart are two different games, and rounding
     before the sort would hand out a joint trophy neither manager won. */
  const results = [
    game({ win: "ann", lose: null, chance: 0.40001, score: "20-17" }),
    game({ win: "bob", lose: null, chance: 0.40009, score: "20-17" }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(names(a.upset), ["ann"], "a rounded sort produced a false tie");
  assert.equal(a.upset.holders[0].value, 0.4, "the published value is not rounded");
});
