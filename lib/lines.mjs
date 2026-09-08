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
 * @typedef {{spread: number, favorite: string | null, formatted: string,
 *            overUnder: number | null, provider: string}} Price
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

const pickEspnOdds = (/** @type {any[]} */ odds) => {
  if (!Array.isArray(odds) || !odds.length) return null;
  const named = (o) => normProvider(o?.provider?.displayName ?? o?.provider?.name);
  for (const want of PREFERENCE) {
    const hit = odds.find((o) => named(o) === want && typeof o?.spread === "number");
    if (hit) return hit;
  }
  return odds.find((o) => typeof o?.spread === "number") ?? null;
};

/* The odds object's own team blocks carry `displayName` ("Miami Hurricanes")
   and `abbreviation` ("MIA"), neither of which is the CFBD school string. The
   competitor list carries `location` ("Miami"), which is. All 80 rostered
   schools matched a competitor `location` exactly on 2026-09-08. */
const locationOf = (/** @type {any} */ competition, /** @type {string} */ side) =>
  competition?.competitors?.find?.((c) => c?.homeAway === side)?.team?.location;

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
  if (!o) return { id: String(id), seenAt, closed, price: null };

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
/* the merge rule                                                      */
/* ------------------------------------------------------------------ */

const samePrice = (/** @type {any} */ a, /** @type {Price} */ b) =>
  Boolean(a) && a.spread === b.spread && a.favorite === b.favorite
    && a.formatted === b.formatted && a.overUnder === b.overUnder
    && a.provider === b.provider;

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

    out[obs.id] = {
      ...obs.price,
      seenAt: samePrice(prev, obs.price) ? prev.seenAt : obs.seenAt,
      closed,
    };
  }
  return out;
}
