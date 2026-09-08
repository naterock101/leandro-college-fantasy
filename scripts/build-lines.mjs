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
 *                                     [--espn-fixture path.json]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cfbdObservation, espnObservation, mergeLines } from "../lib/lines.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTERS = resolve(ROOT, "data/rosters.json");
const CFBD_API = "https://api.collegefootballdata.com/lines";
const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

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

/* The `dates` parameter is an Eastern calendar day, not a UTC one: a request
   for 20260905 returns games from 16:00Z that day through 02:30Z the next,
   which is noon to 22:30 ET. Computing the window in UTC would drop every
   Saturday night game from the day it belongs to. Intl carries the DST rule,
   so this stays right across the November change the crons are annotated for. */
const easternDay = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).replaceAll("-", "");

/* Yesterday, today, tomorrow, and nothing else. Sweeping the week would be
   free but pointless; three days is what a run can act on:
   - tomorrow, so a game is priced before its kickoff even if the next baseline
     run is the last one before it,
   - today, for the slate in progress,
   - yesterday, which is the one that is easy to leave out and must not be. A
     game that went final overnight is only observable as final while its date
     is still being fetched, and marking `closed` on the price we already hold
     is the last thing that can happen to it before ESPN forgets the odds. */
const espnDates = () => {
  const day = 24 * 60 * 60 * 1000;
  return [-1, 0, 1].map((n) => easternDay(new Date(now.getTime() + n * day)));
};

async function fetchEspnDoc(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.json();
  /* A reshaped or error payload usually still parses - an HTML block does not,
     but a JSON error object does. The events array is the contract. */
  if (!Array.isArray(body?.events)) throw new Error("no events array in the response");
  return body;
}

/** @returns {Promise<{observations: any[], ok: boolean, priced: number}>} */
async function readEspn() {
  const observations = [];
  let ok = false;
  let priced = 0;

  const absorb = (body, label) => {
    ok = true;
    for (const ev of body.events) {
      const o = espnObservation(ev, seenAt);
      if (!o) continue;
      if (o.price) priced++;
      observations.push(o);
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
    return { observations, ok, priced };
  }

  /* Sequential rather than Promise.all: three requests to an unauthenticated
     public endpoint that we are about to hit every ten minutes, so being
     unhurried is the polite default. One date failing must not lose the rest,
     which is why the catch is inside the loop. */
  for (const date of espnDates()) {
    try {
      absorb(await fetchEspnDoc(`${ESPN_API}?dates=${date}&groups=${ESPN_GROUP}`), date);
    } catch (e) {
      console.warn(`espn ${date} failed, skipped: ${e.message}`);
    }
  }
  return { observations, ok, priced };
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
/* run                                                                 */
/* ------------------------------------------------------------------ */

const espn = NO_ESPN ? { observations: [], ok: false, priced: 0 } : await readEspn();

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
const observations = [
  ...espn.observations,
  ...cfbd.observations.filter((o) => !espnIds.has(o.id)),
];

const games = mergeLines(stored.games, observations);

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
console.log(`espn priced ${espn.priced} game(s); stored games ${before} -> ${after}`);
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
