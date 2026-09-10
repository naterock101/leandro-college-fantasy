/**
 * The trophy case: six season superlatives, each with one holder, each
 * recomputed from scratch on every build.
 *
 * The point of the feature is the changing hands. A static list of season bests
 * is a stats page; a trophy somebody took off you last Saturday is a group
 * chat. So nothing here is incremental - there is no stored "current holder"
 * to go stale when the 8-hourly baseline cron picks up a correction to week 3.
 * Every award is derived from the whole season every time, and the badge comes
 * from deriving it twice.
 *
 * Pure: it reads a built payload's `results` and `byWeek` and returns an array.
 * No I/O, no clock, no CFBD shapes - `lib/games.mjs` owns those, and this file
 * runs after the builder has already turned them into the payload. Same plain
 * ESM with JSDoc as the rest of lib/, so the builder, the page and the tests
 * import one file and cannot disagree about what an award is.
 *
 * `standings` and `scoring` come in only to price a team. What a team is worth
 * is a draft property and a league rule, so neither moves with how much of the
 * season is in view, and both are read whole even by a truncated pass.
 *
 * `luck` is deliberately not an input, though the payload has one. The season
 * figure cannot be truncated to "as of last week", and an award that could not
 * be asked for its own history could not carry the badge. byWeek's cumulative
 * block already carries the same subtraction week by week - `pricedPoints`
 * against `expectedPoints` - and the builder's own test asserts that its last
 * entry and the season `luck` are the same sum.
 *
 * @typedef {{manager: string, value: number, detail: string}} Holder
 * @typedef {{id: string, label: string, blurb: string, unit: string,
 *            holders: Holder[], runnerUp: Holder | null,
 *            changed?: boolean}} Award
 * @typedef {Holder & {sort: number}} Candidate
 */

/** Three decimals is past anything `percent` will render, and short enough to diff. */
const round3 = (n) => Math.round(n * 1000) / 1000 + 0;
/** Tenths, which is the precision the payload already publishes points in. */
const round1 = (n) => Math.round(n * 10) / 10 + 0;

/** "45-3" is written winner-first by the builder, so the margin is a subtraction. */
const marginOf = (score) => {
  const [a, b] = String(score).split("-").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
};

/* ------------------------------------------------------------------ */
/* the six                                                             */
/* ------------------------------------------------------------------ */

/**
 * Each entry says what it is called, what it reads, and - through `floor` -
 * whether zero is a score or an absence.
 *
 * `floor` exists because the two kinds of award fail differently. A margin and
 * a chance are properties of a game that happened, so any candidate at all is
 * a real one. A weekly total, a luck delta and a count are sums over a season
 * that may not have started: every manager on nought points is not an
 * eight-way tie for Best Week, it is a trophy nobody has won.
 */
const DEFS = [
  {
    id: "upset", label: "Biggest Upset",
    blurb: "Won when the market gave them the least chance",
    unit: "chance", floor: null,
    candidates: (rows) => rows.flatMap((r) =>
      r.winner.manager && typeof r.chance === "number"
        ? [{ manager: r.winner.manager, sort: -r.chance, value: round3(r.chance),
             detail: `${r.winner.team} ${r.score} over ${r.loser.team}`, row: r }]
        : []),
  },
  {
    id: "heartbreaker", label: "Heartbreaker",
    blurb: "Lost when the market gave them the most chance",
    unit: "chance", floor: null,
    candidates: (rows) => rows.flatMap((r) => {
      if (!r.loser.manager || typeof r.chance !== "number") return [];
      const held = 1 - r.chance;
      return [{ manager: r.loser.manager, sort: held, value: round3(held),
                detail: `${r.loser.team} lost ${r.score} to ${r.winner.team}`, row: r }];
    }),
  },
  {
    id: "blowout", label: "Blowout",
    blurb: "Their biggest margin of victory",
    unit: "margin", floor: null,
    candidates: (rows) => rows.flatMap((r) => {
      const m = r.winner.manager ? marginOf(r.score) : null;
      return m === null ? []
        : [{ manager: r.winner.manager, sort: m, value: m,
             detail: `${r.winner.team} ${r.score} over ${r.loser.team}`, row: r }];
    }),
  },
  {
    id: "civilWar", label: "Civil War",
    blurb: "Most points lost to their own teams playing each other",
    unit: "points", floor: 0,
    /* Points, not a count of games, because a count is not the injury. A
       manager who owns both teams banks one side's value and loses the other's,
       and what is gone is the *loser's* - that is the team that would have won
       those points against anybody else. Valuing the winner would report a
       manager as worst off in the week their better team won.
       This is the settled counterpart of `collisionLoss` in the standings,
       which is deliberately not reused: that one counts only *scheduled* games
       and takes the lesser of the two tiers, because a ceiling has to assume
       the better outcome. Here the game has been played and the result says
       exactly which team lost, so there is nothing to assume.
       One row per game rather than per side: the builder writes a single
       results entry for a game, and `sameManager` already means one manager
       owned both ends of it. */
    candidates: (rows, _weeks, { valueOf }) => {
      /** @type {Map<string, {lost: number, n: number, row: any}>} */
      const seen = new Map();
      for (const r of rows) {
        if (!r.sameManager || !r.winner.manager) continue;
        const lost = valueOf(r.winner.manager, r.loser.team);
        /* No tier for the losing team means no number. Inventing one - a count,
           or the winner's value - would publish a figure nobody could check
           against a roster, so the game is left out instead. */
        if (lost === null) continue;
        const at = seen.get(r.winner.manager);
        seen.set(r.winner.manager,
          { lost: (at?.lost ?? 0) + lost, n: (at?.n ?? 0) + 1, row: r });
      }
      return [...seen].map(([manager, { lost, n, row }]) => ({
        manager, sort: lost, value: lost,
        /* A points total with a single fixture named under it reads as that
           fixture's score, so more than one game has to say so. */
        detail: `${n > 1 ? `${n} games, latest ` : ""}${row.winner.team} v ${row.loser.team}`,
        row,
      }));
    },
  },
  {
    id: "bestWeek", label: "Best Week",
    blurb: "Most points banked in a single week",
    unit: "points", floor: 0,
    /* Weeks, not games: this one is the only award whose subject is a week,
       and the detail names it rather than a fixture. */
    candidates: (_rows, weeks) => weeks.flatMap((w) =>
      Object.entries(w.delta ?? {}).map(([manager, points]) => ({
        manager, sort: points, value: points, detail: w.label, row: null,
      }))),
  },
  {
    id: "luckiest", label: "Luckiest",
    blurb: "Furthest above what the closing lines expected to pay them",
    unit: "points", floor: 0,
    /* The last week in view, because the cumulative block is already a running
       total - summing it across weeks would count week one eight times. */
    candidates: (_rows, weeks) => {
      const last = weeks[weeks.length - 1];
      if (!last) return [];
      return Object.entries(last.cumulative ?? {}).flatMap(([manager, c]) => {
        if (typeof c?.pricedPoints !== "number" || typeof c?.expectedPoints !== "number") return [];
        const delta = round1(c.pricedPoints - c.expectedPoints);
        return [{ manager, sort: delta, value: delta,
                  detail: `Through ${last.label.toLowerCase()}`, row: null }];
      });
    },
  },
];

/* ------------------------------------------------------------------ */
/* building one                                                        */
/* ------------------------------------------------------------------ */

/**
 * Holders, and the best candidate who is not one of them.
 *
 * Sorted on `sort` and published as `value`, which are two fields on purpose.
 * The biggest upset is the *smallest* chance, so one award sorts against its
 * own number; and rounding before the sort would hand a joint trophy to two
 * managers a ten-thousandth apart, who did not tie.
 *
 * The runner-up has to belong to somebody else. The holder alone says who is
 * winning; the runner-up says how safe they are, and a holder's own second
 * best game answers a question nobody asked.
 *
 * @param {Candidate[]} candidates
 * @param {number | null} floor  a value at or below which there is no holder
 */
function settle(candidates, floor) {
  const live = floor === null ? candidates : candidates.filter((c) => c.value > floor);
  if (!live.length) return { holders: [], runnerUp: null };

  /* Manager second, so a tie comes out in an order that does not depend on the
     order games happened to be written in. */
  const ranked = [...live].sort((a, b) => b.sort - a.sort || a.manager.localeCompare(b.manager));
  const top = ranked[0].sort;

  /** @type {Holder[]} */
  const holders = [];
  const held = new Set();
  for (const c of ranked) {
    if (c.sort !== top) break;
    if (held.has(c.manager)) continue;   /* two of one manager's games at the top is one trophy */
    held.add(c.manager);
    holders.push({ manager: c.manager, value: c.value, detail: c.detail });
  }

  const next = ranked.find((c) => !held.has(c.manager));
  return {
    holders,
    runnerUp: next ? { manager: next.manager, value: next.value, detail: next.detail } : null,
  };
}

/**
 * The whole trophy case, as of a point in the season.
 *
 * `through` is a count of weeks off the front of `byWeek`, and it is the only
 * reason this takes a whole payload rather than a list of games: asking for
 * last week's answer is how `markChanges` finds out what moved. Left off, it
 * means the whole season.
 *
 * A results row is kept when its `key` names a week in view. The full-season
 * call skips that filter entirely rather than building a set and matching
 * against it - a row whose key somehow matched no week would silently vanish
 * from every award, and the season view is the one that must never lose one.
 *
 * @param {{results?: any[], byWeek?: any[], standings?: any[],
 *          scoring?: Record<string, number>, through?: number}} payload
 * @returns {Award[]}
 */
export function buildAwards({ results = [], byWeek = [], standings = [],
                              scoring = {}, through } = {}) {
  const upto = typeof through === "number"
    ? Math.max(0, Math.min(through, byWeek.length))
    : byWeek.length;
  const weeks = byWeek.slice(0, upto);
  const rows = upto >= byWeek.length
    ? results
    : results.filter((r) => weeks.some((w) => w.key === r.key));

  const labelOf = new Map(byWeek.map((w) => [w.key, w.label]));

  /* What one manager's team is worth, or null when the payload cannot say.
     Both lookups can miss on a snapshot written before a roster change landed,
     and a missing tier has to read as "no number" rather than fall through to a
     default - a default here would be a points figure nobody could check. */
  const squads = new Map(standings.map((s) => [s.manager, s.teams ?? {}]));
  const valueOf = (manager, team) => {
    const tier = squads.get(manager)?.[team]?.tier;
    const v = scoring[tier];
    return typeof v === "number" ? v : null;
  };

  return DEFS.map(({ id, label, blurb, unit, floor, candidates }) => {
    /* The week is appended here rather than in each definition, so no award
       can be written that names a game without saying when it happened. */
    const withWhen = candidates(rows, weeks, { valueOf }).map((c) => {
      const when = c.row ? labelOf.get(c.row.key) : null;
      return { ...c, detail: when ? `${c.detail}, ${when}` : c.detail };
    });
    return { id, label, blurb, unit, ...settle(withWhen, floor) };
  });
}

/**
 * Sets `changed` on every award by comparing holders with an earlier view.
 *
 * Compared on the holders alone, and as a whole list, so a trophy that went
 * from one name to two - somebody drew level - reads as changed, which it is.
 * Nobody to somebody is the flip most worth the badge and an equality check
 * that treated both ends as "no holder" would miss it, so the empty case is
 * spelled by the join and not special-cased.
 *
 * No earlier view at all - the first week of a season - means nothing has
 * changed hands yet, rather than everything having done so.
 *
 * @param {Award[]} now
 * @param {Award[] | null} [before]
 * @returns {Award[]}
 */
export function markChanges(now, before) {
  const key = (a) => a.holders.map((h) => h.manager).join("|");
  const was = new Map((before ?? []).map((a) => [a.id, key(a)]));
  return now.map((a) => ({
    ...a,
    changed: before ? was.get(a.id) !== key(a) : false,
  }));
}
