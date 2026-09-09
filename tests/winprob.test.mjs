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

test("sigma is one named constant, and it is 14.4", () => {
  /* Named rather than inlined because it is an assumption about college
     football and not a fact about probability. This test exists so that
     changing it is a deliberate act with a red test attached - it was 16 until
     it was fitted to the data in the calibration test below. */
  assert.equal(SIGMA, 14.4);
});

/* Stassen.com's tabulation of BCS-era college football, 1999-2010: for each
   price, how many games the favourite won out of how many it laid. 9,626 games
   in all. This is the evidence sigma was fitted to, and keeping it here is what
   turns "14.4" from a number somebody once typed into a claim that can be
   rechecked - including by whoever wants to argue it should be something else.

   Buckets under 100 games are left out: at n=47 the sampling noise is wider
   than the thing being measured. */
const STASSEN = [
  [1, 125, 243], [1.5, 95, 211], [2, 132, 206], [2.5, 179, 396], [3, 328, 587],
  [3.5, 293, 483], [4, 156, 241], [4.5, 145, 241], [5, 115, 173], [5.5, 124, 206],
  [6, 178, 276], [6.5, 266, 372], [7, 299, 433], [7.5, 243, 328], [8, 126, 186],
  [8.5, 129, 179], [9, 104, 142], [9.5, 115, 162], [10, 190, 248], [10.5, 116, 155],
  [11, 102, 141], [11.5, 98, 124], [12, 105, 124], [12.5, 105, 123], [13, 111, 147],
  [13.5, 206, 253], [14, 182, 220], [14.5, 126, 148], [15, 95, 106], [16.5, 109, 129],
  [17, 118, 130], [17.5, 111, 125], [20, 100, 106], [21, 139, 141],
];

test("sigma is the best fit to the observed win rates, not a round number", () => {
  /* Maximum likelihood over the table above. If someone changes SIGMA, this
     says whether they moved it toward the data or away from it. */
  const logLik = (sigma) => STASSEN.reduce((L, [spread, won, n]) => {
    const p = phi(spread / sigma);
    return L + won * Math.log(p) + (n - won) * Math.log(1 - p);
  }, 0);

  let best = { sigma: 0, L: -Infinity };
  for (let sigma = 10; sigma <= 24; sigma += 0.01) {
    const L = logLik(sigma);
    if (L > best.L) best = { sigma, L };
  }
  /* Within a quarter point of the fit. Tighter than that would be asserting
     the third decimal of a number whose sample is a decade old. */
  assert.ok(Math.abs(best.sigma - SIGMA) < 0.25,
    `the data fits sigma ${best.sigma.toFixed(2)}, the constant says ${SIGMA}`);
  assert.ok(logLik(SIGMA) > logLik(16),
    "16 now explains the observed win rates better than the constant does");
});

test("the normal is the right shape, not just the right width", () => {
  /* A sigma can be fitted to any monotone curve and still be describing the
     wrong distribution. Grouped into bands, the model has to land on the
     observed rate to within noise at every price, not only on average.

     Short prices are excluded here and get a test of their own below, because
     the model is knowingly wrong about them. */
  const bands = [[4, 7], [7.5, 10.5], [11, 14.5], [15, 21]];
  /* deliberately starts at 4: see "short favourites" below */
  for (const [lo, hi] of bands) {
    let won = 0, n = 0, expected = 0;
    for (const [spread, w, g] of STASSEN) {
      if (spread < lo || spread > hi) continue;
      won += w; n += g; expected += g * phi(spread / SIGMA);
    }
    const actual = won / n;
    const model = expected / n;
    /* Two standard errors of the observed rate. */
    const se = Math.sqrt((model * (1 - model)) / n);
    assert.ok(Math.abs(actual - model) < 2 * se,
      `spreads ${lo}-${hi}: observed ${(actual * 100).toFixed(1)}%, ` +
      `model ${(model * 100).toFixed(1)}%, over ${n} games`);
  }
});

/* Phil Steele, college football 1997-2023, 20,505 games: how often the
   underdog won outright, by band of spread. A second sample, a different
   decade, and counted from the other side - which is what makes it worth
   carrying next to Stassen rather than instead of it. */
const STEELE = [
  { lo: 0, hi: 3, n: 3118, dog: 0.475 },
  { lo: 3.5, hi: 7, n: 4837, dog: 0.354 },
  { lo: 7.5, hi: 10, n: 2510, dog: 0.261 },
  { lo: 10.5, hi: 14, n: 2769, dog: 0.201 },
  { lo: 14.5, hi: 17, n: 1647, dog: 0.131 },
  { lo: 17.5, hi: 24, n: 2571, dog: 0.0739 },
];

/* Spreads are not spread evenly inside a band - short prices are far more
   common - so a band's midpoint overstates its typical game. The weights come
   from Stassen's per-bucket game counts, which is the one thing that table is
   unimpeachable about however noisy its win rates are. */
const bandDogRate = (band, sigma) => {
  let games = 0, dogs = 0;
  for (const [spread, n] of STASSEN.map(([s, , g]) => [s, g])) {
    if (spread < band.lo || spread > band.hi) continue;
    games += n;
    dogs += n * (1 - phi(spread / sigma));
  }
  return dogs / games;
};

test("a second sample, counted from the underdog's side, agrees", () => {
  /* Stassen could be wrong in a way that a fit to Stassen would never show.
     This is the guard against that: an independent tabulation, and the
     constant has to sit close to what it implies too. */
  let best = { sigma: 0, L: -Infinity };
  for (let sigma = 10; sigma <= 24; sigma += 0.01) {
    const L = STEELE.reduce((acc, b) => {
      const p = bandDogRate(b, sigma);
      const dogs = Math.round(b.n * b.dog);
      return acc + dogs * Math.log(p) + (b.n - dogs) * Math.log(1 - p);
    }, 0);
    if (L > best.L) best = { sigma, L };
  }
  const games = STEELE.reduce((n, b) => n + b.n, 0);
  assert.ok(Math.abs(best.sigma - SIGMA) < 0.4,
    `Steele's ${games} games fit sigma ${best.sigma.toFixed(2)}, the constant says ${SIGMA}`);
});

test("the model is knowingly wrong about short favourites, in a known direction", () => {
  /* Both sources say a game priced inside a field goal is closer to a coin
     flip than a normal centred on the spread makes it: Stassen's 0.5-3.5 band
     runs 2.8 points below the model, Steele's "+3 or less" 3.6 points below.
     Two samples built differently agreeing on direction and rough size is not
     noise, so this is a property of the model rather than a defect in a table.

     It is not corrected: fitting a second parameter to two band-level numbers
     is an epicycle with nothing left to validate it against, and short prices
     are ~15% of games, so a manager's season is off by on the order of a tenth
     of an expected win. This test exists so the bias stays a known one - if it
     ever inverts or trebles, that is worth finding out from a red test rather
     than from a reader. */
  const short = STEELE[0];
  assert.equal(short.lo, 0);
  const model = bandDogRate(short, SIGMA);
  const gap = short.dog - model;
  assert.ok(gap > 0,
    `short underdogs used to beat the model; now they win ${(short.dog * 100).toFixed(1)}% ` +
    `against a modelled ${(model * 100).toFixed(1)}%`);
  assert.ok(gap < 0.08,
    `the short-price bias has grown to ${(gap * 100).toFixed(1)} points, which is no longer small`);
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

  /* One point of the spread against sigma, spelled out: a favourite laying
     exactly sigma is a one-sigma favourite, which is phi(1). If sigma ever
     moves, this is the assertion that says what moved. */
  close(favouriteProbability(SIGMA), 0.8413447461, "a one-sigma favourite");
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

test("the ledger weighs games by what the team is worth", () => {
  /* Which is what separates this from the expected *record* in byWeek: there
     every game counts one, here a power-conference win is worth three. The two
     can point opposite ways, and both are true. */
  const cheapWins = [
    outcome(2, 0.4, true),
    outcome(2, 0.4, true),
    outcome(3, 0.9, false),
  ];
  const l = luckOf(cheapWins);
  /* Two wins from 1.7 expected is ahead of the market on the record, and 4
     points from 4.3 expected is behind it on the board. */
  assert.equal(l.actual, 4);
  assert.equal(l.expected, 4.3);
  assert.ok(l.delta < 0, `${l.actual} banked against ${l.expected} expected`);
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
