#!/usr/bin/env node
/**
 * Builds public/lines.json from two feeds.
 *
 * ESPN's public scoreboard is the primary source and runs on every standings
 * run. It needs no key, sets access-control-allow-origin: *, caches for a
 * handful of seconds, and its event id is byte identical to the CFBD game id -
 * so it costs nothing against the 1,000/month CFBD free tier and joins on an
 * integer rather than a school name. Spread freshness goes from 8 hours to 10
 * minutes on game day for zero extra budget.
 *
 * CFBD /lines stays as the gap-filling fallback: it prices games ESPN has not,
 * and it is the cross-check if ESPN reshapes itself. It is a paid-budget call,
 * so this script throttles it to at most one every CFBD_MIN_INTERVAL_MS by
 * comparing against `cfbdFetchedAt` in the file it already wrote.
 *
 * ESPN's FPI predictor is the last resort, and only for a rostered game that
 * has not kicked off and that neither book source priced. It is one request
 * per such game - unmetered, same host family as the odds - and there are one
 * or two of them a week. The price it produces is marked `model: true` and is
 * for the projection only; see lib/lines.mjs on why that mark matters. It is
 * the one step --espn-fixture cannot replay, so the fixture flag disables it:
 * a captured payload that then phones a live endpoint is not a capture.
 *
 * That throttle replaces the old arrangement, where poll.yml gated the whole
 * step on a literal match against the baseline cron string. The budget is now
 * enforced by the thing that spends it rather than by two files agreeing about
 * a string, so the crons can be re-timed without silently changing the bill.
 *
 * ESPN is undocumented, so every failure of it - unreachable, rate limited,
 * non-JSON, reshaped, empty - leaves the stored file exactly as it was and
 * exits 0. Standings must never fail on the betting feed.
 *
 * THE MERGE RULE. ESPN deletes the odds object once a game goes final: 68
 * finals on 2026-09-05, not one with odds. Writing a fresh map every run would
 * therefore erase the spread of every completed game, and with it `upset` on
 * the head-to-head list and the closing lines the luck work depends on. So the
 * file is merge-only - see mergeLines in lib/lines.mjs - and this script never
 * writes a games map it did not first read.
 *
 * Output is its own file rather than part of standings.json on purpose: the
 * standings runs re-read it and re-attach whatever is there, so spreads never
 * flicker in and out between runs that did and did not fetch.
 *
 * Env: CFBD_API_KEY (optional; without it, ESPN only)
 * Usage: node scripts/build-lines.mjs [--dry] [--out path.json]
 *                                     [--no-espn] [--no-cfbd] [--force-cfbd]
 *                                     [--no-fpi] [--espn-fixture path.json]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cfbdObservation, espnObservation, fpiObservation, espnDates, mergeLines,
} from "../lib/lines.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTERS = resolve(ROOT, "data/rosters.json");
const CFBD_API = "https://api.collegefootballdata.com/lines";
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";

/* groups=80 is FBS. Without it the scoreboard is every division and mostly
   games no roster can contain. */
const ESPN_GROUP = "80";

/* Seven hours, not eight. The baseline cron is 8-hourly, so a strict 8h window
   would be missed by the second or two a run takes to reach this line and the
   call would slip to whichever run came next - three per day on a quiet day,
   but unpredictably placed. Seven hours lets every baseline run through and
   admits at most one extra call on a Saturday, when the 10-minute schedule is
   still running seven hours after the 16:17 baseline. Worst case is 24
   calls/week against the 21 the budget is written for. */
const CFBD_MIN_INTERVAL_MS = 7 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const NO_ESPN = args.includes("--no-espn");
const NO_CFBD = args.includes("--no-cfbd");
const FORCE_CFBD = args.includes("--force-cfbd");
const NO_FPI = args.includes("--no-fpi");

const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} needs a path.`);
    process.exit(1);
  }
  return v;
};
const OUT = resolve(ROOT, flagValue("--out") ?? "public/lines.json");

/* A captured scoreboard payload, used instead of the network. This is how the
   test suite stays hermetic, and how a human replays a response that produced
   a surprising file. */
const ESPN_FIXTURE = flagValue("--espn-fixture");

const doc = JSON.parse(readFileSync(ROSTERS, "utf8"));
const now = new Date();
const seenAt = now.toISOString();

/* ------------------------------------------------------------------ */
/* what we already hold                                                */
/* ------------------------------------------------------------------ */

/* A truncated or otherwise unreadable file is the shape of an interrupted
   write. Rebuilding it from one refresh would turn a recoverable file into a
   confidently wrong one - every closing line before today, gone - so this is
   the single case where the lines build stops rather than degrades. */
function loadStored() {
  if (!existsSync(OUT)) return { fetchedAt: null, cfbdFetchedAt: null, season: doc.season, games: {} };
  let raw;
  try {
    raw = JSON.parse(readFileSync(OUT, "utf8"));
  } catch (e) {
    console.error(`${OUT} exists but will not parse: ${e.message}`);
    console.error("Refusing to overwrite it. Inspect or delete the file, then re-run.");
    process.exit(1);
  }
  return {
    fetchedAt: raw.fetchedAt ?? null,
    cfbdFetchedAt: raw.cfbdFetchedAt ?? null,
    season: raw.season ?? doc.season,
    games: raw.games ?? {},
  };
}

const stored = loadStored();

/* ------------------------------------------------------------------ */
/* ESPN                                                                */
/* ------------------------------------------------------------------ */

/* "Unreachable" includes "accepts the connection and then says nothing".
   Without a deadline that is not a degraded run, it is a step that sits there
   until GitHub's job timeout kills it, every ten minutes. */
const TIMEOUT_MS = 15_000;

async function fetchEspnDoc(url, { events = true } = {}) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.json();
  /* A reshaped or error payload usually still parses - an HTML block does not,
     but a JSON error object does. The events array is the contract for the
     scoreboard; the predictor has no array and is checked by its parser. */
  if (events && !Array.isArray(body?.events)) {
    throw new Error("no events array in the response");
  }
  return body;
}

/** @returns {Promise<{observations: any[], ok: boolean, priced: number}>} */
async function readEspn() {
  const observations = [];
  const events = new Map();
  let ok = false;
  let priced = 0;

  const absorb = (body, label) => {
    ok = true;
    for (const ev of body.events) {
      const o = espnObservation(ev, seenAt);
      if (!o) continue;
      if (o.price) priced++;
      observations.push(o);
      /* Kept so the FPI step can name a favourite and see whether the game has
         kicked off, without asking the scoreboard for the same nine dates a
         second time. Keyed by id, so a game appearing on two dates - the
         window overlaps by design - is held once. */
      events.set(o.id, ev);
    }
    console.log(`espn ${label}: ${body.events.length} event(s)`);
  };

  if (ESPN_FIXTURE) {
    try {
      const body = JSON.parse(readFileSync(resolve(ROOT, ESPN_FIXTURE), "utf8"));
      if (!Array.isArray(body?.events)) throw new Error("no events array in the fixture");
      absorb(body, "fixture");
    } catch (e) {
      console.warn(`espn fixture unusable, skipped: ${e.message}`);
    }
    return { observations, ok, priced, events };
  }

  /* Sequential rather than Promise.all: three requests to an unauthenticated
     public endpoint that we are about to hit every ten minutes, so being
     unhurried is the polite default. One date failing must not lose the rest,
     which is why the catch is inside the loop. */
  for (const date of espnDates(now)) {
    try {
      absorb(await fetchEspnDoc(`${ESPN_API}?dates=${date}&groups=${ESPN_GROUP}`), date);
    } catch (e) {
      console.warn(`espn ${date} failed, skipped: ${e.message}`);
    }
  }
  return { observations, ok, priced, events };
}

/* ------------------------------------------------------------------ */
/* CFBD                                                                */
/* ------------------------------------------------------------------ */

function cfbdIsDue() {
  if (FORCE_CFBD) return true;
  if (!stored.cfbdFetchedAt) return true;
  const last = Date.parse(stored.cfbdFetchedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= CFBD_MIN_INTERVAL_MS;
}

/** @returns {Promise<{observations: any[], ok: boolean}>} */
async function readCfbd() {
  const key = process.env.CFBD_API_KEY;
  if (!key) {
    /* Not fatal any more: ESPN needs no key, so a keyless run still produces a
       correct, if slightly thinner, file. Loud on stderr because a CI run that
       has lost its secret should be noticeable in the log. */
    console.warn("CFBD_API_KEY is not set, so the CFBD fallback is unavailable.");
    return { observations: [], ok: false };
  }
  try {
    const res = await fetch(`${CFBD_API}?year=${doc.season}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const games = await res.json();
    if (!Array.isArray(games)) throw new Error("expected an array of games");
    const observations = [];
    for (const g of games) {
      const o = cfbdObservation(g, seenAt);
      if (o) observations.push(o);
    }
    console.log(`cfbd: ${games.length} game(s), ${observations.length} priced`);
    return { observations, ok: true };
  } catch (e) {
    console.warn(`cfbd failed, skipped: ${e.message}`);
    return { observations: [], ok: false };
  }
}

/* ------------------------------------------------------------------ */
/* ESPN FPI, the model of last resort                                  */
/* ------------------------------------------------------------------ */

/* Every school on a roster, as the CFBD string, which is also what ESPN's
   competitor `location` is. Only these games can cost anyone points, and FPI
   is a per-game request: asking about the other ~40 unrostered games a week
   would be four times the traffic for nothing. */
const ROSTERED = new Set(
  Object.values(doc.managers).flat().map((t) => t.cfbd)
);

/* A ceiling on the requests one run may make, so a feed that stops pricing
   games - or a bug that stops recognising prices - cannot turn a ten-minute
   cron into sixty requests a run against someone else's server. Two a week is
   the real number; ten is room for a bad Saturday and a hard stop after it. */
const FPI_MAX = 10;

const isRostered = (/** @type {any} */ ev) =>
  (ev?.competitions?.[0]?.competitors ?? []).some((c) => ROSTERED.has(c?.team?.location));

/**
 * Predictors for the rostered games nothing else priced.
 *
 * `priced` is the ids that already have a price this run; `stored.games` the
 * ones already in the file. Both are skipped, for two different reasons:
 *
 * - a game the books priced and have since pulled keeps that price under the
 *   merge rule, so a request about it buys an answer that is then discarded
 *   as a downgrade;
 * - a game already holding a *model* price is not re-asked either. FPI moves
 *   by a point or two on the sort of mismatch that reaches this function, and
 *   refreshing it would be a request every ten minutes all week for a number
 *   that will not change the projection. One per game per season is the trade.
 */
async function readFpi(events, priced) {
  const observations = [];
  const wanted = [...events.entries()].filter(([id, ev]) =>
    !priced.has(id) && !stored.games[id] && isRostered(ev)
    /* A game already under way or over is not one the projection is waiting
       on, and a forecast of it is worth nothing. */
    && ev?.competitions?.[0]?.status?.type?.completed !== true
    && ev?.competitions?.[0]?.status?.type?.state === "pre")
    /* Soonest first, so the cap below drops the games furthest out - they get
       another nine days of runs to be asked about, and the ones about to
       kick off do not. Insertion order here is the order nine scoreboard
       responses happened to arrive, which is no order at all. */
    .sort(([, a], [, b]) =>
      String(a?.date ?? "").localeCompare(String(b?.date ?? "")));

  if (!wanted.length) return observations;
  if (wanted.length > FPI_MAX) {
    console.warn(`fpi: ${wanted.length} unpriced rostered game(s), asking about the first ${FPI_MAX}`);
  }

  for (const [id, ev] of wanted.slice(0, FPI_MAX)) {
    try {
      const body = await fetchEspnDoc(
        `${ESPN_CORE}/events/${id}/competitions/${id}/predictor`, { events: false });
      const o = fpiObservation(body, ev.competitions[0], id, seenAt);
      if (!o) {
        console.warn(`fpi ${id}: no usable projection`);
        continue;
      }
      observations.push(o);
      console.log(`fpi ${id}: ${o.price.formatted}`);
    } catch (e) {
      /* Same rule as everywhere else in this file: a source that will not
         answer leaves the stored file as it was. */
      console.warn(`fpi ${id} failed, skipped: ${e.message}`);
    }
  }
  return observations;
}

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */

const espn = NO_ESPN
  ? { observations: [], ok: false, priced: 0, events: new Map() }
  : await readEspn();

const cfbdWanted = !NO_CFBD && cfbdIsDue();
if (!NO_CFBD && !cfbdWanted) {
  console.log(`cfbd: skipped, last called ${stored.cfbdFetchedAt} (throttled to one call per ${CFBD_MIN_INTERVAL_MS / 3600000}h)`);
}
const cfbd = cfbdWanted ? await readCfbd() : { observations: [], ok: false };

if (!espn.ok && !cfbd.ok) {
  /* Exit 0. The lines feed is optional by design and the stored file is still
     the best answer available, so a failure here must not redden a run whose
     actual job is standings. */
  console.warn("no source produced a usable response; leaving the stored file untouched");
  process.exit(0);
}

/* ESPN first, then CFBD only for games ESPN did not price this run. Applying
   CFBD over the top instead would rewrite live prices with a slower feed, and
   would flip `provider` between "DraftKings" and "Draft Kings" on every
   baseline run, churning seenAt on a price that never moved. */
const espnIds = new Set(espn.observations.filter((o) => o.price).map((o) => o.id));
const market = [
  ...espn.observations,
  ...cfbd.observations.filter((o) => !espnIds.has(o.id)),
];

/* Last, and only for what is left. Both book sources have had their turn by
   here, so the set of games FPI is asked about is exactly the set no market
   priced - which is the definition of last resort, enforced by when it runs
   rather than by a rule it has to remember. */
const pricedNow = new Set(market.filter((o) => o.price).map((o) => o.id));
/* A captured scoreboard is a replay, and a replay that reaches out to a live
   endpoint for the games its capture did not price is neither reproducible nor
   offline - it would put a network call in the middle of a hermetic test suite
   and make the file it writes depend on what ESPN thinks today. So the fixture
   flag turns this step off, the same way it turns the scoreboard fetch off. */
const fpiOff = NO_FPI || ESPN_FIXTURE || !espn.ok;
if (ESPN_FIXTURE && !NO_FPI) console.log("fpi: skipped, replaying a fixture");
const fpi = fpiOff ? [] : await readFpi(espn.events, pricedNow);

const games = mergeLines(stored.games, [...market, ...fpi]);

const payload = {
  /* When any source was last successfully read. The page renders this as
     "refreshed ...", so it is the run's timestamp, not the price's. */
  fetchedAt: seenAt,
  /* Drives the throttle above, so it only moves on a call that actually spent
     budget. */
  cfbdFetchedAt: cfbd.ok ? seenAt : stored.cfbdFetchedAt,
  season: doc.season,
  games,
};

const before = Object.keys(stored.games).length;
const after = Object.keys(games).length;
console.log(`espn priced ${espn.priced} game(s)` +
  (fpi.length ? `; fpi projected ${fpi.length}` : "") +
  `; stored games ${before} -> ${after}`);
if (after < before) {
  /* mergeLines cannot do this. If it ever does, the closing lines are gone and
     the run should be looked at rather than committed. */
  console.error("BUG: the merge lost games. Refusing to write.");
  process.exit(1);
}

if (DRY) {
  console.log("dry run, not writing");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
}
