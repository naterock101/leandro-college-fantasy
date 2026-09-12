/**
 * The shape of the race, as numbers: who was on what total, when.
 *
 * Split out of the chart rather than living in it because all of this is
 * arithmetic on two arrays and none of it needs a DOM. It runs under
 * `node --test` with the rest of `lib/`, which is where the invariant that
 * matters - the drawn line never contradicts the payload - is cheapest to
 * pin down.
 *
 * The chart used to plot one point per week, because `byWeek[].cumulative` is
 * the only running total the payload states outright. A week is not a tidy
 * slice of anything, though: the live season's first bucket holds 65 games
 * across ten days, and drawing that as one dot throws away every lead change
 * inside it. `results` carries the games themselves, in order, and the Trends
 * tab already fetches it for the head-to-head matrix - so the finer picture
 * costs no extra request.
 */

/* x runs 0..1 across the whole season and every week gets an equal slice of
   it, rather than a slice proportional to how many games it holds.

   Equal-per-game was the first cut and it is wrong at the end of the season,
   which is the half that decides anything: a regular week carries 50-odd
   games with a drafted team in it and conference championship week carries
   eight, so the week that settles the title would be drawn about one percent
   as wide as a Saturday in September. Equal-per-week also keeps the vertical
   gridlines evenly spaced, which is what lets this chart still be compared
   against a screenshot of last week's. */
const span = (i, n) => i / n;

/**
 * One manager's total out of a week's `cumulative`, or null.
 *
 * `Object.hasOwn` rather than a plain lookup, because a manager keyed
 * "constructor" or "toString" finds Object.prototype instead - and then a
 * `.points` of undefined is arithmetic on NaN for the rest of the season.
 *
 * The `typeof` is the other half and is not belt and braces: the old chart
 * read this as `?.points ?? null`, so a cumulative entry that was null, or a
 * bare number, or anything else the bot might write, drew a dash. Reading it
 * as `cum[m].points` throws instead, and there is no error boundary under
 * `app/` - a payload one field out would blank the whole page rather than
 * leave one cell empty.
 */
const scored = (cum, m) => {
  const cell = Object.hasOwn(cum, m) ? cum[m] : undefined;
  return typeof cell?.points === "number" ? cell.points : null;
};

/** Managers on the payload, in either list, sorted. Same union the chart uses. */
const unionOf = (byWeek, managers) =>
  [...new Set([...managers, ...byWeek.flatMap((w) => Object.keys(w.cumulative ?? {}))])].sort();

/**
 * One frame per game, or one per week when `results` has not arrived.
 *
 * A frame is a moment in the season and everybody's total at it. The frames
 * are shared - every manager has a value at every frame - because the chart
 * draws eight lines against one x axis, and a line that only had points where
 * its own manager happened to play would slope between two Saturdays as if
 * something had happened in between.
 *
 * Week boundaries are **snapped to `byWeek[].cumulative`** rather than left at
 * whatever summing `results` produced. Both agree today - summing the live
 * `results` reproduces every manager's weekly total exactly - but they are two
 * different statements in two different files, and only one of them is the
 * payload's answer to "what is the score". The per-game path is detail drawn
 * between two numbers it does not get to contradict; if `results` is ever
 * short a game, the line wobbles and the week still lands on the truth.
 *
 * @param {any[]} byWeek        the payload's weeks, oldest first
 * @param {any[]} results       every scored game, oldest first; may be empty
 * @param {string[]} managers   the standings list
 */
export function raceFrames(byWeek, results, managers = []) {
  const all = unionOf(byWeek, managers);
  const weeks = byWeek.map((w, i) => ({
    key: w.key,
    label: w.label,
    short: w.seasonType === "postseason" ? `P${w.week}` : `W${w.week}`,
    x0: span(i, byWeek.length),
    x1: span(i + 1, byWeek.length),
    /* Where the label goes, which is not always the middle. Filled in below,
       because it depends on whether the week is a span of games or a single
       dot - and a label that is not over its own data is a chart that is
       lying quietly. */
    at: 0,
  }));

  /* A manager absent from a week did not score nothing that week - they were
     not in the payload. `null` is a hole in the line, not a zero on the
     floor, and it is what the hidden table prints as a dash. */
  const blank = () => Object.fromEntries(all.map((m) => [m, null]));

  /* Games grouped by the week they belong to, in the order the builder wrote
     them - `key` then kickoff, so this is the order they were played. Only
     weeks the payload actually scored get drawn: `byWeek` is the authority on
     which weeks exist, and a stray result for a week that is not in it would
     otherwise invent a column. */
  const byKey = new Map(weeks.map((w) => [w.key, []]));
  for (const g of results ?? []) if (byKey.has(g.key)) byKey.get(g.key).push(g);
  const perGame = [...byKey.values()].some((g) => g.length > 0);

  const frames = [];
  /* Everyone starts level, which is what makes it a race. Only the managers
     the first scored week knows about: a mid-season joiner has no business
     being drawn on the start line of a season they were not in.

     Only when there are games to draw between here and the first Saturday.
     Without `results` the next frame is a whole week away, and a line from
     nought to a week-one total would be claiming a climb this chart cannot
     see - the same reason one week has never been drawn as a trend. */
  const first = byWeek.length ? (byWeek[0].cumulative ?? {}) : {};
  const opening = blank();
  for (const m of all) if (scored(first, m) !== null) opening[m] = 0;
  if (perGame) frames.push({ x: 0, wi: 0, week: null, totals: opening });

  let running = { ...opening };
  weeks.forEach((w, wi) => {
    const games = byKey.get(w.key) ?? [];
    /* Spaced across every game the week holds, not only the ones that scored.
       A Saturday where a manager's team lost still took up an afternoon, and
       skipping those would bunch the scoring games together and draw a week
       that ran faster than it did. */
    const n = Math.max(games.length, 1);
    const before = frames.length;
    games.forEach((g, gi) => {
      const m = g.winner?.manager;
      if (!m || typeof g.points !== "number" || !g.points) return;
      if (typeof running[m] !== "number") return;
      running = { ...running, [m]: running[m] + g.points };
      frames.push({ x: w.x0 + ((gi + 1) / n) * (w.x1 - w.x0), wi, week: null, totals: running });
    });

    /* The week closes on the payload's own figure, whatever the games above
       added up to, and the running total carries on from there. */
    const cum = byWeek[wi].cumulative ?? {};
    const closed = blank();
    for (const m of all) closed[m] = scored(cum, m);
    running = { ...closed };
    /* Where the week's own point sits. */
    w.at = (w.x0 + w.x1) / 2;
    /* A week with games in it is a span and closes on its right-hand edge; a
       week without them is a single dot, and a dot belongs in the middle of
       the week it stands for rather than on the line between that week and
       the next. The label is always the middle, so getting this wrong puts a
       dot half a week to the right of its own name.

       Keyed on whether this week actually drew anything, which is neither
       `perGame` nor `games.length`. `perGame` is true as soon as any one week
       has games, and a season is routinely a mix - the bot writes a week into
       `byWeek` before `results` catches up. And a week can hold rows that all
       fail the guard above: every game in it won by a team nobody drafted is
       a real Saturday that moves nobody, and counting its rows would put its
       lone dot on the divider while its name sat half a week away. */
    const at = frames.length > before ? w.x1 : w.at;

    /* The last game of a week already sits on the boundary, so tag that frame
       rather than stacking a second one on the same coordinate. */
    const last = frames[frames.length - 1];
    if (last && Math.abs(last.x - at) < 1e-9) {
      last.totals = closed;
      last.week = w;
    } else {
      frames.push({ x: at, wi, week: w, totals: closed });
    }
  });

  return { all, weeks, frames, perGame };
}

/* Values the axis has to cover, nulls dropped. */
const live = (totals) =>
  Object.values(totals).filter((v) => typeof v === "number");

/**
 * The three questions this chart can answer, as y transforms.
 *
 * They exist because cumulative points against time is badly conditioned over
 * a season and no choice of x axis fixes it: the spread between managers grows
 * like the square root of the weeks played while everyone's total grows like
 * the weeks played, so the pack thins into a band and the drivers pile up. On
 * the live roster shape, simulating a full season, the pack ends up using
 * about a quarter of the plot's height on `points` against roughly
 * three quarters on either of the other two.
 *
 * `points` is still the default, because it is the only one whose y axis is a
 * number anybody says out loud, and because it is what the chart has always
 * drawn. The other two are a click away for the half of the season where it
 * stops being readable.
 */
export const VIEWS = {
  points: {
    label: "Total points",
    floorAtZero: true,
    down: false,
    y: (totals, m) => totals[m],
    caption: "Points after each week, cumulative.",
    gutter: "their total",
  },
  gap: {
    label: "Behind leader",
    floorAtZero: true,
    /* 0 at the top and the deficit growing downwards, which is the way every
       chart that has ever been called a gap chart is drawn. */
    down: true,
    y: (totals, m) => {
      if (typeof totals[m] !== "number") return null;
      const vs = live(totals);
      return vs.length ? Math.max(...vs) - totals[m] : 0;
    },
    caption: "Points behind the leader after each week.",
    gutter: "how far behind they are",
  },
  avg: {
    label: "vs Average",
    /* The only one that goes negative, and the reason the axis floor is not
       unconditionally clamped at zero. */
    floorAtZero: false,
    down: false,
    y: (totals, m) => {
      if (typeof totals[m] !== "number") return null;
      const vs = live(totals);
      return vs.length ? totals[m] - vs.reduce((a, b) => a + b, 0) / vs.length : 0;
    },
    caption: "Points above or below the league average after each week.",
    gutter: "how far off the league average they are",
  },
};

/**
 * The first week the short window covers, as an index.
 *
 * An index rather than a fraction of the width, because the two modes do not
 * put their points in the same places - a week with games in it closes on its
 * right-hand edge, a week without them is a dot in the middle - and a window
 * expressed as a fraction lands between points in one of them. The caller
 * turns this back into an x by asking which frames survive it.
 *
 * A window wider than the season is the whole season, not a division by a
 * number of weeks that have not happened. The league spends the first month of
 * every year in exactly that state - it is there now, on one scored week - and
 * the alternative is a chart that opens on a quarter of one Saturday.
 */
export function windowStart(weekCount, lastN) {
  if (!lastN || weekCount <= lastN) return 0;
  return weekCount - lastN;
}

/**
 * The slice of the scoreboard the plot covers, for whichever view is on.
 *
 * Fitted to the data rather than pinned, for the reason the chart has always
 * fitted it: the numbers this draws are far from zero and a scale that starts
 * there spends its height on the part of the season everybody has driven
 * through already. `floorAtZero` is the clamp for the two views that cannot
 * go negative - a total of -1 is not a thing and an axis that starts there
 * says it might be - and is off for `avg`, where below the line is the point.
 *
 * The top is the largest value exactly, not a rounded ceiling: rounding up
 * leaves the leading line short of the top of the plot, which reads as
 * everybody having further to go than they do.
 */
export function axisFor(values, { floorAtZero = true } = {}) {
  const vs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  const hi = vs.length ? Math.max(...vs) : 1;
  const lo = vs.length ? Math.min(...vs) : 0;
  const pad = Math.max(1, (hi - lo) / 10);
  const raw = Math.floor(lo - pad);
  const base = floorAtZero ? Math.max(0, raw) : raw;
  return { base, top: Math.max(hi, base + 1) };
}

/**
 * The indices where a line actually turns, plus its two ends.
 *
 * Cumulative points is a step function - a manager's line only turns on a game
 * they won - so on the `points` view most of the ~900 frames in a finished
 * season repeat the coordinate before them. Three collinear points draw
 * exactly what two do.
 *
 * Indices rather than the coordinates themselves, because the caller has to
 * keep some vertices this rule would drop - the week boundaries, which the
 * hidden table is checked against - and a flat run is by definition several
 * frames carrying the *same* coordinate. Filtering the kept coordinates back
 * out of the original list would match every one of them and prune nothing,
 * which is the bug this signature exists to make unwritable.
 *
 * @param {number[]} ys  one value per frame, in order
 * @returns {Set<number>} the indices worth drawing
 */
export function corners(ys) {
  const keep = new Set();
  if (!ys.length) return keep;
  keep.add(0);
  keep.add(ys.length - 1);
  for (let i = 1; i < ys.length - 1; i++) {
    if (ys[i] === ys[i - 1] && ys[i] === ys[i + 1]) continue;
    keep.add(i);
  }
  return keep;
}
