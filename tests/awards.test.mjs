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
                chance = 0.6, same = false, exp = 0 }) => ({
  key: w, week: Number(w.slice(2)), seasonType: w[0] === "1" ? "postseason" : "regular",
  date: `2026-09-0${(seq++ % 9) + 1}T16:00:00.000Z`,
  winner: { team: `${win ?? "Nobody"}-W`, manager: win ?? null },
  loser: { team: `${lose ?? "Nobody"}-L`, manager: lose ?? null },
  score, points: pts, h2h: Boolean(win && lose), sameManager: same,
  upset: chance !== null && chance < 0.5, line: chance === null ? null : "X -3.5",
  chance, expectedMargin: chance === null ? null : exp,
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

/* The two static inputs: what a team is worth is a draft property and a league
   rule, so neither is affected by how much of the season is in view. */
const SCORING = { p4: 3, g5: 2 };
/** @param {Record<string, Record<string, "p4"|"g5">>} squads manager -> team -> tier */
const standingsOf = (squads) => Object.entries(squads).map(([manager, teams]) => ({
  manager, points: 0, wins: 0, losses: 0, remaining: 0, ceiling: 0, collisionLoss: 0,
  teams: Object.fromEntries(Object.entries(teams).map(([team, tier]) =>
    [team, { team, draft: team, conf: "X", tier,
             wins: 0, losses: 0, points: 0, remaining: 0, ceiling: 0 }])),
}));

const byId = (awards) => Object.fromEntries(awards.map((a) => [a.id, a]));
const names = (award) => award.holders.map((h) => h.manager);

/* ------------------------------------------------------------------ */
/* the six                                                             */
/* ------------------------------------------------------------------ */

test("each award picks the holder its own rule names", () => {
  const results = [
    game({ win: "ann", lose: "bob", chance: 0.20, score: "21-20", pts: 3, exp: -13 }),
    game({ win: "bob", lose: "ann", chance: 0.90, score: "45-3", pts: 2, exp: 40 }),
    game({ win: "cat", lose: "cat", chance: 0.55, score: "10-7", pts: 3, same: true, exp: 1 }),
  ];
  const byWeek = [luckWeek("0|01", "Week 1", { ann: [3, 1.5], bob: [2, 4], cat: [3, 2.9] })];
  byWeek[0].delta = { ann: 3, bob: 2, cat: 3 };
  const standings = standingsOf({ cat: { "cat-W": "p4", "cat-L": "g5" } });
  const a = byId(buildAwards({ results, byWeek, standings, scoring: SCORING }));

  /* ann won a game the market gave her 20%; nobody won a longer one. */
  assert.deepEqual(names(a.upset), ["ann"]);
  /* the same game from the other side: bob's team was a 80% favourite and lost,
     which is the largest chance any losing rostered team was given. */
  assert.deepEqual(names(a.heartbreaker), ["bob"]);
  assert.equal(a.heartbreaker.holders[0].value, 0.8);
  /* Against the number, not against nought. bob won by 42 as a 40-point
     favourite, which is two points of cover; ann won by one as a 13-point
     underdog, which is fourteen. The raw margins say bob by a mile. */
  assert.deepEqual(names(a.blowout), ["ann"]);
  assert.equal(a.blowout.holders[0].value, 14);
  /* ann and cat both banked 3 in week 1, so both hold it. */
  assert.deepEqual(names(a.bestWeek), ["ann", "cat"]);
  /* ann banked 3 where the lines expected 1.5; bob is 2 points under his. */
  assert.deepEqual(names(a.luckiest), ["ann"]);
  assert.equal(a.luckiest.holders[0].value, 1.5);
  /* cat owned both sides of a game, and the side that lost was a g5 team, so
     the two points it would have banked against anyone else are gone. */
  assert.deepEqual(names(a.civilWar), ["cat"]);
  assert.equal(a.civilWar.holders[0].value, 2);
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
  /* An unpriced game carries chance null and expectedMargin null - not a half
     and not a nought - so it has nothing to say about what the market thought.
     All three of these awards are statements about the closing lines, so a
     56-0 win nobody put a number on beats no number and wins nothing.

     That is the cost of measuring the blowout against the spread, and it is
     paid knowingly: a sixth of the live season carries no line, and one of
     those games being the season's biggest hiding is a real possibility. The
     alternative is a trophy that compares a cover with a raw margin, which is
     two different quantities under one heading. */
  const results = [
    game({ win: "ann", lose: "bob", chance: null, score: "56-0", pts: 3 }),
    game({ win: "bob", lose: "ann", chance: 0.30, score: "20-17", pts: 3, exp: -7 }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(names(a.blowout), ["bob"], "an unpriced game reached the blowout");
  assert.deepEqual(names(a.upset), ["bob"], "an unpriced game reached the upset");
  assert.deepEqual(names(a.heartbreaker), ["ann"], "an unpriced game reached the heartbreaker");
});

test("the blowout is beaten by covering, not by winning big", () => {
  /* The whole point of the change. A 40-point favourite scraping home is a
     bad Saturday however large the scoreboard says the margin was, and a
     touchdown underdog winning by three touchdowns is the best result of the
     week even though the margin is half the other one's. */
  const results = [
    game({ win: "ann", lose: null, chance: 0.97, score: "52-7", exp: 41 }),
    game({ win: "bob", lose: null, chance: 0.30, score: "28-7", exp: -7 }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  /* ann won by 45 and was meant to win by 41: four points. bob won by 21 and
     was meant to lose by seven: twenty-eight. */
  assert.deepEqual(names(a.blowout), ["bob"]);
  assert.equal(a.blowout.holders[0].value, 28);
  assert.equal(a.blowout.runnerUp.value, 4);
});

test("nobody wins the blowout for failing to cover by the least", () => {
  /* The bug this closes. Once the award is measured against the number rather
     than against nought, a week in which no rostered favourite covers has
     nothing but negative candidates - and with no floor the trophy went to
     whoever missed by least, printing "Blowout: -7 on the line" on a card.
     Reachable on the first Saturday of a real season, where three or four
     priced rostered wins is the whole sample.

     A cover of exactly nought is a push, and pushing is not beating the
     number, so the floor is strict. */
  const results = [
    game({ win: "ann", lose: null, chance: 0.83, score: "24-21", exp: 14 }),
    game({ win: "bob", lose: null, chance: 0.79, score: "20-17", exp: 10 }),
    game({ win: "cat", lose: null, chance: 0.72, score: "27-20", exp: 7 }),
  ];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.deepEqual(a.blowout.holders, [], "a negative cover took the blowout");
  assert.equal(a.blowout.runnerUp, null);
});

test("a pick-em blowout is the margin itself, because nought was the number", () => {
  const results = [game({ win: "ann", lose: null, chance: 0.5, score: "31-10", exp: 0 })];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.equal(a.blowout.holders[0].value, 21);
});

test("the blowout names the line it beat, not only the score", () => {
  /* A cover is a subtraction, and a card showing only one of the two numbers
     asks the reader to take the other on trust. */
  const results = [game({ win: "ann", lose: "bob", chance: 0.30, score: "28-7", exp: -7 })];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})] }));
  assert.match(a.blowout.holders[0].detail, /28-7/);
  assert.match(a.blowout.holders[0].detail, /X -3\.5/, "the line is not on the card");
});

test("nobody's trophy is won by a team nobody drafted", () => {
  /* results carries every game a rostered team played, including the ones it
     lost to a school nobody took. Those rows have no manager on the winning
     side, and an award is a thing a manager holds. */
  const results = [
    game({ win: null, lose: "ann", chance: 0.10, score: "60-0", pts: 0, exp: -20 }),
    /* Wins by 24 as a six-point favourite, so it clears the blowout's floor.
       A 24-21 win at that price would not, which is the floor working. */
    game({ win: "bob", lose: null, chance: 0.80, score: "45-21", pts: 3, exp: 6 }),
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
/* the civil war, which is a subtraction and not a count               */
/* ------------------------------------------------------------------ */

test("the civil war counts the points the losing side would have banked", () => {
  /* A manager who owns both teams in a game banks one team's points and loses
     the other's. What is gone is the *loser's* value, because that is the team
     that would have won those points against anybody else. Valuing the winner
     instead would report a manager as unluckiest when their better team won,
     which is the opposite of what happened. */
  const results = [
    /* ann's p4 team lost to her own g5 team: three points gone, not two. */
    game({ win: "ann", lose: "ann", same: true, score: "20-17" }),
  ];
  const standings = standingsOf({ ann: { "ann-W": "g5", "ann-L": "p4" } });
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})],
                               standings, scoring: SCORING }));
  assert.deepEqual(names(a.civilWar), ["ann"]);
  assert.equal(a.civilWar.holders[0].value, 3);
  assert.equal(a.civilWar.unit, "points");
});

test("the civil war accumulates over the season", () => {
  const results = [
    game({ w: "0|01", win: "ann", lose: "ann", same: true }),
    game({ w: "0|02", win: "ann", lose: "ann", same: true }),
    game({ w: "0|02", win: "bob", lose: "bob", same: true }),
  ];
  const standings = standingsOf({
    ann: { "ann-W": "p4", "ann-L": "g5" },
    bob: { "bob-W": "p4", "bob-L": "p4" },
  });
  const byWeek = [week("0|01", "Week 1", {}), week("0|02", "Week 2", {})];
  const a = byId(buildAwards({ results, byWeek, standings, scoring: SCORING }));
  /* ann has lost two g5 teams' worth, bob one p4 team's worth. Four beats three. */
  assert.deepEqual(names(a.civilWar), ["ann"]);
  assert.equal(a.civilWar.holders[0].value, 4);
  assert.equal(a.civilWar.runnerUp.manager, "bob");
  assert.equal(a.civilWar.runnerUp.value, 3);
});

test("the civil war says how many games are behind the number", () => {
  /* A points total with one fixture named under it reads as that fixture's
     score. Two games have to say two. */
  const results = [
    game({ w: "0|01", win: "ann", lose: "ann", same: true }),
    game({ w: "0|02", win: "ann", lose: "ann", same: true, score: "31-3" }),
  ];
  const standings = standingsOf({ ann: { "ann-W": "p4", "ann-L": "g5" } });
  const byWeek = [week("0|01", "Week 1", {}), week("0|02", "Week 2", {})];
  const one = byId(buildAwards({ results: results.slice(0, 1), byWeek: byWeek.slice(0, 1),
                                 standings, scoring: SCORING }));
  const two = byId(buildAwards({ results, byWeek, standings, scoring: SCORING }));
  assert.doesNotMatch(one.civilWar.holders[0].detail, /games/);
  assert.match(two.civilWar.holders[0].detail, /^2 games/);
  assert.match(two.civilWar.holders[0].detail, /Week 2/, "the latest game is not the one named");
});

test("a civil war the payload cannot value is left out rather than guessed", () => {
  /* Without a tier for the losing team there is no number, and inventing one -
     a count, or the winner's value - would publish a figure nobody could check
     against a roster. The award simply has no candidate. */
  const results = [game({ win: "ann", lose: "ann", same: true })];
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})],
                               standings: [], scoring: SCORING }));
  assert.deepEqual(a.civilWar.holders, []);
});

test("a manager whose teams never met holds no civil war trophy", () => {
  const results = [game({ win: "ann", lose: "bob", same: false })];
  const standings = standingsOf({ ann: { "ann-W": "p4" }, bob: { "bob-L": "p4" } });
  const a = byId(buildAwards({ results, byWeek: [week("0|01", "Week 1", {})],
                               standings, scoring: SCORING }));
  assert.deepEqual(a.civilWar.holders, []);
  assert.equal(a.civilWar.runnerUp, null);
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
