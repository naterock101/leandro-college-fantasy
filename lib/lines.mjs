/**
 * Betting lines from two sources that disagree about almost everything, and the
 * merge rule that keeps a price after its source has forgotten it.
 *
 * The two feeds join on the game id and nothing else. ESPN's event id is byte
 * identical to the CFBD game id - verified on 401858212, the SMU/FSU game, in
 * both feeds - so none of the school-name traps in data/rosters.json apply
 * here. Nothing in this file matches a team by name.
 *
 * Where they differ:
 *
 *   |            | CFBD                    | ESPN                            |
 *   | sign       | negative = home favoured| same, but do not rely on it     |
 *   | favourite  | inferred from the sign  | explicit favorite flags         |
 *   | provider   | "DraftKings" / "Draft Kings" | provider.name, rarely displayName |
 *   | teams      | school strings          | ids, plus abbreviations in details |
 *
 * Two of those cells contradict what the endpoint survey claimed, and both
 * were checked against 53 priced games on 2026-09-08:
 *
 * - ESPN's `spread` is signed exactly like CFBD's, not a magnitude. All 53
 *   agreed with the favorite flags. We still drive the favourite off the flags
 *   and re-sign from them, because the flags are the field ESPN documents to
 *   itself and the sign is the one that would fail silently if it ever flipped.
 * - `provider.displayName` was present on 1 of 53. `provider.name` was present
 *   on all 53. Preferring displayName and falling back to name gets both.
 *
 * The normalised entry keeps the shape the page already renders -
 * {spread, favorite, formatted, overUnder, provider} - so nothing downstream
 * has to learn that ESPN exists. `seenAt` and `closed` are added on top.
 *
 * THE MONEYLINE FALLBACK. A book takes the spread off a game it thinks is too
 * lopsided to price - DraftKings had Alabama State at Troy with `pointSpread`
 * reading literally "OFF" - while still posting a moneyline on it. That game
 * used to reach the page as no line at all, which left its owner short in
 * every column built on the market. So a price may now carry a `probability`
 * instead of a `spread`: the two American prices, de-vigged, which is what the
 * spread was only ever a proxy for anyway.
 *
 * `spread` is null on such a price rather than back-solved from the model. A
 * spread the books never posted would be a number this repo invented and then
 * printed as though a book had said it - and the one place it would show is
 * Games of the week, beside real ones.
 *
 * It is a fallback and not a second source: within one observation the spread
 * is preferred over the moneyline, and across observations mergeLines will not
 * let a spreadless price displace a stored spread. On 2026-09-12 it recovers
 * exactly 1 of 80 FBS games, which is the whole size of this feature.
 *
 * THE MODEL OF LAST RESORT. Some games no book will price at all - West
 * Georgia at Arkansas State had no spread, no moneyline and no total, in
 * either feed. A game like that is not merely unknown: dropped from the
 * projection it takes its owner's points with it, and Clint's end-of-week
 * total was short by a game he will almost certainly win. ESPN's FPI has an
 * opinion on it - Arkansas State 91.4% - so `fpiPrice` turns that into a
 * price of last resort.
 *
 * Such a price is marked `model: true`, and the mark is the whole point. FPI
 * is a forecast; a spread and a moneyline are money at risk. The page says
 * "the closing lines expected" about its expectation columns, and that
 * sentence has to stay true, so a modelled price is used to project a game
 * and is excluded from every retrospective market figure - the expected
 * record, the expected points, luck, and upset tagging. Those columns exclude
 * an unpriced game from *both* sides and publish the count they cover, so
 * they get narrower rather than wrong; the projection is the one that silently
 * goes short, which is why it is the one this feeds.
 *
 * @typedef {{spread: number | null, favorite: string | null, formatted: string,
 *            overUnder: number | null, provider: string,
 *            probability?: number, model?: true}} Price
 * @typedef {{id: string, seenAt: string, closed: boolean | null,
 *            price: Price | null}} Observation
 */

/* CFBD returns several books per game and has been seen to spell the same one
   two ways. Normalise, then take the first preference that is present. */
export const PREFERENCE = ["draftkings", "bovada"];

/** @type {(p: unknown) => string} */
export const normProvider = (p) => String(p ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * "Miami -3.5", or "PK".
 *
 * The favourite is always shown laying points, so the sign of the stored
 * spread never reaches the page. The name is the full CFBD school string on
 * purpose: ESPN's `details` says "MIA -3.5" and an abbreviation leaking into
 * the payload would both look wrong next to the rest of the row and break the
 * `favorite === winner` comparison that tags an upset.
 *
 * @param {string | null} favorite
 * @param {number} spread
 */
export const formatSpread = (favorite, spread) =>
  !favorite || spread === 0 ? "PK" : `${favorite} ${-Math.abs(spread)}`;

/**
 * "Troy ML -1650".
 *
 * The "ML" is three characters buying the one thing this string cannot leave
 * ambiguous: it sits in the same column as "Georgia -41.5", and a reader who
 * takes -1650 for a spread is reading a number 80 times too large.
 *
 * @param {string} favorite
 * @param {number} odds  American price on the favourite
 */
export const formatMoneyline = (favorite, odds) =>
  `${favorite} ML ${odds > 0 ? `+${odds}` : odds}`;

/**
 * An American price as the chance it implies, vig included.
 *
 * -1650 is 1650/1750; +950 is 100/1050. Both sides of a game therefore add up
 * to more than 1, and the excess is the book's margin - which is why nothing
 * uses this figure on its own.
 *
 * @param {number} odds
 * @returns {number | null}
 */
export const impliedProbability = (odds) => {
  /* American prices live outside (-100, 100): -100 and +100 are both even
     money and there is nothing between them to express. A feed handing over a
     -50 would otherwise come back 0.33 - a heavy favourite reported as a
     one-in-three shot, which is plausible enough to be published and weighted
     before anyone noticed. */
  if (typeof odds !== "number" || !Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
};

/**
 * The two prices as one probability for the home side, with the margin removed.
 *
 * Proportional de-vigging: each side's implied chance over the pair's total.
 * It is the standard method and the only one that needs nothing but the two
 * numbers on offer. On Troy at -1650 against Alabama State at +950 the raw
 * pair sums to 1.038 - a 3.8% hold - and Troy comes out at 0.908 rather than
 * the 0.943 the price alone claims.
 *
 * @param {number | null} home  American price on the home side
 * @param {number | null} away
 * @returns {number | null}  the home side's chance, or null if either is missing
 */
/* Four places, which is finer than anything that reads a probability here -
   `percent` rounds to a whole one - and short enough that a stored file two
   hundred entries long stays diffable. */
const round4 = (/** @type {number} */ n) => Math.round(n * 1e4) / 1e4;

export const devig = (home, away) => {
  const h = impliedProbability(/** @type {number} */ (home));
  const a = impliedProbability(/** @type {number} */ (away));
  if (h === null || a === null) return null;
  const total = h + a;
  /* A pair that does not sum to something sane is a feed we do not understand,
     and a wrong probability is worse here than none: it would be published as
     a market opinion and weighted like one. Books hold a few percent; anything
     under 1 is an arbitrage nobody is offering, and 1.5 is a 50% margin. */
  if (!(total > 1 && total < 1.5)) return null;
  return h / total;
};

/* Same camelCase/snake_case defence build-standings.mjs applies to /games. */
const pick = (/** @type {any} */ g, /** @type {string[]} */ ...names) => {
  for (const n of names) if (g?.[n] !== undefined && g?.[n] !== null) return g[n];
  return undefined;
};

/* ------------------------------------------------------------------ */
/* CFBD /lines                                                         */
/* ------------------------------------------------------------------ */

const pickCfbdLine = (/** @type {any[]} */ lines) => {
  if (!Array.isArray(lines) || !lines.length) return null;
  for (const want of PREFERENCE) {
    const hit = lines.find((l) => normProvider(l?.provider) === want && typeof l?.spread === "number");
    if (hit) return hit;
  }
  return lines.find((l) => typeof l?.spread === "number") ?? null;
};

/**
 * @param {any} game  one entry from CFBD /lines
 * @param {string} seenAt  ISO timestamp of this observation
 * @returns {Observation | null}
 */
export function cfbdObservation(game, seenAt) {
  const line = pickCfbdLine(game?.lines);
  if (!line) return null;

  /* CFBD states the spread from the home team's perspective: negative means
     the home team is favoured. */
  const spread = line.spread;
  const home = pick(game, "homeTeam", "home_team");
  const away = pick(game, "awayTeam", "away_team");
  const favorite = spread === 0 ? null : spread < 0 ? home : away;

  /* No team name means we cannot say who was favoured, and a spread with no
     favourite would render as "undefined -7". Drop it rather than ship that. */
  if (spread !== 0 && !favorite) return null;

  return {
    id: String(game.id),
    seenAt,
    /* /lines carries no status field, so this source genuinely cannot say
       whether the game has been played. null, not false: see mergeLines. */
    closed: null,
    price: {
      spread,
      favorite: favorite ?? null,
      formatted: formatSpread(favorite ?? null, spread),
      overUnder: typeof line.overUnder === "number" ? line.overUnder : null,
      provider: String(line.provider),
    },
  };
}

/* ------------------------------------------------------------------ */
/* ESPN scoreboard                                                     */
/* ------------------------------------------------------------------ */

const namedProvider = (/** @type {any} */ o) =>
  normProvider(o?.provider?.displayName ?? o?.provider?.name);

/** The preferred book among those satisfying `usable`, else any that does. */
const pickBook = (/** @type {any[]} */ odds, /** @type {(o: any) => boolean} */ usable) => {
  if (!Array.isArray(odds) || !odds.length) return null;
  for (const want of PREFERENCE) {
    const hit = odds.find((o) => namedProvider(o) === want && usable(o));
    if (hit) return hit;
  }
  return odds.find(usable) ?? null;
};

const pickEspnOdds = (/** @type {any[]} */ odds) =>
  pickBook(odds, (o) => typeof o?.spread === "number");

/**
 * An American price as ESPN writes it: "+950", "-1650", or "OFF".
 *
 * "OFF" is the book saying it is not pricing this, which is the whole case
 * this path exists for and must not come back as a number - `Number("OFF")` is
 * NaN, but `Number("")` is 0, and a 0 here would be read as a price.
 *
 * @param {unknown} raw
 * @returns {number | null}
 */
const americanOdds = (raw) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Both sides' moneylines, taken from one quote rather than assembled.
 *
 * The two prices are only a market together: de-vigging is the pair divided by
 * its own total, so a close on one side against an open on the other is two
 * different moments subtracted from each other, and the margin that comes out
 * is not a margin anyone offered. They are therefore read from the same block
 * or not at all.
 *
 * The scoreboard writes them as strings under `moneyline.home.close.odds`; the
 * per-event odds endpoint writes numbers at `homeTeamOdds.moneyLine`. Both are
 * read because both are ESPN and neither is documented.
 *
 * @param {any} o  one entry from an ESPN odds array
 * @returns {[number, number] | null}  [home, away]
 */
const moneylinePair = (o) => {
  for (const when of ["close", "open"]) {
    const home = americanOdds(o?.moneyline?.home?.[when]?.odds);
    const away = americanOdds(o?.moneyline?.away?.[when]?.odds);
    if (home !== null && away !== null) return [home, away];
  }
  const home = americanOdds(o?.homeTeamOdds?.moneyLine);
  const away = americanOdds(o?.awayTeamOdds?.moneyLine);
  return home !== null && away !== null ? [home, away] : null;
};

const pickEspnMoneyline = (/** @type {any[]} */ odds) =>
  pickBook(odds, (o) => moneylinePair(o) !== null);

/* The odds object's own team blocks carry `displayName` ("Miami Hurricanes")
   and `abbreviation` ("MIA"), neither of which is the CFBD school string. The
   competitor list carries `location` ("Miami"), which is. All 80 rostered
   schools matched a competitor `location` exactly on 2026-09-08. */
const locationOf = (/** @type {any} */ competition, /** @type {string} */ side) =>
  competition?.competitors?.find?.((c) => c?.homeAway === side)?.team?.location;

/**
 * A price built from the two moneylines, or null if they cannot make one.
 *
 * The favourite is whichever side the de-vigged pair prefers, which is the
 * same thing the spread's sign says and is derived rather than flagged - the
 * `favorite` booleans are about the spread, and on a game with no spread ESPN
 * leaves them both false.
 *
 * An exactly even pair is a pick-em and is written as one, spread and all: it
 * is the same statement the market is making, in the shape the rest of the
 * repo already understands, and a `probability` of 0.5 with no favourite would
 * be a second way of saying it that every reader would have to learn.
 *
 * @param {any} competition
 * @param {any} o  the chosen ESPN odds entry, or null
 * @returns {Price | null}
 */
const moneylinePrice = (competition, o) => {
  const pair = o ? moneylinePair(o) : null;
  if (!pair) return null;
  const devigged = devig(pair[0], pair[1]);
  if (devigged === null) return null;

  const provider = String(o?.provider?.displayName ?? o?.provider?.name ?? "unknown");
  const overUnder = typeof o?.overUnder === "number" ? o.overUnder : null;

  /* Rounded before it is used to decide anything, so the branch below and the
     number published cannot disagree. Nothing in today's feed needs that -
     equal prices divide to exactly 0.5, and integer American prices are far
     too coarse to land a hair either side of it - but the failure it forecloses
     is a bad one and costs nothing to foreclose: a favourite named on a price
     that publishes as 50%, handed the game by the projection and coloured as
     the favourite on the page. */
  const home = round4(devigged);

  if (home === 0.5) {
    return { spread: 0, favorite: null, formatted: "PK", overUnder, provider };
  }

  const side = home > 0.5 ? "home" : "away";
  const favorite = locationOf(competition, side);
  /* Same rule as everywhere else here: an unnameable favourite is worse than
     no line, because the page would print "undefined ML -1650". */
  if (!favorite) return null;

  return {
    spread: null,
    favorite,
    formatted: formatMoneyline(favorite, side === "home" ? pair[0] : pair[1]),
    overUnder,
    provider,
    probability: round4(Math.max(home, 1 - home)),
  };
};

/**
 * @param {any} event  one entry from the ESPN scoreboard `events` array
 * @param {string} seenAt  ISO timestamp of this observation
 * @returns {Observation | null}
 */
export function espnObservation(event, seenAt) {
  const id = event?.id;
  if (id === undefined || id === null || id === "") return null;

  const comps = event?.competitions;
  const c = Array.isArray(comps) ? comps[0] : undefined;

  /* This is the field the whole merge rule hangs on. Once a game goes final
     ESPN deletes the odds object outright - 68 finals on 2026-09-05, none with
     odds - so the run that notices the game is over is the last chance to mark
     the price we already hold as a closing line. */
  const closed = c?.status?.type?.completed === true;

  const o = pickEspnOdds(c?.odds);
  /* No spread anywhere in the array is where the moneyline gets its turn. It
     is tried second and never merged with a spread: one book's number, read
     one way. */
  if (!o) {
    return {
      id: String(id), seenAt, closed,
      price: moneylinePrice(c, pickEspnMoneyline(c?.odds)),
    };
  }

  /* Favourite from the explicit flags, then the sign from the favourite. Doing
     it the other way round would inherit whatever ESPN's sign convention turns
     out to be next season. */
  const magnitude = Math.abs(o.spread);
  let side = o?.homeTeamOdds?.favorite === true ? "home"
    : o?.awayTeamOdds?.favorite === true ? "away"
    /* Neither flag set and a non-zero number: fall back to the sign, which has
       so far always agreed with the flags. */
    : magnitude === 0 ? null : o.spread < 0 ? "home" : "away";

  if (side === null) {
    return {
      id: String(id), seenAt, closed,
      price: {
        spread: 0, favorite: null, formatted: "PK",
        overUnder: typeof o.overUnder === "number" ? o.overUnder : null,
        provider: String(o?.provider?.displayName ?? o?.provider?.name ?? "unknown"),
      },
    };
  }

  const favorite = locationOf(c, side);
  /* Same rule as CFBD: an unnameable favourite is worse than no line. */
  if (!favorite) return { id: String(id), seenAt, closed, price: null };

  return {
    id: String(id),
    seenAt,
    closed,
    price: {
      spread: side === "home" ? -magnitude : magnitude,
      favorite,
      formatted: formatSpread(favorite, magnitude),
      overUnder: typeof o.overUnder === "number" ? o.overUnder : null,
      provider: String(o?.provider?.displayName ?? o?.provider?.name ?? "unknown"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* ESPN FPI, the model of last resort                                  */
/* ------------------------------------------------------------------ */

/** One named statistic from a predictor team block. */
const statOf = (/** @type {any} */ team, /** @type {string} */ name) => {
  const hit = team?.statistics?.find?.((/** @type {any} */ s) => s?.name === name);
  const raw = hit?.value ?? hit?.displayValue;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * A price of last resort, from ESPN's FPI matchup predictor.
 *
 * `gameProjection` is a percentage each side wins, and the two are read
 * together rather than one being taken as the other's complement: they are
 * separately published numbers, and a pair that does not add to 100 is a
 * response this code does not understand well enough to use. Nothing is
 * de-vigged - a forecast has no margin in it - so the only arithmetic is
 * percent to probability.
 *
 * The result is marked `model: true`. See the header: it may project a game
 * and may not appear in anything the page calls a market expectation.
 *
 * @param {any} predictor  the parsed predictor response for one competition
 * @param {any} competition  the scoreboard competition, for the school names
 * @param {string} id
 * @param {string} seenAt
 * @returns {Observation | null}
 */
export function fpiObservation(predictor, competition, id, seenAt) {
  if (!id) return null;
  const home = statOf(predictor?.homeTeam, "gameProjection");
  const away = statOf(predictor?.awayTeam, "gameProjection");
  if (home === null || away === null) return null;
  /* Percentages, and they have to be percentages of the same thing. A tenth
     of a point either way is FPI's own rounding; anything more is a shape
     this code has misread. */
  if (Math.abs(home + away - 100) > 0.2) return null;
  if (home < 0 || home > 100) return null;

  /* Rounded to whole percents before anything is decided, for the same reason
     the moneyline is: the number that decides who the favourite is has to be
     the number that gets published. FPI states whole tenths and the page
     prints whole percents, so a tenth is as fine as this is ever read. */
  const p = Math.round(home) / 100;
  if (p === 0.5) return null;

  const side = p > 0.5 ? "home" : "away";
  const favorite = locationOf(competition, side);
  if (!favorite) return null;

  const chance = Math.max(p, 1 - p);
  return {
    id: String(id),
    seenAt,
    closed: competition?.status?.type?.completed === true,
    price: {
      spread: null,
      favorite,
      /* Never "Arkansas State -20.5". FPI publishes a predicted margin and it
         would format identically to a real spread, which is the one thing a
         forecast in a column of book prices must not do. The percentage is
         left off because the column beside this one already carries it. */
      formatted: `${favorite} FPI`,
      overUnder: null,
      provider: "ESPN FPI",
      probability: chance,
      model: true,
    },
  };
}

/**
 * The `dates` values covering a run: yesterday through a week out, Eastern.
 *
 * ESPN's `dates` parameter is an **Eastern calendar day**, not a UTC one. A
 * request for 20260905 returns games from 16:00Z that day through 02:30Z the
 * next - noon to 22:30 ET. Computing this window in UTC would put every
 * Saturday night game on the wrong date, which on a Saturday-night poll is
 * exactly the game we care about. Intl carries the DST rule, so this stays
 * right across the November change the crons are annotated for.
 *
 * Yesterday through a week out. Both ends earn their place:
 *
 * - **yesterday** is the easy one to drop and the one that must not be. A game
 *   that went final overnight is only observable as final while its date is
 *   still being fetched, and marking `closed` on the price we already hold is
 *   the last thing that can happen before ESPN deletes the odds.
 * - **seven days** rather than one. The first run after the cutover was a
 *   Tuesday, and ESPN priced nothing: the window reached Wednesday, and the
 *   games anybody cares about were the following Saturday. That made "ESPN is
 *   the primary source" true only from Thursday, with the CFBD call carrying
 *   Sunday to Wednesday at 7-hour granularity - which is the freshness this
 *   whole phase existed to improve on. Seven is the number that reaches the
 *   next Saturday from *any* day, including from a Saturday.
 *
 * That is nine requests a run against three, and it is the right trade because
 * ESPN is unmetered and cached: none of it touches the CFBD budget, which is
 * the only quota this repo has. The CFBD call is still throttled to one per
 * seven hours and still the only thing that spends.
 *
 * The nine are fetched independently and a failure on one is not a failure on
 * the others, so a date ESPN has nothing for costs a 404 and nothing else.
 *
 * @param {Date} now
 * @returns {string[]}  YYYYMMDD
 */
export function espnDates(now) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  });
  /* Resolve to the Eastern calendar day first, then step in UTC days. Adding
     24 hours of milliseconds to the instant and re-formatting looks equivalent
     and is not: on the first Sunday in November the Eastern day is 25 hours
     long, so "tomorrow" comes back as today again and Monday is never fetched;
     in March it is 23 hours and "yesterday" skips a day. UTC days are always
     exactly 24 hours, which is the only reason this arithmetic is safe. */
  const day = 24 * 60 * 60 * 1000;
  const anchor = Date.parse(`${fmt.format(now)}T00:00:00Z`);
  return [-1, 0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
    new Date(anchor + n * day).toISOString().slice(0, 10).replaceAll("-", ""));
}

/* ------------------------------------------------------------------ */
/* the merge rule                                                      */
/* ------------------------------------------------------------------ */

const samePrice = (/** @type {any} */ a, /** @type {Price} */ b) =>
  Boolean(a) && a.spread === b.spread && a.favorite === b.favorite
    && a.formatted === b.formatted && a.overUnder === b.overUnder
    && a.provider === b.provider
    /* A moneyline that moved is a price that moved, and `seenAt` means "when
       this price was established". Left out, a game priced only by moneyline
       would keep the timestamp of its first quote all season. */
    && (a.probability ?? null) === (b.probability ?? null)
    && (a.model ?? false) === (b.model ?? false);

/**
 * Fold a run's observations into the stored games map. **Merge only.**
 *
 * A game that has ever had a price keeps its last observed price forever. A
 * refresh may add a game or update a price; it may never remove one. This is
 * not a nicety: ESPN drops the odds object the moment a game goes final, so a
 * builder that wrote a fresh map every ten minutes would erase the spread of
 * every completed game - taking with it `upset` on the head-to-head list and
 * the timeline, and the closing lines the luck and expected-points work needs.
 *
 * Two consequences worth stating:
 *
 * - `closed` is sticky. A finished game cannot un-finish, and CFBD observations
 *   carry `closed: null` because that source cannot see status at all. Only a
 *   true ever moves it.
 * - `seenAt` moves only when the price moves. It is therefore "when this price
 *   was established", not "when it was last looked at" - the file-level
 *   `fetchedAt` already answers the latter, and bumping 280 entries every ten
 *   minutes would make every run a 280-line diff for no information.
 *
 * @param {Record<string, any>} stored
 * @param {Observation[]} observations  applied in order; later wins
 * @returns {Record<string, any>}
 */
export function mergeLines(stored, observations) {
  const out = { ...stored };
  for (const obs of observations) {
    if (!obs?.id) continue;
    const prev = out[obs.id];
    const closed = prev?.closed === true || obs.closed === true;

    if (!obs.price) {
      /* Nothing to price. If we hold a price, this observation can still
         upgrade it to a closing line; if we do not, an entry with no spread in
         it would be noise the page has to filter. */
      if (prev) out[obs.id] = { ...prev, closed };
      continue;
    }

    /* Two downgrades a refresh may not make, both for the same reason the file
       is merge-only: what is already stored says more than what has arrived.

       A spread outranks a moneyline, across runs as well as within one. The
       sequence is real and one-way - a book posts a spread, then pulls it as
       kickoff nears and leaves only a moneyline up - and taking it would swap
       a stored closing spread for a quote that says less, rewriting what the
       market said at the time.

       And a market price outranks a model, always. FPI has an opinion on every
       game including the ones the books have priced, so without this rule the
       run that fetched a predictor would overwrite a real closing line with a
       forecast, and the expectation columns would quietly start excluding a
       game they had been counting. */
    const downgrade =
      (obs.price.spread === null && typeof prev?.spread === "number") ||
      (obs.price.model === true && prev && prev.model !== true);
    if (downgrade) {
      out[obs.id] = { ...prev, closed };
      continue;
    }

    out[obs.id] = {
      ...obs.price,
      seenAt: samePrice(prev, obs.price) ? prev.seenAt : obs.seenAt,
      closed,
    };
  }
  return out;
}
