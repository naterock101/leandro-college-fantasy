/**
 * The win-probability model, on its own, with no builder and no payload.
 *
 * Everything here is arithmetic over numbers that were made up on purpose, so
 * it needs no fixture and cannot flake. The point of testing it in isolation is
 * that sigma is a modelling assumption: if somebody changes it, exactly one of
 * these files should go red, and it should be this one and not the golden.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SIGMA, erf, phi, favouriteProbability, winProbability, luckOf, round1, percent,
} from "../lib/winprob.mjs";

/* Values from a table rather than from our own implementation, so this is a
   check and not a tautology. Abramowitz & Stegun 7.1.26 claims |error| < 1.5e-7
   on erf, and phi inherits it, so 1e-6 is loose enough to pass and tight enough
   to catch a wrong coefficient. */
const close = (actual, expected, why, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tol,
    `${why}: got ${actual}, expected ${expected} (+/- ${tol})`);

/* ------------------------------------------------------------------ */
/* the normal CDF                                                      */
/* ------------------------------------------------------------------ */

test("erf matches its published values", () => {
  close(erf(0), 0, "erf(0)");
  close(erf(0.5), 0.5204998778, "erf(0.5)");
  close(erf(1), 0.8427007929, "erf(1)");
  close(erf(2), 0.9953222650, "erf(2)");
  /* erf is odd, and the A&S approximation is only defined for x >= 0, so the
     negative half is a reflection somebody has to write. This is the assertion
     that says they did. */
  close(erf(-1), -0.8427007929, "erf(-1)");
});

test("phi matches its published values", () => {
  assert.equal(phi(0), 0.5, "phi(0) must be exactly a half, not nearly one");
  close(phi(1), 0.8413447461, "phi(1)");
  close(phi(-1), 0.1586552539, "phi(-1)");
  close(phi(2), 0.9772498681, "phi(2)");
  close(phi(-2), 0.0227501319, "phi(-2)");
  close(phi(3), 0.9986501020, "phi(3)");
});

test("phi is symmetric and never leaves [0,1]", () => {
  for (const z of [-6, -3.3, -1, -0.25, 0, 0.25, 1, 3.3, 6]) {
    close(phi(z) + phi(-z), 1, `phi(${z}) + phi(-${z})`);
    assert.ok(phi(z) >= 0 && phi(z) <= 1, `phi(${z}) is outside [0,1]`);
  }
  /* Monotonic, because a longer price must never come back as a worse chance.
     A sign slip inside the approximation passes every symmetry check above and
     fails this one. */
  let prev = -Infinity;
  for (let z = -4; z <= 4; z += 0.1) {
    assert.ok(phi(z) >= prev, `phi is not monotonic at ${z}`);
    prev = phi(z);
  }
});

/* ------------------------------------------------------------------ */
/* the model                                                           */
/* ------------------------------------------------------------------ */

test("sigma is one named constant, and it is 16", () => {
  /* Named rather than inlined because it is an assumption about college
     football and not a fact about probability. This test exists so that
     changing it is a deliberate act with a red test attached. */
  assert.equal(SIGMA, 16);
});

test("a pick-em is exactly 50%, from either side", () => {
  assert.equal(favouriteProbability(0), 0.5);
  const pk = { spread: 0, favorite: null, formatted: "PK" };
  assert.equal(winProbability(pk, "UNLV"), 0.5);
  assert.equal(winProbability(pk, "Hawai'i"), 0.5);
  /* Neither side is favoured, so neither side can be beaten as the favourite -
     which is the same reason the builder can never tag a pick-em an upset. */
  assert.equal(pk.favorite, null);
});

test("the favourite's chance rises with the price and never reaches certainty", () => {
  /* The stored spread is signed from the home team's perspective, so the model
     has to read the magnitude. A -24.5 home favourite and a +24.5 away one are
     the same 24.5-point favourite. */
  assert.equal(favouriteProbability(-24.5), favouriteProbability(24.5));

  const prices = [0, 2.5, 3.5, 6.5, 10.5, 21.5, 24.5, 45];
  let prev = 0.5 - 1e-12;
  for (const s of prices) {
    const p = favouriteProbability(s);
    assert.ok(p >= prev, `${s} is not at least as strong a favourite as the last`);
    assert.ok(p >= 0.5, `a favourite laying ${s} came back under even money`);
    assert.ok(p < 1, `a favourite laying ${s} came back a certainty`);
    prev = p;
  }

  /* One point of the spread against sigma, spelled out: a 16-point favourite is
     a one-sigma favourite, which is phi(1). If sigma ever moves, this is the
     assertion that says what moved. */
  close(favouriteProbability(16), 0.8413447461, "a 16-point favourite");
  close(favouriteProbability(3.5), phi(3.5 / SIGMA), "a 3.5-point favourite");
});

test("the two sides of a priced game sum to one, and an unpriced game has no probability", () => {
  const line = { spread: -6.5, favorite: "Texas A&M", formatted: "Texas A&M -6.5" };
  const fav = winProbability(line, "Texas A&M");
  const dog = winProbability(line, "Arizona State");
  close(fav + dog, 1, "the two sides");
  assert.ok(fav > dog, "the favourite came back the underdog");

  /* null, not 0.5. A game nobody priced is not a coin flip we happen to know
     nothing about - it is a game this model has nothing to say about, and every
     caller has to be made to decide what to do with that. */
  assert.equal(winProbability(null, "Texas A&M"), null);
  assert.equal(winProbability(undefined, "Texas A&M"), null);
  assert.equal(winProbability({ spread: null, favorite: null }, "Texas A&M"), null);
});

/* ------------------------------------------------------------------ */
/* luck                                                                */
/* ------------------------------------------------------------------ */

/** A team-game as the builder hands it over: what it was worth, the model's
    chance of winning it, and whether it was won. */
const outcome = (value, probability, won) => ({ value, probability, won });

test("luck is what was banked less what was expected", () => {
  const l = luckOf([
    outcome(3, 0.75, true),   // banked 3, expected 2.25
    outcome(2, 0.4, false),   // banked 0, expected 0.8
  ]);
  assert.equal(l.games, 2);
  assert.equal(l.actual, 3);
  assert.equal(l.expected, 3.1);
  assert.equal(l.delta, -0.1);
  /* The published delta is the published actual less the published expected,
     to the digit. Rounding expected and then subtracting from a full-precision
     sum would print three numbers that do not add up, in a column whose whole
     job is to be checked by eye. */
  assert.equal(l.delta, round1(l.actual - l.expected));
});

test("expected points can never exceed the points that were available", () => {
  const outcomes = [outcome(3, 0.99, true), outcome(2, 0.5, false), outcome(3, 0.01, false)];
  const available = outcomes.reduce((s, o) => s + o.value, 0);
  const l = luckOf(outcomes);
  assert.ok(l.expected <= available, `expected ${l.expected} of a possible ${available}`);
  assert.ok(l.expected >= 0, "expected points went negative");
  assert.ok(l.actual <= available, "banked more than was on offer");
});

test("an empty ledger is zero, not a hole", () => {
  assert.deepEqual(luckOf([]), { games: 0, actual: 0, expected: 0, delta: 0 });
});

test("when every favourite holds, backing favourites is never unlucky", () => {
  /* The chalk season. Every game went the way the book said, so a manager whose
     teams were all favourites banked at least what the model expected of them:
     each win pays value and cost value*p, and p <= 1. */
  const lines = [-3.5, -10.5, -24.5, 0, 6.5];
  const chalk = lines.map((s) => outcome(3, favouriteProbability(s), true));
  const l = luckOf(chalk);
  assert.ok(l.delta >= 0, `a chalk season came back ${l.delta}`);

  /* And the honest other half, which the plan's phrasing skips: the same chalk
     season is *negative* for whoever owned the beaten underdogs. That is the
     model working, not a defect - an underdog is expected to win sometimes, so
     losing every one of them is below expectation. Luck is only signed one way
     for a manager who owned only favourites. */
  const dogs = lines.map((s) => outcome(3, 1 - favouriteProbability(s), false));
  assert.ok(luckOf(dogs).delta <= 0, "a season of beaten underdogs came back lucky");

  /* Which is why it nets out: one game, both sides drafted at the same tier,
     and the two managers' luck cancels whichever way it went. */
  for (const won of [true, false]) {
    const p = favouriteProbability(-7);
    const a = luckOf([outcome(3, p, won)]);
    const b = luckOf([outcome(3, 1 - p, !won)]);
    close(a.delta + b.delta, 0, `both sides of a game the favourite ${won ? "won" : "lost"}`, 0.11);
  }
});

/* ------------------------------------------------------------------ */
/* presentation                                                        */
/* ------------------------------------------------------------------ */

test("a probability reads as a whole percent", () => {
  assert.equal(percent(0.5), "50%");
  assert.equal(percent(0.8413447461), "84%");
  assert.equal(percent(0.005), "1%");
  assert.equal(percent(null), "");
  /* Nothing short of a certainty is allowed to print as one. A 45-point
     favourite is 99.75% under this model, and 100% is the single number it can
     never earn - it is also the one a reader would quote back after the upset.
     A true 1 is still 100%, because that is a caller stating a fact and not
     this model guessing. */
  assert.equal(percent(favouriteProbability(45)), "99%");
  assert.equal(percent(0.9999), "99%");
  assert.equal(percent(1), "100%");
  assert.equal(percent(0.00001), "1%");
  assert.equal(percent(0), "0%");
  /* One decimal on luck, none on a probability. Sigma is a guess to within a
     couple of points, so a second decimal on either would be theatre. */
  assert.equal(round1(3.14159), 3.1);
  /* A shortfall too small to show must round to zero and not to "-0", which is
     what Math.round gives back and what JSON.stringify would then publish. */
  assert.ok(Object.is(round1(-0.04), 0), `round1(-0.04) came back ${round1(-0.04)}`);
});
