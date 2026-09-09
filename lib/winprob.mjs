/**
 * Turning a betting line into a probability, and a probability into points.
 *
 * The whole model is one line:
 *
 *     P(the favourite wins) = phi(|spread| / SIGMA)
 *
 * A spread is the market's estimate of the median margin. Actual margins land
 * around it with a spread of their own, so the chance the favourite simply
 * wins - margin above zero - is the mass of that distribution on one side of a
 * point |spread| below its mean. Treat the scatter as normal and that is a
 * standard normal CDF, which is the only reason a normal CDF is in this repo.
 *
 * Nothing here reads a game, a roster or a payload: it takes a stored line and
 * a school name and gives back a number. The summing per manager stays in
 * build-standings.mjs, where the tiers and the owners are.
 *
 * Same plain-ESM-with-JSDoc arrangement as lib/games.mjs, so the builder and
 * the components import this one file and cannot disagree about the model.
 *
 * @typedef {{spread: number | null, favorite: string | null} | null | undefined} Line
 */

/**
 * The standard deviation, in points, of college-football results against the
 * closing spread. Roughly: results land about two touchdowns either side of
 * the number, more often than the number is wrong by more.
 *
 * **Fitted, not assumed.** It was 16 - a round number picked off the middle of
 * a range of published estimates - until it was fitted to Stassen's tabulation
 * of 9,626 BCS-era games (1999-2010), which reports, bucket by bucket, how
 * often a favourite laying each price actually won. Maximum likelihood over
 * the 8,516 of those with a real price gives **14.43**, and the answer barely
 * moves under any reasonable cut of the data:
 *
 * | data | sigma |
 * |---|---|
 * | every priced bucket, 8,516 games | 14.43 |
 * | spreads 1 to 21 | 14.38 |
 * | buckets of 150 games or more | 14.74 |
 * | spreads 4 and up | 14.31 |
 *
 * 14.4 is the round number in the middle of *that*, and it beats 16 on the
 * same data by every measure: weighted RMS error against the observed win
 * rates falls from 4.61% to 4.30%, and a 7-point favourite comes out at 68.6%
 * against the 69.05% actually observed, where 16 said 66.9%.
 *
 * **The shape holds too, which is the part worth checking.** Grouped into six
 * bands of spread, five of the six sit within 0.6 points of the model - well
 * inside one standard error. Only the smallest band, 0.5 to 3.5, is off, at
 * 2.8 points low; that is also where the source's own buckets alternate
 * implausibly (1.5-point favourites at 45.0%, 2-point at 64.1%, 2.5-point at
 * 45.2%, three adjacent buckets that cannot all be right), so it reads as a
 * fault in the tabulation rather than a fault in the normal. Nothing here
 * bends the model to fit it. Separately, Boyd's Bets finds essentially no
 * correlation between the size of the spread and the size of the scatter in
 * college football - 0.09 - which is the assumption a single sigma makes.
 *
 * **It is still a modelling assumption, and still one named constant** so that
 * it can be argued with in one place. The sample is a decade old, sigma moves
 * a little with the seasons sampled and with whether garbage time is trimmed,
 * and every probability in this repo is only as good as it is.
 *
 * Bigger sigma pulls every probability toward 50% - more upsets, flatter
 * expectations, smaller luck numbers. Smaller sigma does the reverse, so this
 * change makes every favourite a slightly stronger one and every expected
 * record slightly more top-heavy. Nothing downstream tunes it, and nothing
 * should treat these numbers as more precise than a whole percentage point.
 */
export const SIGMA = 14.4;

/**
 * Abramowitz & Stegun 7.1.26. Maximum absolute error 1.5e-7, which is four
 * orders of magnitude finer than anything this file publishes and needs no
 * dependency, which is the constraint that picked it.
 *
 * @param {number} x
 */
export function erf(x) {
  /* The approximation is stated for x >= 0 only. erf is odd, so the negative
     half is the reflection rather than a second set of coefficients. */
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 +
    t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-z * z));
}

/**
 * The standard normal CDF: the share of outcomes at or below z sigmas.
 *
 * @param {number} z
 */
export function phi(z) {
  /* Special-cased rather than left to the approximation, because half of the
     mass below the mean is exact and a caller comparing a pick-em against 0.5
     should not have to carry a tolerance to do it. */
  if (z === 0) return 0.5;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * The chance the favourite wins outright, from the size of the price.
 *
 * The stored spread is signed from the home team's perspective, so a -7 home
 * favourite and a +7 away one are the same seven-point favourite: the sign
 * says who, the magnitude says how much, and only the magnitude is the model's
 * business.
 *
 * @param {number} spread
 * @returns {number} in [0.5, 1)
 */
export const favouriteProbability = (spread) => phi(Math.abs(spread) / SIGMA);

/**
 * The chance one named team wins, from the line stored for its game.
 *
 * `null` for a game with no line, and deliberately not 0.5. An unpriced game is
 * not a coin flip we happen to know nothing about; it is a game this model has
 * nothing to say about. Handing back a half would let it be summed into an
 * expectation as if it were information, which is how a luck number quietly
 * comes to ignore the half of the season the books never reached.
 *
 * @param {Line} line
 * @param {string} team
 * @returns {number | null}
 */
export function winProbability(line, team) {
  if (!line || typeof line.spread !== "number") return null;
  /* No favourite is a pick-em, and both sides of a pick-em are even money. The
     builder reads the same field to decide that a pick-em can never be an
     upset, so the two agree by construction. */
  if (!line.favorite) return 0.5;
  const p = favouriteProbability(line.spread);
  return line.favorite === team ? p : 1 - p;
}

/**
 * One decimal place, and no negative zero.
 *
 * A second decimal would claim a precision sigma does not have. Math.round
 * gives -0 for a shortfall too small to show, which JSON.stringify publishes
 * as `-0` and the page would print as a suspiciously unlucky nothing.
 *
 * @param {number} n
 */
export const round1 = (n) => Math.round(n * 10) / 10 + 0;

/**
 * A probability as a whole percent, or "" for a game with no line.
 *
 * Lives with the model rather than in lib/format.mjs because the rounding is
 * part of the honesty: sigma is a guess to within a point or two, so a decimal
 * place on a win probability would be reading tea leaves aloud.
 *
 * Anything short of a certainty prints short of 100%. A 45-point favourite
 * comes back at 0.9975 and would round to a flat 100, which is the one number
 * this model is never entitled to say - and it is the number a reader would
 * quote back after the upset.
 *
 * @param {number | null | undefined} p
 */
export function percent(p) {
  if (typeof p !== "number") return "";
  const n = Math.round(p * 100);
  if (n >= 100 && p < 1) return "99%";
  if (n <= 0 && p > 0) return "1%";
  return `${n}%`;
}

/**
 * Points banked against points expected, over a ledger of settled team-games.
 *
 * Positive means running hot: the teams won more than the market said they
 * would. Negative means the reverse. It is *not* a claim about who deserves to
 * win the league - a manager who drafted five heavy favourites is expected to
 * bank a lot, and banking exactly that is luck of zero.
 *
 * Both sides are published so the number can be checked rather than believed,
 * and `delta` is derived from the *published* expected rather than the
 * full-precision one, so the three numbers on screen add up to the digit.
 *
 * Points only. The same probabilities summed *without* the tier weighting are
 * a manager's expected record, and that lives in `byWeek[].cumulative` rather
 * than here, because a record is a thing that accumulates week by week and
 * this is a single season-to-date figure. Computing it in both places is how
 * the two would come to disagree.
 *
 * The caller decides what goes in the ledger. Games with no line must not:
 * see winProbability.
 *
 * @param {{value: number, probability: number, won: boolean}[]} outcomes
 * @returns {{games: number, actual: number, expected: number, delta: number}}
 */
export function luckOf(outcomes) {
  let actual = 0, expected = 0;
  for (const o of outcomes) {
    if (o.won) actual += o.value;
    expected += o.probability * o.value;
  }
  const e = round1(expected);
  return { games: outcomes.length, actual, expected: e, delta: round1(actual - e) };
}
